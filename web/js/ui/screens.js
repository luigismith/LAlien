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

            // Thinking indicator
            this._addMessage(Pet.getName() + ' ' + I18n.get('chat_thinking'), 'system');
            SoundEngine.playThinking();

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
        const div = document.createElement('div');
        div.className = `msg msg-${type}`;
        div.textContent = text;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
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

        // TTS toggle
        document.getElementById('settings-tts-toggle')?.addEventListener('change', (e) => {
            SoundEngine.playToggle(e.target.checked);
            import('./speech-bubble.js').then(m => m.SpeechBubble.setTTSEnabled(e.target.checked));
            showToast(e.target.checked ? 'Voce attivata' : 'Voce disattivata');
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
                        showToast('Permesso negato. Attiva le notifiche dalle impostazioni del browser.');
                    } else if (res.reason === 'unsupported') {
                        showToast('Notifiche non supportate su questo browser.');
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
                }
                this._startMinigame(type);
            });
        });
    },

    _startMinigame(type) {
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
            MiniGames.handleTouch(pos.x, pos.y, false);
        };

        const onMove = (e) => {
            e.preventDefault();
            if (!lastTouchPos) return;
            isDragging = true;
            const pos = getPos(e);
            MiniGames.handleTouch(pos.x, pos.y, true);
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
                    this.show('main');
                }, 2000);
                return;
            }

            requestAnimationFrame(gameLoop);
        };
        requestAnimationFrame(gameLoop);
    },
};
