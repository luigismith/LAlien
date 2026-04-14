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

    Pet.update(GameState.timeMultiplier);
    StatusBar.update();

    // Auto-save every 60 logic ticks (~ 60s at 1x)
    GameState.autoSaveTimer++;
    if (GameState.autoSaveTimer >= 60 && GameState.dirty) {
        GameState.autoSaveTimer = 0;
        GameState.dirty = false;
        Persistence.savePet(Pet.serialize());
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
    const actionH = 70;
    const availH = window.innerHeight - statusH - actionH;
    const availW = window.innerWidth;
    const aspect = 800 / 480;
    let w, h;
    if (availW / availH > aspect) {
        h = availH;
        w = h * aspect;
    } else {
        w = availW;
        h = w / aspect;
    }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    Renderer.setScale(w / 800, h / 480);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
    // Load i18n
    const savedLang = localStorage.getItem('lalien_language') || 'it';
    await I18n.load(savedLang);

    // Load alien lexicon
    await AlienLexicon.load();

    // Init persistence
    await Persistence.init();

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

    // If pet is egg, show egg screen
    if (Pet.isEgg()) {
        GameState.currentScreen = 'egg';
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

    // Canvas click (for egg touching)
    document.getElementById('game-canvas').addEventListener('click', (e) => {
        if (Pet.isEgg() && Pet.isAlive()) {
            Pet.addTouchInteraction();
            SpeechBubble.show('...', 'neutral', 1000);
            Events.emit('pet-changed');
        }
    });

    // Setup wizard
    bindSetupWizard();
}

function handleAction(action) {
    if (!Pet.isAlive()) {
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
            SpeechBubble.show('ko-ra... thi!', Pet.getMood(), 2000);
            Pet.recordAction(1);
            DiaryGenerator.logMemory('feed', 'nutrito dal custode');
            Events.emit('pet-changed');
            break;
        case 'sleep':
            Needs.sleep(Pet.needs);
            SpeechBubble.show('mo-ko...', Pet.getMood(), 2000);
            Pet.recordAction(2);
            DiaryGenerator.logMemory('sleep', 'messo a dormire');
            Events.emit('pet-changed');
            break;
        case 'clean':
            Needs.clean(Pet.needs);
            SpeechBubble.show('mi-ska thi!', Pet.getMood(), 2000);
            Pet.recordAction(3);
            DiaryGenerator.logMemory('clean', 'pulito con cura');
            Events.emit('pet-changed');
            break;
        case 'play':
            Screens.show('minigame-select');
            break;
        case 'talk':
            Screens.show('conversation');
            break;
        case 'caress':
            Needs.caress(Pet.needs);
            SpeechBubble.show('la-shi... kesma thi', Pet.getMood(), 2500);
            Pet.recordAction(6);
            Pet.addTouchInteraction();
            DiaryGenerator.logMemory('caress', 'accarezzato dal custode');
            Events.emit('pet-changed');
            break;
        case 'meditate':
            Needs.meditate(Pet.needs, Pet.getStage());
            SpeechBubble.show('selath... vythi...', Pet.getMood(), 3000);
            Pet.recordAction(7);
            DiaryGenerator.logMemory('meditate', 'meditazione cosmica');
            Events.emit('pet-changed');
            break;
        case 'settings':
            Screens.show('settings');
            break;
    }
}

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
