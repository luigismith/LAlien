/**
 * screens.js -- Screen manager
 * Manages overlays for conversation, diary, settings, graveyard, lexicon, minigames
 */
import { Events } from '../engine/events.js';
import { GameState, showToast, showConfirm } from '../engine/game-loop.js';
import { Pet } from '../pet/pet.js';
import { MiniGames } from '../pet/minigames.js';
import { LLMClient } from '../ai/llm-client.js';
import { SystemPrompt } from '../ai/system-prompt.js';
import { STTClient } from '../ai/stt-client.js';
import { DiaryGenerator } from '../ai/diary-generator.js';
import { Sentiment } from '../ai/sentiment.js';
import { I18n } from '../i18n/i18n.js';
import { AlienLexicon } from '../i18n/alien-lexicon.js';
import { Persistence } from '../engine/persistence.js';
import { SpeechBubble } from './speech-bubble.js';
import { Needs, NeedType } from '../pet/needs.js';
import { Death } from '../pet/death.js';
import { SoundEngine } from '../audio/sound-engine.js';

const SCREEN_IDS = {
    'setup': 'screen-setup',
    'conversation': 'screen-conversation',
    'diary': 'screen-diary',
    'lexicon': 'screen-lexicon',
    'graveyard': 'screen-graveyard',
    'settings': 'screen-settings',
    'minigame': 'screen-minigame',
    'minigame-select': 'screen-minigame-select',
    'manual': 'screen-manual',
};

function hideAll() {
    for (const id of Object.values(SCREEN_IDS)) {
        document.getElementById(id)?.classList.add('hidden');
    }
}

function showEl(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

export const Screens = {
    init() {
        this._bindConversation();
        this._bindDiary();
        this._bindLexicon();
        this._bindGraveyard();
        this._bindSettings();
        this._bindMinigames();

        // Back buttons
        document.getElementById('btn-conv-back')?.addEventListener('click', () => this.show('main'));
        document.getElementById('btn-diary-back')?.addEventListener('click', () => this.show('main'));
        document.getElementById('btn-lexicon-back')?.addEventListener('click', () => this.show('main'));
        document.getElementById('btn-grave-back')?.addEventListener('click', () => this.show('main'));
        document.getElementById('btn-settings-back')?.addEventListener('click', () => this.show('main'));
        document.getElementById('btn-minigame-back')?.addEventListener('click', () => {
            if (MiniGames.isPlaying()) {
                const result = MiniGames.endGame();
                if (result) {
                    Pet.applyGameResult(result);
                    Events.emit('pet-changed');
                }
            }
            if (this._minigameKeyHandler) {
                window.removeEventListener('keydown', this._minigameKeyHandler);
                this._minigameKeyHandler = null;
            }
            this.show('main');
        });
        document.getElementById('btn-minigame-select-back')?.addEventListener('click', () => this.show('main'));

        // Evolution events
        Events.on('evolution', (data) => {
            const msg = I18n.get('msg_evolution');
            showToast(msg, 5000);
        });

        // Death events
        Events.on('death', async (data) => {
            showToast(I18n.get('msg_death'), 8000);
            // Generate last words
            const lastWords = await DiaryGenerator.generateLastWords(data.cause);
            Pet.lastWords = lastWords;
            SpeechBubble.show(lastWords, 'sad', 10000);
            Events.emit('pet-changed');
        });
    },

    show(screen) {
        const prev = GameState.currentScreen;
        hideAll();
        GameState.currentScreen = screen;

        // Whoosh when moving between screens (skip main<->egg silent transitions)
        if (prev !== screen) {
            if (screen === 'main' || screen === 'egg') SoundEngine.playScreenOut();
            else SoundEngine.playScreenIn();
        }

        if (screen === 'main' || screen === 'egg') {
            // Just show canvas + action bar
            return;
        }

        const id = SCREEN_IDS[screen];
        if (id) showEl(id);

        // Screen-specific setup
        if (screen === 'diary') this._renderDiary();
        if (screen === 'lexicon') this._renderLexicon();
        if (screen === 'graveyard') this._renderGraveyard();
        if (screen === 'manual') this._renderManual();
        if (screen === 'settings') this._renderSettings();
    },

    showSetup() {
        hideAll();
        showEl('screen-setup');
        GameState.currentScreen = 'setup';
    },

    updateLabels() {
        // Update action button labels
        const labels = {
            'btn-feed': I18n.get('main_feed'),
            'btn-sleep': I18n.get('main_sleep'),
            'btn-clean': I18n.get('main_clean'),
            'btn-play': I18n.get('main_play'),
            'btn-talk': I18n.get('main_chat'),
            'btn-meditate': I18n.get('main_meditate'),
            'btn-settings': I18n.get('main_settings'),
        };
        for (const [id, text] of Object.entries(labels)) {
            const el = document.getElementById(id);
            if (el) {
                const label = el.querySelector('.action-label');
                if (label) label.textContent = text;
            }
        }

        // Update screen titles and settings labels
        const textMap = {
            'conv-title': I18n.get('screen_conversation_title'),
            'diary-title': I18n.get('screen_diary_title'),
            'lexicon-title': I18n.get('screen_lexicon_title'),
            'graveyard-title': I18n.get('screen_graveyard_title'),
            'settings-title-text': I18n.get('settings_title'),
            'settings-lang-label': I18n.get('settings_language'),
            'settings-provider-label': I18n.get('settings_provider'),
            'settings-api-label': I18n.get('settings_api_key'),
        };
        for (const [id, text] of Object.entries(textMap)) {
            const el = document.getElementById(id);
            if (el && text) el.textContent = text;
        }
    },

    // ---- Conversation ----
    _bindConversation() {
        const input = document.getElementById('conv-input');
        const sendBtn = document.getElementById('btn-conv-send');
        const micBtn = document.getElementById('btn-conv-mic');

        const send = async () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';

            this._addMessage(text, 'user');

            // --- Sentiment: nudge mood based on how the keeper is talking ---
            const sent = Sentiment.analyze(text);
            if (sent.confidence > 0.15) {
                const mag = sent.score * sent.confidence;  // [-1, +1]
                // Positive words lift NASHI + AFFECTION; harsh words hurt them
                // Magnitude tuned so a warm message gives ~+4 to NASHI, ~+3 to AFFECTION
                Pet.needs[NeedType.NASHI]     = Math.max(0, Math.min(100, Pet.needs[NeedType.NASHI]     + mag * 6));
                Pet.needs[NeedType.AFFECTION] = Math.max(0, Math.min(100, Pet.needs[NeedType.AFFECTION] + mag * 5));
                // Harsh words also scare the pet a little (reduce SECURITY)
                if (sent.bucket === 'negative') {
                    Pet.needs[NeedType.SECURITY] = Math.max(0, Pet.needs[NeedType.SECURITY] + mag * 3);
                    // Strong hostility → transition to SULKY (if not already in a blocking activity)
                    if (sent.score < -0.55 && sent.confidence > 0.5) {
                        const { Activity } = await import('../pet/activity.js');
                        if (Activity.getType(Pet) === Activity.Type.IDLE) {
                            Activity.start(Pet, Activity.Type.SULKY, { reason: 'harsh-words' });
                        }
                    }
                }
            }

            // --- Bidirectional vocabulary: if keeper uses an alien word, pet LEARNS it ---
            const taught = AlienLexicon.discoverFromText(text, 'keeper');
            if (taught.length) {
                // Subtle knowledge boost: teaching the pet stimulates its mind
                Pet.needs[NeedType.COGNITION] = Math.min(100, Pet.needs[NeedType.COGNITION] + 3 * taught.length);
                Pet.needs[NeedType.CURIOSITY] = Math.min(100, Pet.needs[NeedType.CURIOSITY] + 2 * taught.length);
                DiaryGenerator.logMemory('taught', `keeper insegna: ${taught.join(', ')}`);
                showToast(`${Pet.getName()} ha imparato da te: ${taught.join(', ')}`, 4000);
            }

            if (!LLMClient.isAvailable()) {
                this._addMessage(I18n.get('chat_aphasia'), 'system');
                return;
            }

            // Thinking indicator + pixel thinking-mark over pet
            this._addMessage(Pet.getName() + ' ' + I18n.get('chat_thinking'), 'system');
            SoundEngine.playThinking();
            try { (await import('./emotive-effects.js')).EmotiveEffects.setThinking(5000); } catch (_) {}

            try {
                const prompt = SystemPrompt.build(sent);
                const response = await LLMClient.chat(prompt, text);

                // Remove thinking indicator
                const log = document.getElementById('conversation-log');
                const lastMsg = log.lastElementChild;
                if (lastMsg?.classList.contains('msg-system')) lastMsg.remove();

                this._addMessage(response, 'pet');

                // Update pet state
                Needs.talk(Pet.needs);
                Pet.addConversation();
                DiaryGenerator.logMemory('conversation', text.slice(0, 50));
                await DiaryGenerator.onConversationEnd(response);
                Events.emit('pet-changed');

            } catch (e) {
                const log = document.getElementById('conversation-log');
                const lastMsg = log.lastElementChild;
                if (lastMsg?.classList.contains('msg-system')) lastMsg.remove();
                this._addMessage('Error: ' + e.message, 'system');
            }
        };

        sendBtn?.addEventListener('click', send);
        input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

        // Mic button (push-to-talk)
        if (micBtn) {
            let micActive = false;
            const startMic = () => {
                if (micActive) return;
                micActive = true;
                micBtn.classList.add('recording');
                SoundEngine.playMicOpen();
                STTClient.startRecording(
                    (text) => {
                        if (text) {
                            SoundEngine.playMicSuccess();
                            input.value = text;
                            send();
                        }
                        micBtn.classList.remove('recording');
                        micActive = false;
                    },
                    (err) => {
                        SoundEngine.playError();
                        showToast('Mic error: ' + err);
                        micBtn.classList.remove('recording');
                        micActive = false;
                    }
                );
            };

            const stopMic = () => {
                if (!micActive) return;
                SoundEngine.playMicClose();
                STTClient.stopRecording();
            };

            micBtn.addEventListener('mousedown', startMic);
            micBtn.addEventListener('mouseup', stopMic);
            micBtn.addEventListener('mouseleave', stopMic);
            micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startMic(); });
            micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopMic(); });
        }
    },

    _addMessage(text, type) {
        const log = document.getElementById('conversation-log');
        const wrap = document.createElement('div');
        wrap.className = `msg msg-${type}`;

        if (type === 'pet') {
            // Prefix with pet name label
            const label = document.createElement('div');
            label.className = 'msg-label';
            label.textContent = (Pet.getName && Pet.getName()) || 'Lalìen';
            wrap.appendChild(label);
        } else if (type === 'user') {
            const label = document.createElement('div');
            label.className = 'msg-label';
            label.textContent = 'tu';
            wrap.appendChild(label);
        }

        const body = document.createElement('div');
        body.className = 'msg-body';
        // For pet messages, wrap each word in a span so we can karaoke-highlight it
        if (type === 'pet') {
            const tokens = text.split(/(\s+)/);
            for (const tk of tokens) {
                if (/^\s+$/.test(tk)) {
                    body.appendChild(document.createTextNode(tk));
                } else if (tk.length) {
                    const s = document.createElement('span');
                    s.className = 'karaoke-word';
                    s.textContent = tk;
                    body.appendChild(s);
                }
            }
        } else {
            body.textContent = text;
        }
        wrap.appendChild(body);

        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;

        // Kick off karaoke + TTS for pet messages
        if (type === 'pet') {
            this._karaokeSpeak(body, text);
        }
        return wrap;
    },

    /**
     * Speak the pet's reply with Web Speech API and highlight each word in sync.
     * Uses the boundary event when available, otherwise estimates timing.
     */
    _karaokeSpeak(container, text) {
        const spans = container.querySelectorAll('.karaoke-word');
        if (!spans.length) return;
        const mood = (Pet.getMood && Pet.getMood()) || 'neutral';
        // Play the mood-aware chirp as intro
        try { SoundEngine.playMoodChirp && SoundEngine.playMoodChirp(Pet.getStage(), mood); } catch (_) {}

        if (!('speechSynthesis' in window) || localStorage.getItem('lalien_tts_enabled') === '0') {
            // No TTS — fall back to timed reveal (~100ms/word)
            let i = 0;
            const iv = setInterval(() => {
                if (i >= spans.length) { clearInterval(iv); return; }
                spans[i].classList.add('spoken');
                if (i > 0) spans[i-1].classList.add('past');
                i++;
            }, 180);
            return;
        }

        try {
            speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            const stage = (Pet.getStage && Pet.getStage()) || 2;
            const voices = speechSynthesis.getVoices();
            const lang = (localStorage.getItem('lalien_language') || 'it').toLowerCase();
            const voice = voices.find(v => v.lang.toLowerCase().startsWith(lang)) || voices[0];
            if (voice) { u.voice = voice; u.lang = voice.lang; }
            // Stage-appropriate voice
            const baseTable = [
                { p:1.95, r:1.15 },{ p:1.90, r:1.30 },{ p:1.75, r:1.25 },
                { p:1.50, r:1.15 },{ p:1.25, r:1.05 },{ p:1.00, r:1.00 },
                { p:0.80, r:0.85 },{ p:1.10, r:0.75 },
            ];
            const base = baseTable[stage] || baseTable[2];
            const moodOff = mood === 'happy' ? 0.15 : mood === 'sad' ? -0.2 : mood === 'scared' ? 0.25 : 0;
            u.pitch = Math.max(0.1, Math.min(2, base.p + moodOff));
            u.rate  = Math.max(0.5, Math.min(2, base.r));

            // Word-boundary highlighting
            let idx = 0;
            u.onboundary = (ev) => {
                if (ev.name && ev.name !== 'word') return;
                if (idx < spans.length) {
                    if (idx > 0) spans[idx - 1].classList.add('past');
                    spans[idx].classList.add('spoken');
                    idx++;
                }
            };
            u.onend = () => {
                for (const s of spans) { s.classList.add('past'); s.classList.remove('spoken'); }
            };
            speechSynthesis.speak(u);
        } catch (_) { /* ignore */ }
    },

    // ---- Diary ----
    _bindDiary() {},

    _renderDiary() {
        const container = document.getElementById('diary-entries');
        container.innerHTML = '';
        const entries = DiaryGenerator.getDiary();

        if (entries.length === 0) {
            container.innerHTML = `<p class="setup-hint">${I18n.get('diary_empty')}</p>`;
            return;
        }

        for (const entry of entries.slice().reverse()) {
            const div = document.createElement('div');
            div.className = 'diary-entry';
            div.innerHTML = `
                <div class="diary-entry-day">${I18n.get('diary_day')} ${entry.day} - ${Pet.getStageNameFor(entry.stage)}</div>
                <div class="diary-entry-text">${entry.text}</div>
            `;
            container.appendChild(div);
        }
    },

    // ---- Lexicon ----
    _bindLexicon() {},

    _renderManual() {
        const body = document.getElementById('manual-body');
        if (!body) return;
        const stageCards = [0,1,2,3,4,5,6,7].map(s => {
            const names = ['Syrma','Lali-na','Lali-shi','Lali-ko','Lali-ren','Lali-vox','Lali-mere','Lali-thishi'];
            const descs = [
                'Uovo cosmico. Vibra ma non parla. Schiusa dopo 10 min + 3 tocchi.',
                'Cucciolo appena nato. Solo suoni alieni puri.',
                'Cucciolo. Inizia a imitare le tue parole.',
                'Bambino. 1-3 parole in lingua tua con lalì misto.',
                'Adolescente. Fluente con accento alieno.',
                'Adulto. Padronanza del linguaggio + personalità.',
                'Anziano. Saggezza rara e silenzi significativi.',
                'Trascendente. Quasi parte del cielo, ogni parola un addio.',
            ];
            return `
                <div class="manual-stage">
                    <img src="sprites/stage_${s}_${['syrma','lalina','lalishi','laliko','laliren','lalivox','lalimere','lalithishi'][s]}/variant_00/preview.png" alt="${names[s]}">
                    <div>
                        <h4>${s}. ${names[s]}</h4>
                        <p>${descs[s]}</p>
                    </div>
                </div>
            `;
        }).join('');

        const needsGrid = [
            ['🍎','Fame (Kòra)','Scende col tempo. Dagli cibo. Se >85% rifiuta.'],
            ['💤','Sonno (Mokó)','Scende di giorno, più in fretta di notte. Fai dormire.'],
            ['💧','Igiene (Miska)','Si sporca giocando. Puliscilo.'],
            ['😊','Felicità (Nashi)','Coccole, giochi, parole dolci.'],
            ['❤','Salute','Derivata: guarisce da sola se tutti gli altri sono alti.'],
            ['🧠','Mente','Chat e stimoli mentali.'],
            ['🫂','Affetto','Carezze e vicinanza. Crolla se lontano a lungo.'],
            ['👁','Curiosità','Giochi diversi, novità.'],
            ['✨','Cosmico','Solo stadio 6+. Meditazione.'],
            ['🛡','Sicurezza','Presenza costante e routine.'],
        ].map(([icon, name, desc]) => `
            <div class="manual-need">
                <span class="manual-need-icon">${icon}</span>
                <div><strong>${name}</strong><br><span>${desc}</span></div>
            </div>
        `).join('');

        body.innerHTML = `
            <section>
                <h3>👋 Benvenuto, Custode</h3>
                <p>Il Lalìen è una creatura di Echòa, un mondo-coro morente. Custodirlo significa nutrirlo, coccolarlo, insegnargli la tua lingua, lasciarlo esplorare il suo ambiente e accompagnarlo attraverso <b>8 stadi evolutivi</b> fino alla trascendenza.</p>
                <p>Ogni Lalìen è <b>unico</b>: il suo DNA determina aspetto (1 tra 16 varianti per stadio), personalità, cibi preferiti, momento della giornata che ama. La sua vita è <b>permadeath</b>: se muore non torna più.</p>
            </section>

            <section>
                <h3>🎮 I controlli</h3>
                <p><b>Barra alta (chips) = INTERAGISCI col pet:</b></p>
                <ul>
                    <li><b>Tap breve</b> su un chip → scheda con stato %, consiglio e pulsante azione</li>
                    <li><b>Long-press</b> (0.6s) → esegue subito l'azione</li>
                    <li><b>Drag del chip SUL pet</b> → esegue l'azione via gesto</li>
                </ul>
                <p><b>Barra bassa (hotbar) = LASCIA oggetti sul pavimento:</b></p>
                <ul>
                    <li><b>Trascina</b> un'icona dalla hotbar e <b>rilascia sul pavimento</b> → l'oggetto appare nella scena</li>
                    <li>Il pet ci camminerà e lo userà da solo (anche mentre dormi!)</li>
                    <li>Tappare la hotbar non fa nulla — solo drag funziona</li>
                </ul>
                <p><b>Sul pet direttamente:</b></p>
                <ul>
                    <li><b>Tap</b> → poke (sorpresa)</li>
                    <li><b>Striscia ripetuta</b> → carezza (cuori)</li>
                    <li><b>Scrub circolare</b> → pulizia (bollicine)</li>
                </ul>
                <p><b>Gesti del dispositivo:</b></p>
                <ul>
                    <li><b>Scuoti il telefono</b> → apre selettore mini-giochi</li>
                </ul>
            </section>

            <section>
                <h3>🎒 Hotbar e oggetti</h3>
                <p>La barra in basso contiene <b>8 slot rapidi</b>: trascina sul pavimento per lasciare un oggetto che il pet userà da solo.</p>
                <p><b>Oggetti consumabili</b> (uso singolo, poi spariscono):</p>
                <ul>
                    <li>🍎 <b>Cibo</b> — KORA +35, NASHI +3</li>
                    <li>🧼 <b>Sapone</b> — MISKA +30 (3 usi)</li>
                    <li>🛏️ <b>Cuscino</b> — avvia il sonno quando il pet lo raggiunge</li>
                    <li>✨ <b>Cristallo</b> — avvia meditazione (stadio 6+)</li>
                </ul>
                <p><b>Oggetti persistenti</b> (il pet ci resta vicino e guadagna bonus continuo):</p>
                <ul>
                    <li>🎮 <b>Giocattolo</b> — NASHI +0.35/tick (8 usi, 1 uso ogni 60s ≈ 8 min)</li>
                    <li>🧸 <b>Peluche</b> — AFFECTION +0.25/tick (12 usi ≈ 12 min)</li>
                    <li>📻 <b>Radio</b> — COGNITION +0.30/tick (10 usi ≈ 10 min)</li>
                    <li>🏐 <b>Palla</b> — CURIOSITY +0.30/tick (8 usi ≈ 8 min)</li>
                    <li>🧩 <b>Puzzle</b> — COGNITION +0.25/tick (10 usi ≈ 10 min)</li>
                </ul>
                <p class="manual-note">Usa gli oggetti persistenti per tenerlo occupato quando non sei lì. Il pet sceglie autonomamente l'oggetto che corrisponde al bisogno più basso e ci cammina verso orizzontalmente. Gli oggetti scadono dopo il loro lifespan (10-60 min).</p>
            </section>

            <section>
                <h3>📊 I 10 Bisogni</h3>
                <div class="manual-needs-grid">${needsGrid}</div>
                <p class="manual-note">I chip cambiano bordo in base al livello: <span style="color:#40C470">verde</span> ≥70, giallo 40-70, arancione 20-40, <span style="color:#E04848">rosso pulsante</span> &lt;20. Se più bisogni sono critici il pet entra in stati speciali (vedi sotto).</p>
            </section>

            <section>
                <h3>🧬 8 Stadi di Crescita</h3>
                <div class="manual-stages">${stageCards}</div>
                <p class="manual-note">Ogni stadio richiede tempo di gioco + interazioni + parole aliene imparate. Vedi <b>Impostazioni → Prossima evoluzione</b> per sapere cosa manca. Ogni Lalìen ha <b>16 varianti visive</b> scelte dal DNA.</p>
            </section>

            <section>
                <h3>🎭 Gli Stati Attivi</h3>
                <ul>
                    <li><b>IDLE</b> — tranquillo, attivo, cammina, parla, ti ascolta</li>
                    <li><b>SLEEPING</b> 💤 — dorme. <b>Tutti i bisogni sono CONGELATI</b>. Puoi aprire impostazioni/diario/manuale senza svegliarlo. Lo svegliano solo: tap diretto, azione che lo tocca (feed/clean/play/talk/caress). Se lo svegli con MOKO &lt;60 diventa SULKY (muso lungo).</li>
                    <li><b>EATING</b> 🍎 — mastica, KORA sale rapidamente. Non può essere rinutrito.</li>
                    <li><b>MEDITATING</b> ✨ — solo stadio 6+. 5 min di aura dorata, COSMIC sale, altri bisogni rallentati.</li>
                    <li><b>SICK</b> 🤒 — HEALTH &lt; 25 per 30s. Azioni al 50%. Esce quando HEALTH > 50.</li>
                    <li><b>AFRAID</b> 😨 — SECURITY &lt; 15 o parole ostili. Rifiuta gioco. Carezza/parole dolci valgono 1.5×.</li>
                    <li><b>SULKY</b> 😤 — insulti forti o sveglia brusca. 2-5 min. Rifiuta carezze, talk al 30%.</li>
                </ul>
            </section>

            <section>
                <h3>🧠 La mente del Lalìen</h3>
                <p>Il tuo Lalìen ha una <b>mente propria guidata dall'AI</b>. Non reagisce soltanto: <b>pensa, osserva, fa domande, si ricorda, forma opinioni</b>. È ispirato ai migliori virtual pet della storia (Seaman, Creatures) ma con tecnologia moderna.</p>

                <p><b>Cosa fa autonomamente:</b></p>
                <ul>
                    <li>💬 <b>Ti fa domande</b> sulla tua vita, le tue emozioni, il mondo — "Come ti chiami?", "Hai dormito bene?", "Cosa ti rende felice?"</li>
                    <li>🗣️ <b>Commenta</b> ciò che osserva — l'ora del giorno, come si sente, i ricordi recenti, il tuo comportamento</li>
                    <li>🧠 <b>Ricorda</b> le interazioni passate e le cita — "ieri hai detto...", "mi hai nutrito prima, grazie"</li>
                    <li>🌌 <b>Sogna di Echòa</b> — condivide frammenti della civiltà perduta, ricordi cosmici</li>
                    <li>🎯 <b>Chiede ciò che vuole</b> — cibo, gioco, coccole, sonno — in base ai suoi bisogni reali</li>
                    <li>🚶 <b>Si muove verso gli oggetti</b> che lo interessano, cammina, esplora</li>
                    <li>💤 <b>Decide di dormire</b> se è stanco, o di <b>meditare</b> se è anziano</li>
                </ul>

                <p><b>Personalità dal DNA:</b> tratti come curioso/calmo/ansioso/giocoso/affettuoso influenzano le sue scelte. Un Lalìen curioso farà più domande; uno calmo farà più osservazioni; uno ansioso chiederà più spesso rassicurazioni.</p>

                <p><b>Intelligenza per stadio:</b></p>
                <ul>
                    <li>Stadio 0: nessun pensiero (uovo)</li>
                    <li>Stadio 1: istinto puro, ogni 10 min, 1-2 suoni</li>
                    <li>Stadio 2: ogni 6 min, frasi aliene brevi, curiosità basilare</li>
                    <li>Stadio 3: ogni 5 min, domande semplici, desideri</li>
                    <li>Stadio 4: ogni 4 min, opinioni, preferenze forti</li>
                    <li>Stadio 5: ogni 3 min, riflessioni sfumate, nota cose del custode</li>
                    <li>Stadio 6: ogni 2.5 min, saggezza, domande esistenziali</li>
                    <li>Stadio 7: ogni 2 min, poesia frammentaria, addio cosmico</li>
                </ul>

                <p><b>Linguaggio misto:</b> agli stadi bassi parla solo in lalìen; crescendo mescola sempre più la lingua del custode. Allo stadio 5+ è quasi fluente con accento alieno.</p>

                <p class="manual-note">Ogni pensiero viene salvato nel <b>diario</b> in italiano. Puoi rileggere i suoi ragionamenti, i suoi sogni di Echòa, le sue opinioni su di te. Richiede chiave API. Disattivabile da <b>Impostazioni → Mente AI autonoma</b>.</p>
            </section>

            <section>
                <h3>💬 Chat e voce</h3>
                <p>La chat è <b>integrata nella schermata principale</b>: la barra di testo è sempre visibile sopra la hotbar. Non devi aprire un menu separato.</p>
                <ul>
                    <li><b>Scrivi</b> nella barra e premi ➤ — il pet risponde con un fumetto direttamente nella scena</li>
                    <li><b>Premi 🎤</b> per parlare a voce — il riconoscimento vocale trascrive e invia</li>
                    <li>Senti la sua <b>voce TTS</b> con pitch scalato per stadio</li>
                    <li>Le parole si illuminano in stile <b>karaoke</b></li>
                    <li>Puoi <b>rispondere direttamente</b> quando il pet ti fa una domanda autonoma</li>
                    <li>Il <b>tono</b> che usi (dolce/ostile) influenza NASHI, AFFECTION, SECURITY</li>
                    <li>Usando parole aliene, <b>gliele insegni</b></li>
                    <li>Parlare stimola COGNITION +25, AFFECTION +5, CURIOSITY +5</li>
                </ul>
            </section>

            <section>
                <h3>🕹️ I 5 Mini-giochi</h3>
                <ul>
                    <li><b>Thishi-Revosh</b> ♪ — memoria dell'eco. Ripeti la sequenza di nodi colorati. +COGNITION +CURIOSITY</li>
                    <li><b>Miska-Vythi</b> ✨ — pulizia di luce. Spazzola la polvere delicatamente. +MISKA +AFFECTION</li>
                    <li><b>Selath-Nashi</b> ★ — costellazioni. Connetti le stelle giuste. +COSMIC +CURIOSITY</li>
                    <li><b>Kòra-Tris</b> ▦ — Tetris alieno con 7 tetromini colorati. Completa righe per +COGNITION +CURIOSITY +SECURITY.<br><i>Tastiera: ←→ sposta, ↑/W ruota, ↓ giù, Spazio caduta istantanea. Touch: tap in alto = ruota, lati = sposta, centro = hard drop.</i></li>
                    <li><b>Pac-Lalì</b> ☻ — labirinto con 3 morak (spiriti). Raccogli semi (+10), power-pellet (+50) rendono invincibile per 8s (mangi morak +200). +NASHI +CURIOSITY. Vittoria = +SECURITY.<br><i>Tastiera: frecce/WASD. Touch: swipe per girare.</i></li>
                </ul>
                <p class="manual-note">Ogni partita costa MOKO (3-6). Dopo <b>3 partite in 10 min</b> il pet è stanco e rifiuta la 4ª.</p>
            </section>

            <section>
                <h3>✨ Effetti visivi ed empatici</h3>
                <p>Il pet esprime emozioni con particelle pixel-art sopra di sé:</p>
                <ul>
                    <li>💗 <b>Cuori</b>: quando lo coccoli, quando soddisfi un suo desiderio</li>
                    <li>😢 <b>Lacrime</b>: durante SULKY</li>
                    <li>🎵 <b>Note musicali</b>: durante MEDITATING</li>
                    <li>✨ <b>Scintille dorate</b>: alta felicità, evoluzione, vittoria mini-gioco</li>
                    <li>❗ <b>Esclamazione</b>: sorpreso da un poke</li>
                    <li>❓ <b>Punto domanda</b>: mentre l'AI sta pensando</li>
                    <li>💦 <b>Sudore</b>: malato o impaurito</li>
                </ul>
                <p>Ed effetti globali: <b>screen shake</b> quando si spaventa, <b>flash dorato</b> all'evoluzione, <b>flash scuro</b> alla morte, <b>aura</b> durante meditazione.</p>
            </section>

            <section>
                <h3>🌅 Ritmo circadiano</h3>
                <p>Il pet usa l'ora reale del dispositivo per adattare il comportamento:</p>
                <ul>
                    <li><b>22:00-07:00</b>: se lo metti a dormire → durata fino alle 7 del mattino</li>
                    <li><b>07:00-10:00</b>: boost mattutino NASHI +5, CURIOSITY +4 (1 volta al giorno)</li>
                    <li><b>13:00-15:00</b>: se stanco si addormenta da solo (siesta spontanea)</li>
                    <li><b>20:00-22:00</b>: ti invita alla nanna con frasi/bolla desiderio</li>
                    <li><b>Notte con pet sveglio</b>: MOKO cala più in fretta + NASHI erode lentamente</li>
                </ul>
            </section>

            <section>
                <h3>🔔 Notifiche</h3>
                <p>Attivabili da <b>Impostazioni → Notifiche bisogni urgenti</b>. Su iPhone <b>devi aggiungere l'app alla Home</b> (Condividi → Aggiungi a schermata Home). Quando il pet ha un bisogno critico &lt;20% e non sei nell'app, arriva una notifica di sistema. Cooldown 15 min per bisogno.</p>
            </section>

            <section>
                <h3>☁ Cloud sync</h3>
                <p>Il tuo save (pet, chiavi API cifrate, diario, memorie, lessico) è salvato sul server via <b>PIN personale</b>. Puoi rientrare da qualsiasi dispositivo con lo stesso PIN.</p>
            </section>

            <section>
                <h3>⚰ Morte e rinascita</h3>
                <p>Se trascuri il pet troppo a lungo, muore. Lo ricorderai nel <b>Cimitero dei Ricordi</b>: resterà il suo nome, ultima parola, parole imparate. Da lì puoi piantare un nuovo seme (stesso account) e un nuovo Lalìen nasce con nuovo DNA.</p>
                <p>Al momento della morte c'è uno <b>sequence visivo</b> dedicato (dissolversi, trascendere, o spegnersi) in base alla causa.</p>
            </section>

            <section>
                <h3>🛠 Trucchi e debug</h3>
                <ul>
                    <li><b>Moltiplicatore tempo</b> (Impostazioni): 1×/60×/360×/3600× per accelerare tutto</li>
                    <li><b>Prova audio</b> pulsante in Impostazioni per testare il suono</li>
                    <li><b>Sblocca attività</b> in Impostazioni: se il pet resta bloccato in uno stato per bug, lo riporti a IDLE</li>
                    <li><b>Stato attività</b> in Impostazioni mostra cosa sta facendo e tempo rimanente</li>
                    <li><b>Esporta / Importa</b> salvataggio in JSON per backup manuale</li>
                </ul>
            </section>
        `;
    },

    _renderLexicon() {
        const filters = document.getElementById('lexicon-filters');
        const entries = document.getElementById('lexicon-entries');

        // Categories
        const categories = AlienLexicon.getCategories();
        filters.innerHTML = '';
        const allBtn = document.createElement('button');
        allBtn.className = 'lexicon-filter-btn active';
        allBtn.textContent = 'Tutti';
        allBtn.addEventListener('click', () => {
            filters.querySelectorAll('.lexicon-filter-btn').forEach(b => b.classList.remove('active'));
            allBtn.classList.add('active');
            renderWords(null);
        });
        filters.appendChild(allBtn);

        for (const cat of categories) {
            const btn = document.createElement('button');
            btn.className = 'lexicon-filter-btn';
            btn.textContent = cat;
            btn.addEventListener('click', () => {
                filters.querySelectorAll('.lexicon-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderWords(cat);
            });
            filters.appendChild(btn);
        }

        const renderWords = (category) => {
            entries.innerHTML = '';
            const words = AlienLexicon.getAllWords(category);
            const discovered = AlienLexicon.getDiscoveredWordSet();
            const langCode = localStorage.getItem('lalien_language') || 'it';
            const meaningKey = `meaning_${langCode}`;

            for (const w of words) {
                const isDiscovered = discovered.has(w.word);
                const div = document.createElement('div');
                div.className = `lexicon-word ${isDiscovered ? '' : 'lexicon-word-undiscovered'}`;
                div.innerHTML = `
                    <span class="lexicon-word-name">${w.word}</span>
                    <span class="lexicon-word-ipa">${w.ipa}</span>
                    <div class="lexicon-word-meaning">${isDiscovered ? (w[meaningKey] || w.meaning_en) : I18n.get('lexicon_undiscovered')}</div>
                `;
                entries.appendChild(div);
            }
        };
        renderWords(null);
    },

    // ---- Graveyard ----
    _bindGraveyard() {},

    async _renderGraveyard() {
        const container = document.getElementById('graveyard-entries');
        container.innerHTML = '';
        const graves = (await Persistence.loadGraveyard()) || [];

        if (graves.length === 0) {
            container.innerHTML = `<p class="setup-hint">${I18n.get('graveyard_empty')}</p>`;
            return;
        }

        for (const g of graves.slice().reverse()) {
            const div = document.createElement('div');
            div.className = `grave-entry ${g.transcended ? 'grave-transcended' : ''}`;
            div.innerHTML = `
                <div class="grave-name">${g.name || 'Lalien'}</div>
                <div class="grave-details">
                    ${I18n.get('graveyard_lived')} ${g.ageDays} ${I18n.get('graveyard_days')}<br>
                    ${I18n.get('graveyard_stage')}: ${g.stageName}<br>
                    ${I18n.get('graveyard_words')}: ${g.vocabSize || 0}
                </div>
                <div class="grave-last-words">${g.lastWords}</div>
            `;
            container.appendChild(div);
        }
    },

    // ---- Settings ----
    _bindSettings() {
        document.getElementById('btn-farewell')?.addEventListener('click', async () => {
            const ok = await showConfirm(I18n.get('settings_provider_confirm'));
            if (!ok) return;
            const ok2 = await showConfirm(I18n.get('settings_provider_confirm2'));
            if (!ok2) return;
            Pet.triggerFarewell();
            Events.emit('pet-changed');
            this.show('main');
        });

        document.getElementById('btn-export-save')?.addEventListener('click', () => {
            Persistence.exportSave();
            showToast('Save exported');
        });

        document.getElementById('btn-import-save')?.addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await Persistence.importSave(file);
                showToast('Save imported. Reloading...');
                setTimeout(() => location.reload(), 1500);
            } catch (err) {
                showToast('Import error: ' + err.message);
            }
        });

        document.getElementById('btn-settings-save-key')?.addEventListener('click', async () => {
            const key = document.getElementById('settings-api-key').value.trim();
            if (key) {
                await LLMClient.saveApiKey(key);
                const provider = document.getElementById('settings-provider-select').value;
                localStorage.setItem('lalien_provider', provider);
                LLMClient.init(provider, key);
                SoundEngine.playSuccess();
                showToast('API key saved');
            }
        });

        document.getElementById('settings-language')?.addEventListener('change', async (e) => {
            const lang = e.target.value;
            localStorage.setItem('lalien_language', lang);
            await I18n.load(lang);
            this.updateLabels();
            showToast('Language changed');
        });

        document.getElementById('settings-time-mult')?.addEventListener('change', (e) => {
            GameState.timeMultiplier = parseInt(e.target.value);
            localStorage.setItem('lalien_time_mult', GameState.timeMultiplier);
        });

        // SFX master toggle (all Web Audio sounds)
        document.getElementById('settings-sfx-toggle')?.addEventListener('change', (e) => {
            SoundEngine.setEnabled(e.target.checked);
            if (e.target.checked) {
                try { SoundEngine.resume && SoundEngine.resume(); } catch (_) {}
                SoundEngine.playToggle(true);
            }
            showToast(e.target.checked ? 'Audio attivato' : 'Audio disattivato');
        });

        // "Prova audio" — force resume + play a chirp + show diagnostic
        document.getElementById('btn-audio-test')?.addEventListener('click', () => {
            try { SoundEngine.resume && SoundEngine.resume(); } catch (_) {}
            SoundEngine.setEnabled(true);
            const sfxToggle = document.getElementById('settings-sfx-toggle');
            if (sfxToggle) sfxToggle.checked = true;
            try { SoundEngine.playMoodChirp(2, 'happy'); } catch (_) {}
            try { SoundEngine.playToast(); } catch (_) {}
            const diag = document.getElementById('audio-diag-text');
            if (diag) {
                const en = SoundEngine.isEnabled();
                const vol = Math.round((SoundEngine.getVolume?.() ?? 1) * 100);
                diag.textContent = en ? `Attivo · vol ${vol}%` : 'DISATTIVATO';
                diag.style.color = en ? 'var(--cyan)' : 'var(--danger)';
            }
            showToast('Test audio inviato. Hai sentito qualcosa?');
        });

        // TTS toggle
        document.getElementById('settings-tts-toggle')?.addEventListener('change', (e) => {
            SoundEngine.playToggle(e.target.checked);
            import('./speech-bubble.js').then(m => m.SpeechBubble.setTTSEnabled(e.target.checked));
            showToast(e.target.checked ? 'Voce attivata' : 'Voce disattivata');
        });

        // Mind (LLM autonomy) toggle
        document.getElementById('settings-mind-toggle')?.addEventListener('change', async (e) => {
            SoundEngine.playToggle(e.target.checked);
            const { Mind } = await import('../pet/mind.js');
            Mind.setEnabled(e.target.checked);
            showToast(e.target.checked ? 'Mente AI attiva' : 'Mente AI disattivata — torna alle reazioni base');
        });

        // Notifications toggle — requires user permission
        document.getElementById('settings-notif-toggle')?.addEventListener('change', async (e) => {
            const wanted = e.target.checked;
            SoundEngine.playToggle(wanted);
            const { Notifications } = await import('./notifications.js');
            const res = await Notifications.setEnabled(wanted);
            if (wanted) {
                if (res.ok) {
                    showToast('Notifiche attive. Ti avviso quando ha bisogno.');
                    Notifications.test();
                } else {
                    e.target.checked = false;
                    if (res.reason === 'denied') {
                        showToast('Permesso negato. Attiva le notifiche dalle impostazioni del browser per questo sito.');
                    } else if (res.reason === 'ios-needs-install') {
                        // Proper iOS Safari PWA install flow
                        (await import('./notifications.js')).Notifications;
                        showToast('Su iPhone devi prima aggiungere il sito alla schermata Home. Leggi le istruzioni qui sotto.', 6500);
                        const { Screens: S } = await import('./screens.js');
                        // Show a modal/instructions — reuse the existing confirm helper as a simple prompt
                        await showConfirm(
                            'Per abilitare le notifiche su iPhone:\n\n' +
                            '1. Apri Safari (non altro browser).\n' +
                            '2. Tocca il pulsante "Condividi" (icona quadrato con freccia).\n' +
                            '3. Seleziona "Aggiungi alla schermata Home".\n' +
                            '4. Apri l\'icona "Lalìen" dalla Home.\n' +
                            '5. Torna in Impostazioni e riattiva le notifiche.\n\n' +
                            'Serve iOS 16.4 o superiore.'
                        );
                    } else if (res.reason === 'unsupported') {
                        showToast('Notifiche non supportate su questo browser. Prova con Chrome, Firefox o Safari.');
                    } else {
                        showToast('Permesso non concesso.');
                    }
                }
            } else {
                showToast('Notifiche disattivate');
            }
        });

        // Tutorial toggle
        document.getElementById('settings-tutorial-toggle')?.addEventListener('change', (e) => {
            SoundEngine.playToggle(e.target.checked);
            import('./tutorial.js').then(m => m.Tutorial.setEnabled(e.target.checked));
            showToast(e.target.checked ? 'Tutorial attivo' : 'Tutorial disattivato');
        });

        // Reset tutorial
        document.getElementById('btn-tutorial-reset')?.addEventListener('click', async () => {
            const m = await import('./tutorial.js');
            m.Tutorial.resetAll();
            showToast('Tutorial ripristinato. Ricarica per rivederlo.');
        });

        // New pet (manual trigger from settings when pet is dead)
        document.getElementById('btn-new-pet')?.addEventListener('click', async () => {
            const { showRebirthScreen } = await import('../engine/game-loop.js');
            this.show('main');
            showRebirthScreen();
        });

        // Cloud logout
        document.getElementById('btn-cloud-logout')?.addEventListener('click', async () => {
            if (!(await showConfirm('Uscire dall\'account server? Il save resta salvato, potrai rientrare col PIN.'))) return;
            const { CloudSync } = await import('../engine/cloud-sync.js');
            CloudSync.logout();
            showToast('Uscito. Ricarico...');
            setTimeout(() => location.reload(), 1000);
        });

        document.getElementById('btn-graveyard-nav')?.addEventListener('click', () => this.show('graveyard'));
        document.getElementById('btn-lexicon-nav')?.addEventListener('click', () => this.show('lexicon'));
        document.getElementById('btn-diary-nav')?.addEventListener('click', () => this.show('diary'));
        document.getElementById('btn-manual-nav')?.addEventListener('click', () => { this._renderManual(); this.show('manual'); });
        document.getElementById('btn-manual-back')?.addEventListener('click', () => this.show('settings'));
    },

    async _renderSettings() {
        // Show logged-in username in account row
        try {
            const { CloudSync } = await import('../engine/cloud-sync.js');
            const nameEl = document.getElementById('settings-account-name');
            if (nameEl) {
                if (CloudSync.isLoggedIn()) {
                    const online = CloudSync.isOnline();
                    nameEl.textContent = CloudSync.getUsername() + (online ? ' · online' : ' · offline');
                    nameEl.style.color = online ? 'var(--cyan)' : 'var(--text-dim)';
                } else {
                    nameEl.textContent = 'Modalità locale';
                    nameEl.style.color = 'var(--text-dim)';
                }
            }
        } catch {}

        // Show "new pet" button only if pet is dead/buried
        const newBtn = document.getElementById('btn-new-pet');
        const farewellBtn = document.getElementById('btn-farewell');
        if (newBtn) newBtn.style.display = (!Pet.isAlive()) ? 'block' : 'none';
        if (farewellBtn) farewellBtn.style.display = Pet.isAlive() ? 'block' : 'none';

        const lang = localStorage.getItem('lalien_language') || 'it';
        document.getElementById('settings-language').value = lang;

        const provider = localStorage.getItem('lalien_provider') || 'anthropic';
        document.getElementById('settings-provider-select').value = provider;

        document.getElementById('settings-time-mult').value = String(GameState.timeMultiplier);

        // Activity status + reset
        try {
            const { Activity } = await import('../pet/activity.js');
            const box = document.getElementById('settings-activity-status');
            if (box) {
                const t = Activity.getType(Pet);
                const rem = Math.round(Activity.remainingMs(Pet) / 1000);
                box.textContent = rem > 0 ? `${t} (${rem}s rimasti)` : t;
            }
            const resetBtn = document.getElementById('btn-reset-activity');
            if (resetBtn && !resetBtn._wired) {
                resetBtn._wired = true;
                resetBtn.addEventListener('click', () => {
                    try { Activity._exit(Pet, 'manual-reset'); } catch (_) {}
                    Pet.activity = { type: 'IDLE', startedAt: Date.now(), endsAt: null, lastTickAt: Date.now(), data: {} };
                    showToast('Stato attività ripristinato a IDLE.');
                    Events.emit('pet-changed');
                    this._renderSettings();
                });
            }
        } catch (_) {}

        // Evolution status — show next-stage blockers if any
        try {
            const { Evolution } = await import('../pet/evolution.js');
            const evBox = document.getElementById('settings-evolution-status');
            if (evBox) {
                if (!Pet.isAlive()) {
                    evBox.innerHTML = '<span class="evo-dead">Il Lalìen non è più con noi.</span>';
                } else if (Pet.getStage() >= 7) {
                    evBox.innerHTML = '<span class="evo-done">Stadio trascendente raggiunto.</span>';
                } else {
                    const blockers = Evolution.getBlockers(
                        Pet.getStage(), Pet.getAgeHours(), Pet.needs,
                        Pet.touchInteractions || 0, Pet.voiceInteractions || 0,
                        Pet.vocabularySize || 0, Pet.conversations || 0, Pet.diaryEntries || 0
                    );
                    if (!blockers.length) {
                        evBox.innerHTML = '<span class="evo-ready">Pronto ad evolvere! Apparirà al prossimo tick.</span>';
                    } else {
                        evBox.innerHTML = '<ul class="evo-list">' + blockers.map(b =>
                            `<li><span class="evo-label">${b.label}</span><span class="evo-values"><b>${b.have}</b> / ${b.need}</span></li>`
                        ).join('') + '</ul>';
                    }
                }
            }
        } catch (e) { /* non-critical */ }

        const sfxEl = document.getElementById('settings-sfx-toggle');
        if (sfxEl) sfxEl.checked = SoundEngine.isEnabled();
        const ttsEl = document.getElementById('settings-tts-toggle');
        if (ttsEl) ttsEl.checked = localStorage.getItem('lalien_tts_enabled') !== '0';
        const tutEl = document.getElementById('settings-tutorial-toggle');
        if (tutEl) tutEl.checked = localStorage.getItem('lalien_tutorial_enabled') !== '0';
        const mindEl = document.getElementById('settings-mind-toggle');
        if (mindEl) {
            const { Mind } = await import('../pet/mind.js');
            mindEl.checked = Mind.isEnabled();
        }
        const notifEl = document.getElementById('settings-notif-toggle');
        if (notifEl) {
            const { Notifications } = await import('./notifications.js');
            notifEl.checked = Notifications.isEnabled() && Notifications.permission() === 'granted';
            if (Notifications.permission() === 'denied') {
                notifEl.disabled = true;
                notifEl.parentElement.title = 'Notifiche bloccate dal browser — attivale dalle impostazioni del sito';
            }
        }
    },

    // ---- Minigames ----
    _bindMinigames() {
        document.querySelectorAll('.btn-game-select').forEach(btn => {
            btn.addEventListener('click', () => {
                const game = btn.dataset.game;
                let type;
                switch (game) {
                    case 'echo': type = MiniGames.GameType.ECHO_MEMORY; break;
                    case 'clean': type = MiniGames.GameType.LIGHT_CLEANSING; break;
                    case 'star': type = MiniGames.GameType.STAR_JOY; break;
                    case 'tetris': type = MiniGames.GameType.TETRIS_KORA; break;
                    case 'pacman': type = MiniGames.GameType.PACMAN_LALI; break;
                }
                this._startMinigame(type);
            });
        });
    },

    _startMinigame(type) {
        // Play fatigue: track last N starts in a window; reject the 4th
        const WINDOW_MS = 10 * 60 * 1000;   // 10 min
        const now = Date.now();
        this._playLog = (this._playLog || []).filter(t => now - t < WINDOW_MS);
        if (this._playLog.length >= 3) {
            showToast('È troppo stanco per giocare ancora. Mettilo a riposare un po\'.');
            SpeechBubble.show('thi... moko... sha ven', 'sad', 2500);
            return;
        }
        this._playLog.push(now);
        // Progressive MOKO cost: 1st -3, 2nd -5, 3rd -8
        const costs = [3, 5, 8];
        const idx = Math.min(this._playLog.length - 1, costs.length - 1);
        Pet.needs[NeedType.MOKO] = Math.max(0, Pet.needs[NeedType.MOKO] - costs[idx]);

        MiniGames.startGame(type);
        this.show('minigame');

        const canvas = document.getElementById('minigame-canvas');
        const ctx = canvas.getContext('2d');
        const title = document.getElementById('minigame-title');
        const scoreEl = document.getElementById('minigame-score');

        const gameNames = {
            [MiniGames.GameType.ECHO_MEMORY]: 'Thishi-Revosh',
            [MiniGames.GameType.LIGHT_CLEANSING]: 'Miska-Vythi',
            [MiniGames.GameType.STAR_JOY]: 'Selath-Nashi',
        };
        title.textContent = gameNames[type] || 'Gioco';

        // Resize canvas
        canvas.width = canvas.offsetWidth || 800;
        canvas.height = canvas.offsetHeight || 400;

        let isDragging = false;
        let lastTouchPos = null;

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = ((e.clientX || e.touches?.[0]?.clientX || 0) - rect.left) * (800 / rect.width);
            const y = ((e.clientY || e.touches?.[0]?.clientY || 0) - rect.top) * (400 / rect.height);
            return { x, y };
        };

        const onDown = (e) => {
            e.preventDefault();
            isDragging = false;
            const pos = getPos(e);
            lastTouchPos = pos;
            MiniGames.handleTouch(pos.x, pos.y, false, 800, 400);
        };

        const onMove = (e) => {
            e.preventDefault();
            if (!lastTouchPos) return;
            isDragging = true;
            const pos = getPos(e);
            MiniGames.handleTouch(pos.x, pos.y, true, 800, 400);
        };

        const onUp = (e) => {
            e.preventDefault();
            lastTouchPos = null;
            isDragging = false;
        };

        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseup', onUp);
        canvas.addEventListener('touchstart', onDown, { passive: false });
        canvas.addEventListener('touchmove', onMove, { passive: false });
        canvas.addEventListener('touchend', onUp, { passive: false });

        // Keyboard input for Tetris / Pac-Man
        const onKey = (e) => {
            if (!MiniGames.isPlaying()) return;
            const consumed = MiniGames.handleKey(e);
            if (consumed) { e.preventDefault(); e.stopPropagation(); }
        };
        window.addEventListener('keydown', onKey);
        this._minigameKeyHandler = onKey;

        // Game loop
        const gameLoop = () => {
            if (!MiniGames.isPlaying() && !MiniGames.isGameOver()) return;

            MiniGames.update();
            MiniGames.render(ctx, canvas.width, canvas.height);
            scoreEl.textContent = MiniGames.getScore();

            if (MiniGames.isGameOver()) {
                // Show result briefly, then end
                setTimeout(() => {
                    const result = MiniGames.endGame();
                    if (result) {
                        Pet.applyGameResult(result);
                        DiaryGenerator.logMemory('play', `gioco completato, punteggio: ${result.score}`);
                        Events.emit('pet-changed');
                        showToast(`Punteggio: ${result.score}`);
                    }
                    // Clean up event listeners
                    canvas.removeEventListener('mousedown', onDown);
                    canvas.removeEventListener('mousemove', onMove);
                    canvas.removeEventListener('mouseup', onUp);
                    canvas.removeEventListener('touchstart', onDown);
                    canvas.removeEventListener('touchmove', onMove);
                    canvas.removeEventListener('touchend', onUp);
                    if (this._minigameKeyHandler) {
                        window.removeEventListener('keydown', this._minigameKeyHandler);
                        this._minigameKeyHandler = null;
                    }
                    this.show('main');
                }, 2000);
                return;
            }

            requestAnimationFrame(gameLoop);
        };
        requestAnimationFrame(gameLoop);
    },
};
