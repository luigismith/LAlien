/**
 * mind.js -- LLM-driven inner life for the pet
 *
 * Periodically builds a rich context snapshot of the pet's state and asks
 * the configured LLM to decide what the pet WANTS to do next — not just
 * which bank phrase to pick. The response is parsed as JSON and drives
 * speech, movement, activity changes, desires, etc.
 *
 * Intelligence scales with evolution stage:
 *   stages 0-1 : Mind is DORMANT (falls back to bank autonomy)
 *   stage  2   : Mind ticks every 15 min, simple 1-4 word utterances
 *   stage  3   : Mind ticks every 12 min, short phrases + basic desires
 *   stage  4   : Mind ticks every 10 min, longer phrases, requests
 *   stage  5   : Mind ticks every  8 min, adult thoughts, preferences
 *   stage  6   : Mind ticks every  6 min, wise observations
 *   stage  7   : Mind ticks every  4 min, mystic introspection
 *
 * Budget: max 1 call per interval. Silent fallback when LLM unavailable,
 * during SLEEPING/MEDITATING (the pet is not verbal then), or when
 * the keeper disabled AI-mind in settings.
 */
import { Pet } from './pet.js';
import { NeedType, NEED_NAMES } from './needs.js';
import { Activity } from './activity.js';
import { Events } from '../engine/events.js';
import { LLMClient } from '../ai/llm-client.js';
import { DiaryGenerator } from '../ai/diary-generator.js';
import { AlienLexicon } from '../i18n/alien-lexicon.js';
import { Items } from '../engine/items.js';

const LS_ENABLED = 'lalien_mind_enabled';

// Stage → check interval (ms). Dormant under stage 2.
const INTERVAL_FOR_STAGE = [
    0, 0,             // 0-1: dormant
    15 * 60 * 1000,   // 2
    12 * 60 * 1000,   // 3
    10 * 60 * 1000,   // 4
     8 * 60 * 1000,   // 5
     6 * 60 * 1000,   // 6
     4 * 60 * 1000,   // 7
];

let _lastThoughtAt = 0;
let _tickHandle = null;
let _pending = false;

function isEnabled() {
    const raw = localStorage.getItem(LS_ENABLED);
    if (raw === null) return true;   // default ON if not explicitly off
    return raw === '1';
}
function setEnabled(v) { localStorage.setItem(LS_ENABLED, v ? '1' : '0'); }

function buildContext() {
    const n = Pet.needs;
    const ago = (ms) => {
        if (!ms) return 'unknown';
        const mins = Math.floor((Date.now() - ms) / 60000);
        return mins < 1 ? 'just now' : `${mins} min ago`;
    };
    const itemsInScene = (Items.getAll() || []).map(it => {
        const def = Items.ITEM_TYPES[it.action];
        return { kind: def?.kind || it.action, icon: def?.icon || '•' };
    });
    const memories = DiaryGenerator.getRecentMemories
        ? DiaryGenerator.getRecentMemories(5).map(m => `${m.type}: ${m.text}`)
        : [];
    const hour = new Date().getHours();
    const timeLabel = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
    const vocabCount = AlienLexicon.getDiscoveredCount ? AlienLexicon.getDiscoveredCount() : 0;

    return {
        name: Pet.getName ? Pet.getName() : '',
        stage: Pet.stage,
        stageName: Pet.getStageName ? Pet.getStageName() : '',
        ageMin: Pet.getAgeMinutes ? Pet.getAgeMinutes() : Math.floor((Pet.ageSeconds || 0) / 60),
        activity: Activity.getType(Pet),
        mood: Pet.getMood ? Pet.getMood() : 'neutral',
        needs: {
            hunger: Math.round(n[NeedType.KORA]),
            sleep: Math.round(n[NeedType.MOKO]),
            hygiene: Math.round(n[NeedType.MISKA]),
            happiness: Math.round(n[NeedType.NASHI]),
            health: Math.round(n[NeedType.HEALTH]),
            mind: Math.round(n[NeedType.COGNITION]),
            affection: Math.round(n[NeedType.AFFECTION]),
            curiosity: Math.round(n[NeedType.CURIOSITY]),
            cosmic: Math.round(n[NeedType.COSMIC]),
            security: Math.round(n[NeedType.SECURITY]),
        },
        time_of_day: timeLabel,
        local_hour: hour,
        vocabulary_size: vocabCount,
        items_in_scene: itemsInScene,
        recent_memories: memories,
    };
}

function systemForStage(stage) {
    const core = `You are the INNER MIND of a Lalìen named "${Pet.getName() || 'unnamed'}". `
        + `You are NOT chatting with the keeper — you are thinking to YOURSELF about what to do next.\n\n`
        + `RESPOND WITH JSON ONLY, this exact shape:\n`
        + `{"action":"idle|speak|wander|walk_to_item|request|nap|meditate",`
        + `"utterance":"(short alien phrase, optional)",`
        + `"item_kind":"food|toy|plush|media|ball|puzzle|crystal (optional, only with walk_to_item)",`
        + `"want":"food|play|talk|caress|clean|sleep (optional, only with action=request)",`
        + `"mood":"happy|neutral|sad|scared|hungry|sleepy|dirty|bored|curious|lonely|sulky|sick"}\n\n`
        + `Rules:\n`
        + `- utterance: use ONLY alien words (ko, sha, thi, moko, kora, lali, kesma, selath, ven, nashi, vy, mmm). No keeper language.\n`
        + `- Pick action based on your CURRENT NEEDS and desires. Don't always speak. Sometimes just idle, sometimes nap, sometimes move.\n`
        + `- If a need is low (<30), consider action=request for that need. If an item in scene matches, prefer walk_to_item.\n`
        + `- Be CONSISTENT with your stage. Your name is "${Pet.getName() || 'unnamed'}".\n`;

    // Add stage-specific voice rules
    const stageRules = [
        '', '',
        'You are a cub. Utterances <= 3 alien words. Short and curious.',
        'You are a child. Utterances <= 5 alien words. Express wonder and simple desires.',
        'You are a teen. Utterances <= 7 alien words. Show some thought and preference.',
        'You are adult. Utterances <= 9 alien words. Reflective, nuanced.',
        'You are an elder. Utterances <= 8 alien words. Wise, spare, observational.',
        'You are transcendent. Utterances <= 6 alien words. Poetic, fragmentary, like a farewell song.',
    ];
    return core + (stageRules[stage] || '');
}

function parseThought(text) {
    if (!text) return null;
    // Extract JSON from raw LLM output (sometimes wrapped in ```json...```)
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
        const o = JSON.parse(m[0]);
        if (typeof o !== 'object') return null;
        return o;
    } catch (_) { return null; }
}

async function tickOnce() {
    if (_pending) return;
    if (!isEnabled()) return;
    if (!LLMClient.isAvailable || !LLMClient.isAvailable()) return;
    if (!Pet || !Pet.isAlive || !Pet.isAlive()) return;
    if (Pet.isEgg()) return;

    const stage = Pet.stage;
    const interval = INTERVAL_FOR_STAGE[stage] || 0;
    if (!interval) return;  // dormant

    if (Date.now() - _lastThoughtAt < interval) return;

    // Skip during silent activities
    const act = Activity.getType(Pet);
    if (act === 'SLEEPING' || act === 'MEDITATING' || act === 'SICK') return;

    _pending = true;
    _lastThoughtAt = Date.now();
    try {
        const ctx = buildContext();
        const userBlock = 'Context:\n' + JSON.stringify(ctx, null, 2) + '\n\nWhat do you do next? Respond with JSON only.';
        const raw = await LLMClient.chat(systemForStage(stage), userBlock);
        const thought = parseThought(raw);
        if (thought) executeThought(thought);
    } catch (_) {
        /* silent fallback to bank autonomy */
    } finally {
        _pending = false;
    }
}

function executeThought(t) {
    const mood = t.mood || 'neutral';
    switch (t.action) {
        case 'speak':
            if (t.utterance) {
                Events.emit('autonomy-speak', { line: t.utterance, mood, fromMind: true });
            }
            break;
        case 'wander':
            Events.emit('mind-wander');
            break;
        case 'walk_to_item':
            // Items module already auto-targets; we can nudge the preference by
            // boosting the matched item's priority. Soft implementation: just
            // speak the want, so the renderer shows it.
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood });
            break;
        case 'request':
            if (t.want) {
                const iconMap = { food: '🍎', play: '🎮', talk: '📻', caress: '🫂', clean: '🧼', sleep: '💤' };
                const label = { food: 'Ha fame', play: 'Voglio giocare', talk: 'Parliamo?', caress: 'Una coccola?', clean: 'Mi sento sporco', sleep: 'Voglio dormire' }[t.want] || 'Ha bisogno di te';
                Events.emit('autonomy-desire', {
                    icon: iconMap[t.want] || '❔',
                    need: NeedType.AFFECTION,
                    label,
                    at: Date.now(),
                    expiresAt: Date.now() + 90 * 1000,
                    fromMind: true,
                });
                if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood });
            }
            break;
        case 'nap':
            // Only nap if MOKO actually low
            if (Pet.needs[NeedType.MOKO] < 60) {
                try { Activity.start(Pet, 'SLEEPING', { fromMind: true }); } catch (_) {}
            } else if (t.utterance) {
                Events.emit('autonomy-speak', { line: t.utterance, mood: 'sleepy' });
            }
            break;
        case 'meditate':
            if (Pet.stage >= 6) {
                try { Activity.start(Pet, 'MEDITATING', { fromMind: true }); } catch (_) {}
            }
            break;
        case 'idle':
        default:
            // Just log an optional utterance
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood });
            break;
    }
}

export const Mind = {
    init() {
        if (_tickHandle) clearInterval(_tickHandle);
        // Check every 60s whether to call; actual LLM call throttled by interval
        _tickHandle = setInterval(() => tickOnce(), 60 * 1000);
    },
    tickNow() { return tickOnce(); },
    isEnabled,
    setEnabled,
    intervalForStage: (s) => INTERVAL_FOR_STAGE[s] || 0,
};
