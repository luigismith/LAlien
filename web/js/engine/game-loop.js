/**
 * game-loop.js -- Main game loop and application bootstrap
 * requestAnimationFrame for rendering, setInterval for 1Hz logic
 */
import { Events } from './events.js';
import { Persistence } from './persistence.js';
import { Pet } from '../pet/pet.js';
import { Needs } from '../pet/needs.js';
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
    const statusH = 40;
    const actionBar = document.getElementById('action-bar');
    const actionH = actionBar ? actionBar.offsetHeight : 70;
    const availH = window.innerHeight - statusH - actionH;
    const availW = window.innerWidth;

    // Fill available space entirely — no fixed aspect ratio
    const w = availW;
    const h = availH;

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

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

    // Needs overlay
    document.getElementById('btn-needs-expand').addEventListener('click', () => {
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

    switch (action) {
        case 'feed':
            Needs.feed(Pet.needs);
            SoundEngine.playFeed();
            SpeechBubble.show('ko-ra... thi!', Pet.getMood(), 2000);
            Pet.recordAction(1);
            DiaryGenerator.logMemory('feed', 'nutrito dal custode');
            Events.emit('pet-changed');
            break;
        case 'sleep':
            Needs.sleep(Pet.needs);
            SoundEngine.playSleep();
            SpeechBubble.show('mo-ko...', Pet.getMood(), 2000);
            Pet.recordAction(2);
            DiaryGenerator.logMemory('sleep', 'messo a dormire');
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
            Needs.meditate(Pet.needs, Pet.getStage());
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
const ACTION_NEED_MAP = [
    ['btn-feed',     [0]],          // KORA - hunger
    ['btn-sleep',    [1]],          // MOKO - rest
    ['btn-clean',    [2]],          // MISKA - hygiene
    ['btn-play',     [3, 7]],       // NASHI + CURIOSITY
    ['btn-talk',     [5, 7]],       // COGNITION + CURIOSITY
    ['btn-caress',   [6, 9]],       // AFFECTION + SECURITY
    ['btn-meditate', [8]],          // COSMIC
];

function updateActionUrgency() {
    const alive = Pet.isAlive();
    const egg   = Pet.isEgg();
    let anyCritical = false;
    for (const [id, indices] of ACTION_NEED_MAP) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.classList.remove('urgent', 'low', 'satisfied');
        if (!alive || egg) continue;
        const minVal = Math.min(...indices.map(i => Pet.needs[i]));
        if (minVal < 20)      { btn.classList.add('urgent'); anyCritical = true; }
        else if (minVal < 40) btn.classList.add('low');
        else if (minVal > 70) btn.classList.add('satisfied');
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
        // Calculate elapsed real time and advance game time
        if (GameState.initialized && Pet.isAlive()) {
            const now = Date.now();
            const lastSave = Pet.lastRealTimestamp || now;
            const elapsedMs = now - lastSave;
            const elapsedGameSeconds = Math.floor((elapsedMs / 1000) * GameState.timeMultiplier);
            if (elapsedGameSeconds > 0 && elapsedGameSeconds < 86400) {
                // Fast-forward needs decay (cap at 24h)
                for (let i = 0; i < Math.min(elapsedGameSeconds, 3600); i++) {
                    Needs.decay(Pet.needs, 1);
                    Pet.ageSeconds++;
                }
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
