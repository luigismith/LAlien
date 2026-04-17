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

    // Auto-save every 60 logic ticks (~ 60s at 1x)
    GameState.autoSaveTimer++;
    if (GameState.autoSaveTimer >= 60 && GameState.dirty) {
        GameState.autoSaveTimer = 0;
        GameState.dirty = false;
        Persistence.savePet(Pet.serialize());
        // Cloud push (debounced 3s inside CloudSync)
        Persistence.exportSaveObj().then(data => {
            setCloudStatus('syncing');
            CloudSync.push(data);
            setTimeout(() => setCloudStatus(CloudSync.isOnline() ? 'synced' : 'offline'), 4000);
        });
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
                // While the pet is sleeping, the reply comes from inside the dream —
                // the pet does NOT wake, and cognition gain is halved.
                const dreaming = Activity.is(Pet, Activity.Type.SLEEPING);
                const bubbleMood = dreaming ? 'sleepy' : Pet.getMood();
                SpeechBubble.show(response, bubbleMood, dreaming ? 7000 : 5000);
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

    // Retroactive simulation: if the keeper was away, ask the LLM what
    // the pet did while alone, then show a welcome-back sequence.
    if (Pet.isAlive() && !Pet.isEgg() && Pet.lastRealTimestamp) {
        const awayMs = Date.now() - Pet.lastRealTimestamp;
        const awayMin = awayMs / 60000;
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
            if (Pet.needs[NeedType.KORA] > 85) {
                SpeechBubble.show('ko sha... shai', 'neutral', 1800);
                showToast('Ne ha avuto abbastanza per ora.');
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
    SpeechBubble.show(ev.line, ev.mood || 'neutral', 3000);
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
        // Save on hide
        if (GameState.dirty && GameState.initialized) {
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
            const now = Date.now();
            const lastSave = Pet.lastRealTimestamp || now;
            const elapsedMs = Math.max(0, now - lastSave);
            const REAL_CAP_SEC  = 30 * 24 * 3600;   // 30 days of real time max
            const DECAY_CAP_SEC = 24 * 3600;        // at most 24 game hours of decay
            const elapsedReal = Math.min(Math.floor(elapsedMs / 1000), REAL_CAP_SEC);
            const elapsedGameSeconds = Math.floor(elapsedReal * GameState.timeMultiplier);
            if (elapsedGameSeconds > 0) {
                // Age advances in full
                Pet.ageSeconds += elapsedGameSeconds;
                // Decay applies in a single call with the cumulative multiplier
                const decayAmount = Math.min(elapsedGameSeconds, DECAY_CAP_SEC);
                Needs.decay(Pet.needs, decayAmount, Pet.stage);
                Pet.lastRealTimestamp = now;
                Events.emit('pet-changed');
            }
        }
    }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
init().catch(err => {
    console.error('[LALIEN] Init failed:', err);
    showToast('Initialization error. Check console.');
});
