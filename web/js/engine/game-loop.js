/**
 * game-loop.js -- Main game loop and application bootstrap
 * requestAnimationFrame for rendering, setInterval for 1Hz logic
 */
import { Events } from './events.js';
import { Persistence } from './persistence.js';
import { Pet } from '../pet/pet.js';
import { Needs, NeedType } from '../pet/needs.js';
import { Evolution } from '../pet/evolution.js';
import { Death } from '../pet/death.js';
import { MiniGames } from '../pet/minigames.js';
import { Renderer } from '../ui/renderer.js';
import { Screens } from '../ui/screens.js';
import { SpeechBubble } from '../ui/speech-bubble.js';
import { StatusBar } from '../ui/status-bar.js';
import { I18n } from '../i18n/i18n.js';
import { AlienLexicon } from '../i18n/alien-lexicon.js';
import { LLMClient } from '../ai/llm-client.js';
import { SystemPrompt } from '../ai/system-prompt.js';
import { STTClient } from '../ai/stt-client.js';
import { DiaryGenerator } from '../ai/diary-generator.js';
import { CloudSync } from './cloud-sync.js';
import { Tutorial } from '../ui/tutorial.js';
import { SoundEngine } from '../audio/sound-engine.js';
import { Gestures } from '../ui/gestures.js';
import { Notifications } from '../ui/notifications.js';
import { Activity } from '../pet/activity.js';
import { Sentiment } from '../ai/sentiment.js';
import { Autonomy } from '../pet/autonomy.js';
import { Rhythms } from '../pet/rhythms.js';
import { Items } from './items.js';
import { Mind } from '../pet/mind.js';
import { Weather } from './weather.js';
import { Shelter } from '../ui/shelter.js';
import { SoloGames } from '../pet/solo-games.js';
import { Commands } from '../pet/commands.js';
import { Relics } from './relics.js';

// Re-export Events for backward compatibility
export { Events };

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
export const GameState = {
    currentScreen: 'main',     // main|egg|conversation|diary|settings|graveyard|lexicon|minigame|minigame-select
    initialized: false,
    timeMultiplier: 1,
    lastLogicTick: 0,
    paused: false,
    dirty: false,
    autoSaveTimer: 0,
};

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------
export function showToast(msg, duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    try { SoundEngine.playToast(); } catch (_) {}
    clearTimeout(el._timeout);
    el._timeout = setTimeout(() => el.classList.add('hidden'), duration);
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------
export function showConfirm(text) {
    return new Promise(resolve => {
        const dialog = document.getElementById('confirm-dialog');
        document.getElementById('confirm-text').textContent = text;
        dialog.classList.remove('hidden');
        const yes = document.getElementById('confirm-yes');
        const no = document.getElementById('confirm-no');
        const cleanup = () => {
            dialog.classList.add('hidden');
            yes.removeEventListener('click', onYes);
            no.removeEventListener('click', onNo);
        };
        const onYes = () => { cleanup(); resolve(true); };
        const onNo = () => { cleanup(); resolve(false); };
        yes.addEventListener('click', onYes);
        no.addEventListener('click', onNo);
    });
}

// ---------------------------------------------------------------------------
// Logic tick (1Hz)
// ---------------------------------------------------------------------------
function logicTick() {
    if (GameState.paused || !GameState.initialized) return;

    const wasBuried = Pet.buried;
    Pet.update(GameState.timeMultiplier);
    Items.tick(Pet, 1);
    // Shelter: if the pet has wandered inside the cave, grant sanctuary bonuses.
    try {
        const canvas = document.getElementById('game-canvas');
        if (canvas && Pet.isAlive && Pet.isAlive()) {
            const cx = (canvas.width  || 800) / 2 + ((Pet.motion && Pet.motion.offsetX) || 0);
            const cy = (canvas.height || 480) * 0.82 - 30 - (Pet.stage || 0) * 5;
            Shelter.tick(Pet, cx, cy, GameState.timeMultiplier);
        }
    } catch (_) {}
    StatusBar.update();
    updateActionUrgency();

    // Rebirth: when burial completes, show the new seed screen (once)
    if (!wasBuried && Pet.buried) {
        setTimeout(() => showRebirthScreen(), 2500);
    }

    // Auto-save every 60 logic ticks (~ 60s at 1x). Save unconditionally
    // so the persisted Pet.lastRealTimestamp is never more than ~60s stale
    // — otherwise a short browser close would be interpreted as an absence.
    GameState.autoSaveTimer++;
    if (GameState.autoSaveTimer >= 60) {
        GameState.autoSaveTimer = 0;
        const wasDirty = GameState.dirty;
        GameState.dirty = false;
        Persistence.savePet(Pet.serialize());
        // Cloud push only when state actually changed (saves bandwidth).
        if (wasDirty) {
            Persistence.exportSaveObj().then(data => {
                setCloudStatus('syncing');
                CloudSync.push(data);
                setTimeout(() => setCloudStatus(CloudSync.isOnline() ? 'synced' : 'offline'), 4000);
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
function renderLoop() {
    requestAnimationFrame(renderLoop);
    if (!GameState.initialized) return;

    Renderer.render(Pet, GameState);

    if (MiniGames.isPlaying()) {
        MiniGames.renderUpdate();
    }
}

// ---------------------------------------------------------------------------
// Resize handler
// ---------------------------------------------------------------------------
function handleResize() {
    const canvas = document.getElementById('game-canvas');
    const statusBar = document.getElementById('status-bar');
    const statusH = statusBar ? statusBar.offsetHeight : 48;
    const actionBar = document.getElementById('action-bar');
    const actionH = (actionBar && actionBar.offsetParent !== null) ? actionBar.offsetHeight : 0;
    // Reserve space for chat bar + hotbar at the bottom
    const chatBar = document.getElementById('chat-bar');
    const chatBarH = (chatBar && chatBar.offsetParent !== null) ? chatBar.offsetHeight : 0;
    const hotbar = document.getElementById('hotbar');
    const hotbarH = (hotbar && hotbar.offsetParent !== null) ? hotbar.offsetHeight : 0;
    const bottomH = Math.max(chatBarH + hotbarH + 16, 120);
    const availH = window.innerHeight - statusH - actionH - bottomH;
    const availW = window.innerWidth;

    // Fill available space entirely — no fixed aspect ratio
    const w = availW;
    const h = availH;

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.top = statusH + 'px';

    Renderer.setScale(1, 1);
}

// ---------------------------------------------------------------------------
// Cloud sync UI helpers
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Offline catch-up — shared by visibilitychange (tab switch) and init
// (full browser close). Needs decay at a reduced rate while the keeper is
// away so a few hours off doesn't obliterate the pet, and ticks in 5-minute
// game-time chunks so HEALTH / pathological timers progress realistically.
// ---------------------------------------------------------------------------
const OFFLINE_RATE_DEFAULT = 0.4;   // needs decay at 40% while keeper is away
const REAL_CAP_SEC   = 30 * 24 * 3600;   // 30 days of real time max
const DECAY_CAP_SEC  = 18 * 3600;         // cap decay at 18 game hours

function catchUpAfterAbsence() {
    if (!Pet.isAlive || !Pet.isAlive()) return 0;
    const nowMs = Date.now();
    const last  = Pet.lastRealTimestamp || nowMs;
    const elapsedMs = Math.max(0, nowMs - last);
    if (elapsedMs < 60 * 1000) { Pet.lastRealTimestamp = nowMs; return 0; }

    // IMPORTANT: when the app is in background or fully closed, time ALWAYS
    // flows at 1x — regardless of the live time-multiplier the keeper has
    // set. The multiplier is a "fast-forward while I'm watching" tool, not
    // a licence to warp time offline. So a 10-second browser close at 3600×
    // produces 10 seconds of decay, not 10 hours.
    const elapsedReal = Math.min(Math.floor(elapsedMs / 1000), REAL_CAP_SEC);
    const elapsedGame = elapsedReal;
    if (elapsedGame <= 0) { Pet.lastRealTimestamp = nowMs; return 0; }

    // Age always accumulates in full (no rate reduction) — lifetime marches on.
    Pet.ageSeconds += elapsedGame;

    // Eggs don't decay; they just age.
    if (Pet.stage > 0) {
        const decaySeconds = Math.min(elapsedGame, DECAY_CAP_SEC);
        Needs.catchUp(Pet.needs, decaySeconds, Pet.stage, OFFLINE_RATE_DEFAULT, Pet.vocabularySize || 0);
    }

    Pet.lastRealTimestamp = nowMs;
    Events.emit('pet-changed');
    return Math.floor(elapsedMs / 60000);  // return minutes away
}

function setCloudStatus(state) { // 'synced' | 'syncing' | 'offline'
    const el = document.getElementById('status-cloud');
    if (!el) return;
    el.className = state;
    el.title = state === 'synced'  ? 'Server sincronizzato' :
               state === 'syncing' ? 'Sincronizzazione…'  : 'Server offline (salvataggio locale)';
}

async function cloudPushAll() {
    setCloudStatus('syncing');
    const data = await Persistence.exportSaveObj();
    // include API key hint (not the key itself)
    const pushed = await CloudSync.pushNow(data);
    setCloudStatus(pushed ? 'synced' : 'offline');
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
    // Boot sound engine (AudioContext created lazily on first gesture)
    SoundEngine.init();
    // Extra: resume audio on page visibility regain (Safari PWA often suspends)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { try { SoundEngine.resume(); } catch (_) {} }
    });
    window.addEventListener('pageshow', () => { try { SoundEngine.resume(); } catch (_) {} });

    // Restore time multiplier
    const savedMult = parseInt(localStorage.getItem('lalien_time_mult') || '1');
    if (savedMult > 1) GameState.timeMultiplier = savedMult;

    // Load i18n
    const savedLang = localStorage.getItem('lalien_language') || 'it';
    await I18n.load(savedLang);

    // Load alien lexicon
    await AlienLexicon.load();

    // Init persistence
    await Persistence.init();

    // ---- Login / Cloud sync ----
    const cloudStatus = await CloudSync.init();
    if (!cloudStatus.loggedIn) {
        // Show login screen — init resumes after login
        showLoginScreen();
        return;
    }
    await resumeAfterLogin(cloudStatus.online);
}

async function resumeAfterLogin(serverOnline) {
    // Try pull from server first
    if (serverOnline) {
        try {
            const remote = await CloudSync.pull();
            if (remote && remote.pet) {
                await Persistence.importSaveObj(remote);
                setCloudStatus('synced');
            }
        } catch (e) {
            console.warn('[LALIEN] Cloud pull failed:', e);
            setCloudStatus('offline');
        }
    } else {
        setCloudStatus('offline');
    }

    // Check if first run
    const saved = await Persistence.loadPet();
    if (!saved) {
        // Show setup wizard
        Screens.showSetup();
        GameState.initialized = true;
        handleResize();
        requestAnimationFrame(renderLoop);
        setInterval(logicTick, 1000);
        window.addEventListener('resize', handleResize);
        bindSetupWizard();
        return;
    }

    // Restore pet state
    Pet.deserialize(saved);

    // Init LLM client
    const provider = localStorage.getItem('lalien_provider') || 'anthropic';
    const apiKey = await LLMClient.loadApiKey();
    if (apiKey) {
        LLMClient.init(provider, apiKey);
    }

    // Init STT
    const sttKey = localStorage.getItem('lalien_stt_key_enc');
    if (sttKey) {
        STTClient.init();
    }

    // Load diary, memories, vocabulary
    const diaryData = await Persistence.loadDiary();
    DiaryGenerator.restore(diaryData || []);

    const vocabData = await Persistence.loadVocabulary();
    AlienLexicon.restoreDiscovered(vocabData || []);

    const memoryData = await Persistence.loadMemories();
    DiaryGenerator.restoreMemories(memoryData || []);

    GameState.initialized = true;
    StatusBar.init();
    StatusBar.update();
    Screens.init();
    handleResize();

    // Start cosmic ambient drone for the current stage (skipped if reduced-motion)
    setTimeout(() => SoundEngine.startAmbient(Pet.getStage ? Pet.getStage() : 0), 400);

    // Tutorial: boot and fire 'start' trigger
    Tutorial.init();
    setTimeout(() => Tutorial.trigger('start'), 600);

    // Natural gestures: drag-to-action + shake-to-play
    Gestures.init();

    // Local OS notifications for urgent needs (fires only when tab is hidden)
    Notifications.init();

    // Autonomous behavior: spontaneous speech, motion, desires
    Autonomy.init();

    // Circadian rhythm + dream generation during long sleep
    Rhythms.init();

    // Restore persisted items from localStorage
    Items._load();

    // LLM-driven inner life — higher cognition scaled with stage
    Mind.init();

    // Real-world weather (if OWM API key is configured)
    Weather.init();

    // Solo mini-games the pet plays by itself when bored
    SoloGames.init();

    // Keepsakes (sogni, polaroid, pietre, costellazioni)
    Relics.init();

    // Inline chat bar — send message from main screen
    const chatInput = document.getElementById('chat-input');
    const chatSend  = document.getElementById('chat-send');
    const chatMic   = document.getElementById('chat-mic');
    const sendInlineChat = async () => {
        const text = chatInput?.value.trim();
        if (!text) return;
        chatInput.value = '';
        // Show user message as a toast briefly
        showToast(`Tu: ${text.slice(0, 60)}`, 2500);
        // Sentiment analysis
        const sent = Sentiment.analyze(text);
        if (sent.confidence > 0.15) {
            const mag = sent.score * sent.confidence;
            Pet.needs[NeedType.NASHI] = Math.max(0, Math.min(100, Pet.needs[NeedType.NASHI] + mag * 6));
            Pet.needs[NeedType.AFFECTION] = Math.max(0, Math.min(100, Pet.needs[NeedType.AFFECTION] + mag * 5));
            if (sent.bucket === 'negative') {
                Pet.needs[NeedType.SECURITY] = Math.max(0, Pet.needs[NeedType.SECURITY] + mag * 3);
                if (sent.score < -0.55 && sent.confidence > 0.5 && Activity.getType(Pet) === 'IDLE') {
                    Activity.start(Pet, Activity.Type.SULKY, { reason: 'harsh-words' });
                }
            }
        }
        // Vocabulary bidirectional
        AlienLexicon.discoverFromText(text, 'keeper');

        // Pet decides whether to obey the keeper's command and actually does
        // it (hop, dance, sleep, eat, etc.) or refuses based on mood & needs.
        let cmdResult = { handled: false };
        try { cmdResult = await Commands.interpret(text); } catch (e) { console.warn('[cmd]', e); }
        if (cmdResult.handled) {
            SpeechBubble.show(cmdResult.reply, cmdResult.executed ? 'happy' : Pet.getMood(), 3500);
            Events.emit('pet-changed');
            Pet.addConversation();
            return;
        }

        // Command recognition: if keeper tells pet to do something with items, force it
        const lower = text.toLowerCase();
        if (/prendi|mangia|raccogli|vai.*palla|vai.*mela|vai.*gioc|usa|take|eat|grab/i.test(lower)) {
            const allItems = Items.getAll();
            if (allItems.length > 0) {
                // Find best matching item from the command
                let target = allItems[0];
                if (/palla|ball/i.test(lower)) target = allItems.find(i => i.action === 'ball') || target;
                if (/mela|cibo|food|mangia|eat/i.test(lower)) target = allItems.find(i => i.action === 'feed') || target;
                if (/gioc|toy|play/i.test(lower)) target = allItems.find(i => i.action === 'play') || target;
                if (/puzzle/i.test(lower)) target = allItems.find(i => i.action === 'puzzle') || target;
                if (/telesc|scope/i.test(lower)) target = allItems.find(i => i.action === 'explore') || target;
                if (/peluch|plush|orso/i.test(lower)) target = allItems.find(i => i.action === 'caress') || target;
                // Force pet to walk there
                if (Pet.motion && target) {
                    const worldCx = document.getElementById('game-canvas')?.width / 2 || 400;
                    Pet.motion.targetOffsetX = target.x - worldCx;
                    Pet._itemWalking = true;
                }
            }
        }
        // LLM call
        if (LLMClient.isAvailable && LLMClient.isAvailable()) {
            try {
                const prompt = SystemPrompt.build(sent);
                let response = await LLMClient.chat(prompt, text);
                // Sanitize: if LLM returned JSON instead of natural text, extract utterance
                if (response && response.includes('"action"')) {
                    try {
                        const j = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}');
                        response = j.utterance || j.question || j.thought || response.replace(/\{[^}]*\}/g, '').replace(/[{}"]/g, '').trim();
                    } catch (_) {
                        response = response.replace(/\{[^}]*\}/g, '').replace(/[{}"]/g, '').trim();
                    }
                }
                // Strip roleplay-style prose: stage directions "(leaning closer)",
                // action asterisks "*smiles*", tag prefixes "Syrma:", and
                // surrounding quotation marks.
                if (response) {
                    response = response
                        .replace(/\([^)]*\)/g, '')          // (leaning closer)
                        .replace(/\*[^*]+\*/g, '')           // *smiles softly*
                        .replace(/^\s*[A-Z][a-zA-Zàèéìòù'\- ]{0,20}:\s*/, '')  // "Syrma:" / "Lalien:"
                        .replace(/\s+/g, ' ')
                        .trim()
                        .replace(/^["'«»“”‘’]+|["'«»“”‘’]+$/g, '')  // wrapping quotes
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    if (!response) response = 'thi...';
                }
                // While the pet is sleeping, the reply comes from inside the dream —
                // the pet does NOT wake, and cognition gain is halved.
                const dreaming = Activity.is(Pet, Activity.Type.SLEEPING);
                const bubbleMood = dreaming ? 'sleepy' : Pet.getMood();
                SpeechBubble.show(response, bubbleMood, dreaming ? 7000 : 5000,
                                  dreaming ? { fromDream: true } : {});
                if (dreaming) {
                    Pet.needs[NeedType.COGNITION] = Math.min(100, Pet.needs[NeedType.COGNITION] + 1);
                    Pet.needs[NeedType.AFFECTION] = Math.min(100, Pet.needs[NeedType.AFFECTION] + 0.5);
                } else {
                    Needs.talk(Pet.needs);
                }
                Pet.addConversation();
                DiaryGenerator.logMemory('conversation', text.slice(0, 50));
                await DiaryGenerator.onConversationEnd(response);
                Events.emit('pet-changed');
            } catch (e) {
                showToast('Errore: ' + e.message, 3000);
            }
        } else {
            SpeechBubble.show('...thi?', Pet.getMood(), 2000);
        }
    };
    chatSend?.addEventListener('click', sendInlineChat);
    chatInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendInlineChat(); });
    // Mic button → STT
    if (chatMic) {
        let recording = false;
        chatMic.addEventListener('click', async () => {
            if (recording) return;
            recording = true;
            chatMic.classList.add('recording');
            try {
                SoundEngine.playMicOpen && SoundEngine.playMicOpen();
                let text = null;
                // Try Web Speech Recognition API first (free, no key needed)
                const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (SpeechRec) {
                    text = await new Promise((resolve, reject) => {
                        const rec = new SpeechRec();
                        rec.lang = localStorage.getItem('lalien_language') || 'it-IT';
                        rec.interimResults = false;
                        rec.maxAlternatives = 1;
                        rec.onresult = (e) => resolve(e.results[0][0].transcript);
                        rec.onerror = (e) => reject(e.error);
                        rec.onend = () => resolve(null);
                        rec.start();
                        setTimeout(() => { try { rec.stop(); } catch(_){} }, 10000);
                    });
                } else {
                    // Fallback to STT Client (requires OpenAI key)
                    text = await STTClient.listen();
                }
                SoundEngine.playMicClose && SoundEngine.playMicClose();
                if (text) {
                    chatInput.value = text;
                    sendInlineChat();
                } else {
                    showToast('Non ho capito, riprova');
                }
            } catch (err) {
                const msg = typeof err === 'string' ? err : (err?.message || err?.error || '');
                if (/not-allowed|denied/i.test(msg)) {
                    showToast('Permesso microfono negato. Attivalo dalle impostazioni del browser.');
                } else if (/no-speech/i.test(msg)) {
                    showToast('Non ho sentito nulla, riprova');
                } else {
                    showToast('Microfono: ' + (msg || 'non disponibile'));
                }
            }
            recording = false;
            chatMic.classList.remove('recording');
        });
    }

    // Apply offline catch-up (chunked decay at reduced rate). Runs on
    // fresh page load / browser reopen — the visibilitychange handler
    // covers tab switches but not full app closures.
    const awayMinCaught = Pet.isAlive() ? catchUpAfterAbsence() : 0;

    // Retroactive simulation: if the keeper was away, ask the LLM what
    // the pet did while alone, then show a welcome-back sequence.
    if (Pet.isAlive() && !Pet.isEgg() && Pet.lastRealTimestamp) {
        const awayMs = Date.now() - Pet.lastRealTimestamp;
        const awayMin = awayMinCaught || awayMs / 60000;
        if (awayMin >= 10) {
            Mind.simulateAbsence(awayMin).then(result => {
                if (!result) return;
                // Show diary-style recap
                if (result.events && result.events.length) {
                    const lines = result.events.map(e => `${e.time}: ${e.action}`).join('\n');
                    showToast(`📖 Mentre eri via (${Math.round(awayMin)} min):\n${result.events[0].action}`, 6000);
                    // Log a summary thought
                    DiaryGenerator.logMemory('absence_summary', `Il custode è stato via ${Math.round(awayMin)} minuti.`);
                }
                // Welcome-back greeting
                if (result.greeting) {
                    setTimeout(() => {
                        SpeechBubble.show(result.greeting, result.mood || 'happy', 5000);
                    }, 2000);
                }
            }).catch(() => {});
        }
    }

    // If pet is egg, show egg screen
    if (Pet.isEgg()) {
        GameState.currentScreen = 'egg';
    }

    // If pet is already dead+buried on load, show rebirth screen
    if (!Pet.isAlive() && Pet.buried) {
        setTimeout(() => showRebirthScreen(), 300);
    }

    requestAnimationFrame(renderLoop);
    setInterval(logicTick, 1000);
    window.addEventListener('resize', handleResize);

    // Bind action buttons
    bindActions();

    // Mark dirty on any pet state change
    Events.on('pet-changed', () => { GameState.dirty = true; });

    // Environment tap: firefly / sun / moon. Each gives a small, thematic
    // boost to the pet's needs and a sparkle on-screen.
    Events.on('environment-tap', async (ev) => {
        if (!ev) return;
        const clamp = (v) => Math.max(0, Math.min(100, v));
        const { Renderer } = await import('../ui/renderer.js').catch(() => ({}));
        if (ev.kind === 'firefly') {
            // Catch the firefly: curiosity + joy
            if (Renderer) {
                Renderer.catchFirefly(ev.id);
                Renderer.sparkleAt(ev.x, ev.y, 60);
            }
            if (Pet.isAlive && Pet.isAlive()) {
                Pet.needs[NeedType.CURIOSITY] = clamp(Pet.needs[NeedType.CURIOSITY] + 2);
                Pet.needs[NeedType.NASHI]     = clamp(Pet.needs[NeedType.NASHI]     + 1);
            }
            try { SoundEngine.playChirp && SoundEngine.playChirp(); } catch (_) {}
            showToast('Una lucciola risponde al tuo tocco...');
        } else if (ev.kind === 'sun') {
            // Warmth of the sun: cosmic + nashi
            if (Renderer) Renderer.sparkleAt(ev.x, ev.y, 45);
            if (Pet.isAlive && Pet.isAlive()) {
                Pet.needs[NeedType.COSMIC] = clamp(Pet.needs[NeedType.COSMIC] + 2);
                Pet.needs[NeedType.NASHI]  = clamp(Pet.needs[NeedType.NASHI]  + 3);
            }
            try { SoundEngine.playSuccess && SoundEngine.playSuccess(); } catch (_) {}
            showToast('Un raggio di sole ti scalda il viso. Il pet sorride.');
        } else if (ev.kind === 'moon') {
            // Quiet companionship of the moon: cosmic + security
            if (Renderer) Renderer.sparkleAt(ev.x, ev.y, 220);
            if (Pet.isAlive && Pet.isAlive()) {
                Pet.needs[NeedType.COSMIC]   = clamp(Pet.needs[NeedType.COSMIC]   + 2);
                Pet.needs[NeedType.SECURITY] = clamp(Pet.needs[NeedType.SECURITY] + 3);
            }
            try { SoundEngine.playChirp && SoundEngine.playChirp(); } catch (_) {}
            showToast('La luna ascolta. Il Lalìen respira piano.');
        } else if (ev.kind === 'moth') {
            if (Renderer) {
                Renderer.scatterMoths();
                Renderer.sparkleAt(ev.x, ev.y, 300);
            }
            if (Pet.isAlive && Pet.isAlive()) {
                Pet.needs[NeedType.CURIOSITY] = clamp(Pet.needs[NeedType.CURIOSITY] + 3);
                Pet.needs[NeedType.NASHI]     = clamp(Pet.needs[NeedType.NASHI]     + 2);
            }
            // Soft swarm-chime
            try {
                const ctx = SoundEngine.getAudioContext && SoundEngine.getAudioContext();
                const master = SoundEngine.getMasterBus && SoundEngine.getMasterBus();
                if (ctx && master) {
                    const t = ctx.currentTime;
                    [880, 1174, 1760].forEach((hz, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.type = 'sine'; o.frequency.value = hz;
                        g.gain.setValueAtTime(0.0001, t + i * 0.03);
                        g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.03 + 0.008);
                        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.03 + 0.9);
                        o.connect(g).connect(master);
                        o.start(t + i * 0.03); o.stop(t + i * 0.03 + 1.0);
                    });
                }
            } catch (_) {}
            showToast('Uno stormo di farfalle-eco si disperde...');
        } else if (ev.kind === 'shooting-star') {
            if (Renderer) {
                Renderer.catchShootingStar();
                Renderer.sparkleAt(ev.x, ev.y, 50);
            }
            if (Pet.isAlive && Pet.isAlive()) {
                Pet.needs[NeedType.COSMIC]   = clamp(Pet.needs[NeedType.COSMIC]   + 5);
                Pet.needs[NeedType.NASHI]    = clamp(Pet.needs[NeedType.NASHI]    + 3);
                Pet.needs[NeedType.CURIOSITY]= clamp(Pet.needs[NeedType.CURIOSITY]+ 3);
            }
            try { SoundEngine.playSuccess && SoundEngine.playSuccess(); } catch (_) {}
            showToast('Hai preso una stella cadente. Il Lalìen vibra piano...');
        } else if (ev.kind === 'crystal') {
            // Each crystal rings with a pentatonic note derived from its hue
            if (Renderer) Renderer.sparkleAt(ev.x, ev.y, ev.hue || 180);
            if (Pet.isAlive && Pet.isAlive()) {
                Pet.needs[NeedType.COSMIC]    = clamp(Pet.needs[NeedType.COSMIC]    + 1);
                Pet.needs[NeedType.CURIOSITY] = clamp(Pet.needs[NeedType.CURIOSITY] + 1);
            }
            // Play a shimmering chime mapped from hue across a C pentatonic ladder
            try {
                const ctx = SoundEngine.getAudioContext && SoundEngine.getAudioContext();
                const master = SoundEngine.getMasterBus && SoundEngine.getMasterBus();
                if (ctx && master) {
                    const scale = [523.25, 587.33, 659.25, 784.00, 880.00, 1046.50, 1174.66];
                    const hz = scale[Math.floor(((ev.hue || 180) / 360) * scale.length) % scale.length];
                    const t = ctx.currentTime;
                    [1, 2, 3].forEach((mul, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.type = i === 0 ? 'sine' : 'triangle';
                        o.frequency.value = hz * mul;
                        const peak = [0.22, 0.06, 0.025][i];
                        g.gain.setValueAtTime(0.0001, t);
                        g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
                        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
                        o.connect(g).connect(master);
                        o.start(t); o.stop(t + 1.7);
                    });
                }
            } catch (_) {}
        }
        Events.emit('pet-changed');
    });

    // Cottage tap: the keeper reaches toward the shelter. Door sends the
    // pet in or out; window rouses a sleeping pet gently; body just greets.
    Events.on('shelter-tap', (ev) => {
        if (!Pet.isAlive || !Pet.isAlive()) return;
        if (Pet.isEgg && Pet.isEgg()) return;
        const canvas = document.getElementById('game-canvas');
        const w = canvas ? canvas.width : 800;
        const shelterOffset = Math.floor(w * 0.39);
        if (ev.region === 'door') {
            // Never move a sleeping pet just because the keeper tapped the door.
            if (Activity.is(Pet, Activity.Type.SLEEPING)) {
                showToast('Dorme. Bussi piano, ma non si sveglia.');
                SoundEngine.playClick && SoundEngine.playClick();
                return;
            }
            if (Pet._inShelter) {
                if (Pet.motion) Pet.motion.targetOffsetX = 0;
                showToast('Lo chiami fuori dalla casa...');
            } else {
                if (Pet.motion) Pet.motion.targetOffsetX = shelterOffset;
                showToast('Lo mandi verso la casetta...');
            }
            SoundEngine.playClick && SoundEngine.playClick();
        } else if (ev.region === 'window') {
            if (Activity.is(Pet, Activity.Type.SLEEPING)) {
                Activity._exit(Pet, 'interrupt');
                showToast('Bussi alla finestra. Si sveglia dolcemente.');
            } else {
                showToast('La luce della finestra ti accoglie.');
            }
            SoundEngine.playChirp && SoundEngine.playChirp();
        } else {
            // Body tap — cozy greeting
            Pet.needs[NeedType.SECURITY] = Math.min(100, Pet.needs[NeedType.SECURITY] + 1);
            SoundEngine.playPoke && SoundEngine.playPoke();
        }
        Events.emit('pet-changed');
    });

    // Lexicon → pet needs: every newly discovered alien word gives a small
    // burst (the spark of shared language) and updates Pet.vocabularySize so
    // the passive "wisdom" decay multiplier takes effect on the next tick.
    Events.on('lexicon-word-discovered', (ev) => {
        if (!Pet.isAlive || !Pet.isAlive() || Pet.isEgg()) return;
        const clamp = (v) => Math.max(0, Math.min(100, v));
        // Burst — source 'keeper' means the keeper taught it (gift = deeper
        // affection). source 'pet' means the pet discovered it in its own
        // utterance (pride, curiosity).
        const fromKeeper = ev && ev.source === 'keeper';
        Pet.needs[NeedType.COGNITION] = clamp(Pet.needs[NeedType.COGNITION] + 5);
        Pet.needs[NeedType.CURIOSITY] = clamp(Pet.needs[NeedType.CURIOSITY] + 3);
        Pet.needs[NeedType.AFFECTION] = clamp(Pet.needs[NeedType.AFFECTION] + (fromKeeper ? 3 : 2));
        Pet.needs[NeedType.NASHI]     = clamp(Pet.needs[NeedType.NASHI] + 2);
        // Keep Pet.vocabularySize in sync so decay uses the new count now.
        Pet.vocabularySize = (ev && ev.total) || Pet.vocabularySize + 1;
        // Tiny celebration cue
        try { SoundEngine.playChirp && SoundEngine.playChirp(); } catch (_) {}
        Events.emit('pet-changed');
    });

    console.log('[LALIEN] Initialized. Stage:', Pet.getStageName(),
                'Age:', Pet.getAgeHours(), 'h');
}

// ---------------------------------------------------------------------------
// Action button bindings
// ---------------------------------------------------------------------------
function bindActions() {
    document.querySelectorAll('.btn-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            handleAction(action);
        });
    });

    // Settings gear in the top status bar (primary entry point now that
    // the bottom action bar is hidden).
    document.getElementById('btn-status-settings')?.addEventListener('click', () => {
        handleAction('settings');
    });

    // Needs overlay
    document.getElementById('btn-needs-expand')?.addEventListener('click', () => {
        StatusBar.toggleNeedsOverlay();
    });
    document.querySelector('[data-close="needs-overlay"]')?.addEventListener('click', () => {
        document.getElementById('needs-overlay').classList.add('hidden');
    });

    // Canvas interactions via Interactions module (poke + pet gestures)
    // Egg touch is now handled by the 'pet-poke' event
    Events.on('pet-poke', () => {
        if (!Pet.isAlive()) return;
        if (Pet.isEgg()) {
            Pet.addTouchInteraction();
            SpeechBubble.show('...', 'neutral', 1000);
            Events.emit('pet-changed');
        } else {
            // Poke the hatched creature
            Pet.addTouchInteraction();
            const phrases = ['ko!', 'nashi?', 'thi!', 'kè?', 'la-ko!', 'shà!'];
            const phrase = phrases[Math.floor(Math.random() * phrases.length)];
            SpeechBubble.show(phrase, Pet.getMood(), 1500);
            Events.emit('pet-changed');
        }
    });

    // Long-press on pet → open needs overlay
    Events.on('pet-longpress', () => {
        StatusBar.toggleNeedsOverlay();
    });

    Events.on('pet-pet', (data) => {
        if (!Pet.isAlive() || Pet.isEgg()) return;
        // Petting gesture detected: boost affection
        Needs.caress(Pet.needs);
        Pet.addTouchInteraction();
        const phrases = ['la-shi... ♪', 'kesma thi ♥', 'mmm... vythì...', 'ko-shi thi!'];
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        SpeechBubble.show(phrase, 'happy', 2500);
        DiaryGenerator.logMemory('caress', 'accarezzato dal custode');
        Events.emit('pet-changed');
    });

    // Setup wizard
    bindSetupWizard();
}

function handleAction(action) {
    // Tutorial: first action fires 'first-action'
    Tutorial.trigger('first-action');

    if (!Pet.isAlive() && action !== 'settings') {
        showToast(I18n.get('msg_death'));
        return;
    }
    if (Pet.isEgg() && action !== 'settings') {
        showToast(I18n.get('egg_waiting'));
        return;
    }

    // Activity gate — sleeping/eating may reject or interrupt
    const verdict = Activity.onAction(Pet, action);
    if (!verdict.accept) {
        if (verdict.reason) showToast(verdict.reason);
        if (verdict.woke) {
            SoundEngine.playPoke();
            SpeechBubble.show('sha... moko?', Pet.getMood(), 2000);
            Events.emit('pet-changed');
        }
        return;
    }

    // Dev-friendly: log gating info when feed is attempted
    if (action === 'feed') {
        const act = Activity.getType(Pet);
        const kora = Math.round(Pet.needs[NeedType.KORA]);
        console.log('[feed] activity=', act, 'KORA=', kora);
    }

    switch (action) {
        case 'feed':
            // Overfeed guard: reject when already very full
            if (Pet.needs[NeedType.KORA] > 90) {
                const pct = Math.round(Pet.needs[NeedType.KORA]);
                SpeechBubble.show('ko sha... shai', 'neutral', 1800);
                showToast(`Non ha fame — kòra al ${pct}%. Aspetta che si svuoti un po'.`);
                return;
            }
            Activity.start(Pet, Activity.Type.EATING);
            SoundEngine.playFeed();
            SpeechBubble.show('ko-ra... thi!', Pet.getMood(), 2000);
            Pet.recordAction(1);
            DiaryGenerator.logMemory('feed', 'nutrito dal custode');
            Events.emit('pet-changed');
            break;
        case 'sleep':
            Activity.start(Pet, Activity.Type.SLEEPING);
            SoundEngine.playSleep();
            SpeechBubble.show('mo-ko... thi...', Pet.getMood(), 2000);
            Pet.recordAction(2);
            DiaryGenerator.logMemory('sleep', 'si è addormentato');
            Events.emit('pet-changed');
            break;
        case 'clean':
            Needs.clean(Pet.needs);
            SoundEngine.playClean();
            SpeechBubble.show('mi-ska thi!', Pet.getMood(), 2000);
            Pet.recordAction(3);
            DiaryGenerator.logMemory('clean', 'pulito con cura');
            Events.emit('pet-changed');
            break;
        case 'play':
            SoundEngine.playClick();
            Screens.show('minigame-select');
            break;
        case 'talk':
            SoundEngine.playTalk();
            Screens.show('conversation');
            break;
        case 'caress':
            Needs.caress(Pet.needs);
            SoundEngine.playCaress(4);
            SpeechBubble.show('la-shi... kesma thi', Pet.getMood(), 2500);
            Pet.recordAction(6);
            Pet.addTouchInteraction();
            DiaryGenerator.logMemory('caress', 'accarezzato dal custode');
            Events.emit('pet-changed');
            break;
        case 'meditate':
            if (Pet.getStage() < 6) {
                showToast('Meditazione non disponibile: deve crescere ancora.');
                return;
            }
            Activity.start(Pet, Activity.Type.MEDITATING);
            SoundEngine.playMeditate();
            SpeechBubble.show('selath... vythi...', Pet.getMood(), 3000);
            Pet.recordAction(7);
            DiaryGenerator.logMemory('meditate', 'meditazione cosmica');
            Events.emit('pet-changed');
            break;
        case 'settings':
            SoundEngine.playClick();
            Screens.show('settings');
            break;
    }
}

// ---------------------------------------------------------------------------
// Action button urgency (highlight buttons based on critical needs)
// ---------------------------------------------------------------------------
function updateActionUrgency() {
    const alive = Pet.isAlive();
    const egg   = Pet.isEgg();
    const stage = Pet.getStage();
    let anyCritical = false;
    // Hide COSMIC chip before stage 6 (meditation is dormant)
    const cosmicChip = document.querySelector('#status-needs-dots .need-chip[data-action="meditate"]');
    if (cosmicChip) cosmicChip.classList.toggle('hidden', stage < 6);
    // Count critical needs (for sound alert). Chips already visualize
    // their own level via status-bar.js; no per-button class mutation needed.
    if (alive && !egg) {
        const skipCosmic = stage < 6;
        for (let i = 0; i < Pet.needs.length; i++) {
            if (skipCosmic && i === 8) continue;  // COSMIC dormant
            if (Pet.needs[i] < 20) { anyCritical = true; break; }
        }
    }
    // Critical-need ambient alert: subtle recurring pulse when anything is < 20
    if (alive && !egg && anyCritical) {
        if (!updateActionUrgency._critOn) {
            updateActionUrgency._critOn = true;
            SoundEngine.startCriticalAlert(14);
        }
    } else if (updateActionUrgency._critOn) {
        updateActionUrgency._critOn = false;
        SoundEngine.stopCriticalAlert();
    }
}

// ---------------------------------------------------------------------------
// Global event -> sound bindings
// ---------------------------------------------------------------------------
Events.on('evolution', (data) => {
    const from = data?.from ?? 0;
    const to = data?.to ?? 1;
    if (from === 0) {
        SoundEngine.playHatch();
    } else {
        SoundEngine.playEvolution(from, to);
    }
    // Celebratory laugh at every evolution (stage-appropriate)
    setTimeout(() => { try { SoundEngine.playLaugh(to); } catch (_) {} }, 800);
    // Crossfade ambient to new stage
    setTimeout(() => SoundEngine.startAmbient(to), 1200);
});

Events.on('death', (data) => {
    SoundEngine.stopAmbient(1.5);
    if (data?.type === 6 /* TRANSCENDENCE */) {
        SoundEngine.playTranscendence();
    } else {
        SoundEngine.playDeath(data?.type);
    }
});

Events.on('pet-poke', () => SoundEngine.playPoke());
Events.on('pet-pet',  () => SoundEngine.playCaress(1));

// Autonomy: unsolicited lines and fulfillment events
Events.on('autonomy-speak', (ev) => {
    if (!ev || !ev.line) return;
    // Pet emits a mood-aware chirp BEFORE the TTS line
    try { SoundEngine.playMoodChirp(Pet.getStage(), ev.mood || 'neutral'); } catch (_) {}
    // 'autonomy' priority — dropped if a chat reply is in progress.
    SpeechBubble.show(ev.line, ev.mood || 'neutral', 3000, { priority: 'autonomy' });
});
Events.on('autonomy-desire-fulfilled', (d) => {
    SpeechBubble.show('ko! thi custode… la-shi', 'happy', 2500);
    try { SoundEngine.playLaugh(Pet.getStage()); } catch (_) {}
    SoundEngine.playSuccess && SoundEngine.playSuccess();
});
Events.on('autonomy-desire-expire', () => {
    SpeechBubble.show('sha…', 'sad', 1500);
});
// Echòa dream: cosmic memory flash + diary + golden sparkles
Events.on('mind-echoa-dream', (ev) => {
    try {
        import('../ui/emotive-effects.js').then(m => {
            m.EmotiveEffects.flash('#D4A534', 0.4);
            m.EmotiveEffects.sparkles(400, 300, 10, '#FFE899');
        });
    } catch (_) {}
    if (ev && ev.thought) showToast('💫 ' + ev.thought, 7000);
});

// Circadian events
Events.on('rhythm-morning', () => {
    SpeechBubble.show('ko! kora thi la-la!', 'happy', 2500);
    showToast('Buongiorno! È di buon umore.');
});
Events.on('rhythm-nap', () => {
    SpeechBubble.show('moko... siesta...', 'sleepy', 2000);
    showToast('Sta facendo un pisolino.');
});
Events.on('rhythm-dream', (ev) => {
    const t = ev && ev.text ? ev.text : '…';
    showToast('💭 Ha sognato: ' + t, 6000);
});

// Activity lifecycle: speak a line on exit
Events.on('activity-end', (ev) => {
    if (!ev) return;
    const st = Pet.getStage();
    // Stop per-activity vocal loops
    SoundEngine.stopSnoreLoop && SoundEngine.stopSnoreLoop();
    SoundEngine.stopMunchLoop && SoundEngine.stopMunchLoop();
    SoundEngine.stopMeditateHumLoop && SoundEngine.stopMeditateHumLoop();
    SoundEngine.stopCoughLoop && SoundEngine.stopCoughLoop();
    SoundEngine.stopWhimperLoop && SoundEngine.stopWhimperLoop();
    SoundEngine.stopGrumbleLoop && SoundEngine.stopGrumbleLoop();

    if (ev.from === 'SLEEPING') {
        if (ev.grumpy) {
            SpeechBubble.show('sha... moko...', 'sad', 2500);
            try { SoundEngine.playGrumble(st); } catch (_) {}
        } else if (ev.reason === 'duration' || ev.reason === 'auto') {
            SpeechBubble.show('ko... thi, custode', 'happy', 2500);
            try { SoundEngine.playYay(st); } catch (_) {}
        }
    } else if (ev.from === 'EATING' && (ev.reason === 'duration' || ev.reason === 'auto')) {
        SpeechBubble.show('ko-ra... thi!', 'happy', 2000);
        try { SoundEngine.playYay(st); } catch (_) {}
    } else if (ev.from === 'MEDITATING' && (ev.reason === 'duration' || ev.reason === 'auto')) {
        SpeechBubble.show('selath... vythi... ko.', 'happy', 3000);
        try { SoundEngine.playMeditateHum(st); } catch (_) {}
    } else if (ev.from === 'SICK' && ev.reason === 'auto') {
        SpeechBubble.show('ko... thi. sto meglio.', 'happy', 2500);
        try { SoundEngine.playYay(st); } catch (_) {}
    } else if (ev.from === 'AFRAID' && ev.reason === 'auto') {
        SpeechBubble.show('sha... ko. grazie.', 'neutral', 2200);
        try { SoundEngine.playSigh(st); } catch (_) {}
    } else if (ev.from === 'SULKY' && ev.reason === 'duration') {
        SpeechBubble.show('lalí... custode', 'neutral', 2000);
        try { SoundEngine.playMoodChirp(st, 'neutral'); } catch (_) {}
    }
    Events.emit('pet-changed');
});
Events.on('activity-start', (ev) => {
    if (!ev) return;
    const st = Pet.getStage();
    if (ev.type === 'SLEEPING') {
        try { SoundEngine.playSleepYawn(st); } catch (_) {}
        setTimeout(() => SoundEngine.startSnoreLoop && SoundEngine.startSnoreLoop(st), 4000);
    } else if (ev.type === 'EATING') {
        try { SoundEngine.startMunchLoop && SoundEngine.startMunchLoop(st); } catch (_) {}
    } else if (ev.type === 'MEDITATING') {
        try { SoundEngine.startMeditateHumLoop && SoundEngine.startMeditateHumLoop(st); } catch (_) {}
    } else if (ev.type === 'SICK') {
        SpeechBubble.show('sha... moko... health sha', 'sad', 3000);
        try { SoundEngine.playCough(st); } catch (_) {}
        try { SoundEngine.startCoughLoop && SoundEngine.startCoughLoop(st); } catch (_) {}
    } else if (ev.type === 'AFRAID') {
        SpeechBubble.show('shai! sha-sha', 'scared', 2500);
        try { SoundEngine.playWhimper(st); } catch (_) {}
        try { SoundEngine.startWhimperLoop && SoundEngine.startWhimperLoop(st); } catch (_) {}
    } else if (ev.type === 'SULKY') {
        SpeechBubble.show('sha. thi sha.', 'sad', 2500);
        try { SoundEngine.playGrumble(st); } catch (_) {}
        try { SoundEngine.startGrumbleLoop && SoundEngine.startGrumbleLoop(st); } catch (_) {}
    }
});

// ---- Natural gestures → actions ----
Events.on('gesture-action', ({ action }) => handleAction(action));
Events.on('gesture-shake',  () => {
    if (!Pet.isAlive() || Pet.isEgg()) return;
    SoundEngine.playClick();
    handleAction('play');
});
Events.on('pet-scrub', () => {
    if (!Pet.isAlive() || Pet.isEgg()) return;
    handleAction('clean');
});

// ---------------------------------------------------------------------------
// Setup wizard logic
// ---------------------------------------------------------------------------
function bindSetupWizard() {
    let step = 0;
    let selectedLang = 'it';
    let selectedProvider = 'anthropic';

    const steps = document.querySelectorAll('.setup-step');
    const showStep = (n) => {
        steps.forEach(s => s.classList.add('hidden'));
        steps[n]?.classList.remove('hidden');
        step = n;
    };

    document.getElementById('btn-setup-start')?.addEventListener('click', () => showStep(1));

    document.querySelectorAll('.btn-lang').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedLang = btn.dataset.lang;
            document.querySelectorAll('.btn-lang').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            localStorage.setItem('lalien_language', selectedLang);
            I18n.load(selectedLang).then(() => Screens.updateLabels());
            showStep(2);
        });
    });

    document.querySelectorAll('.btn-provider').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedProvider = btn.dataset.provider;
            document.querySelectorAll('.btn-provider').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            localStorage.setItem('lalien_provider', selectedProvider);
        });
    });

    document.getElementById('btn-setup-next')?.addEventListener('click', () => showStep(3));

    document.getElementById('btn-setup-plant')?.addEventListener('click', async () => {
        const apiKey = document.getElementById('setup-api-key').value.trim();
        const sttKey = document.getElementById('setup-stt-key').value.trim();
        const petName = document.getElementById('setup-pet-name').value.trim();

        if (!apiKey) {
            showToast('API key required');
            return;
        }

        // Save API key (encrypted)
        await LLMClient.saveApiKey(apiKey);
        LLMClient.init(selectedProvider, apiKey);

        if (sttKey) {
            await LLMClient.saveKey('lalien_stt_key_enc', sttKey);
            STTClient.init();
        }

        // Create new pet
        Pet.initNew(petName);
        await Persistence.savePet(Pet.serialize());

        // Hide setup
        document.getElementById('screen-setup').classList.add('hidden');
        GameState.currentScreen = 'egg';

        StatusBar.init();
        StatusBar.update();
        Screens.init();
        bindActions();

        showToast(I18n.get('setup_success'));
    });
}

// ---------------------------------------------------------------------------
// Rebirth (new pet after death)
// ---------------------------------------------------------------------------
export function showRebirthScreen() {
    const screen = document.getElementById('screen-rebirth');
    if (!screen) return;

    // Compose epitaph from the dead pet
    const epEl = document.getElementById('rebirth-epitaph');
    if (epEl) {
        const name = Pet.getName() || 'Il Lalìen';
        const stage = Pet.getStageName();
        const days = Pet.getAgeDays();
        const words = (Pet.lastWords || '').trim();
        epEl.innerHTML = `«${name}» — ${stage}, ${days} giorni.` +
                         (words ? `<br><br>Ultime parole: <em>${words}</em>` : '');
    }

    const nameInput = document.getElementById('rebirth-name');
    if (nameInput) nameInput.value = '';
    screen.classList.remove('hidden');

    // Bind once (idempotent)
    const plantBtn = document.getElementById('btn-rebirth-plant');
    const graveBtn = document.getElementById('btn-rebirth-graveyard');
    if (plantBtn && !plantBtn._bound) {
        plantBtn._bound = true;
        plantBtn.addEventListener('click', async () => {
            const petName = (document.getElementById('rebirth-name').value || '').trim();
            await plantNewSeed(petName);
        });
    }
    if (graveBtn && !graveBtn._bound) {
        graveBtn._bound = true;
        graveBtn.addEventListener('click', () => {
            screen.classList.add('hidden');
            Screens.show('graveyard');
        });
    }
}

async function plantNewSeed(petName) {
    // Reset pet-specific state; KEEP graveyard, vocabulary, API keys, settings, cloud account
    SoundEngine.playRebirth();
    Pet.initNew(petName);

    // Reset pet-specific persisted data
    await Persistence.savePet(Pet.serialize());
    await Persistence.saveDiary([]);
    await Persistence.saveMemories([]);
    DiaryGenerator.restore([]);
    DiaryGenerator.restoreMemories([]);

    // Hide overlay
    document.getElementById('screen-rebirth')?.classList.add('hidden');

    // Force cloud push
    const data = await Persistence.exportSaveObj();
    CloudSync.pushNow(data).then(ok => setCloudStatus(ok ? 'synced' : 'offline'));

    GameState.currentScreen = 'egg';
    Events.emit('pet-changed');
    showToast(I18n.get('setup_success') || 'Un nuovo seme è piantato.');
}

function maybeShowRebirth() {
    if (!Pet.isAlive() && Pet.buried) {
        showRebirthScreen();
    }
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function showLoginScreen() {
    const screen = document.getElementById('screen-login');
    screen.classList.remove('hidden');

    const pinInput      = document.getElementById('login-pin');
    const usernameField = document.getElementById('login-username-field');
    const errorEl       = document.getElementById('login-error');
    const loadingEl     = document.getElementById('login-loading');
    const formEl        = document.getElementById('login-form');
    const btnLogin      = document.getElementById('btn-login');
    const btnOffline    = document.getElementById('btn-login-offline');
    const hintNew       = document.getElementById('login-hint-new');

    let isNewUser = false;

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    }
    function hideError() { errorEl.classList.add('hidden'); }

    // After 4 chars show "new user" hint if server online
    pinInput.addEventListener('input', () => {
        hideError();
        if (pinInput.value.length >= 4) {
            hintNew.style.display = 'block';
            usernameField.style.display = 'flex';
        }
    });

    pinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnLogin.click();
    });

    btnLogin.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        if (pin.length < 4) { showError('PIN troppo corto (min 4 cifre)'); return; }

        const username = document.getElementById('login-username').value.trim() || 'Custode';
        formEl.classList.add('hidden');
        loadingEl.classList.remove('hidden');

        try {
            const result = await CloudSync.login(pin, username);
            loadingEl.classList.add('hidden');
            screen.classList.add('hidden');
            SoundEngine.playLogin();
            showToast(result.is_new
                ? `Benvenuto, ${result.username}! Account creato.`
                : `Bentornato, ${result.username}!`);
            await resumeAfterLogin(true);
        } catch (e) {
            loadingEl.classList.add('hidden');
            formEl.classList.remove('hidden');
            showError('Errore connessione server: ' + e.message);
        }
    });

    btnOffline.addEventListener('click', async () => {
        screen.classList.add('hidden');
        setCloudStatus('offline');
        await resumeAfterLogin(false);
    });

    // Auto-focus PIN
    setTimeout(() => pinInput.focus(), 100);
}

// ---------------------------------------------------------------------------
// Visibility API — pause when hidden
// ---------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        GameState.paused = true;
        // Always save on hide so lastRealTimestamp reflects reality when the
        // keeper returns — otherwise the offline catch-up will pretend time
        // passed even if the browser was only closed for a few seconds.
        if (GameState.initialized) {
            Pet.lastRealTimestamp = Date.now();
            Persistence.savePet(Pet.serialize());
            GameState.dirty = false;
        }
    } else {
        GameState.paused = false;
        // Calculate elapsed real time and advance game time.
        // Two separate caps:
        //   - Age always accumulates (up to 30 real days — enough for a long vacation)
        //   - Needs decay is capped to 24 game hours, so a week away doesn't instakill
        if (GameState.initialized && Pet.isAlive()) {
            catchUpAfterAbsence();
        }
    }
});

// pagehide fires reliably on full browser close / tab kill / iOS Safari
// background. Mirror the hide-path save so the timestamp is fresh.
window.addEventListener('pagehide', () => {
    if (GameState.initialized) {
        Pet.lastRealTimestamp = Date.now();
        try { Persistence.savePet(Pet.serialize()); } catch (_) {}
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
init().catch(err => {
    console.error('[LALIEN] Init failed:', err);
    showToast('Initialization error. Check console.');
});
