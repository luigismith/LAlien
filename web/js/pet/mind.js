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
// More frequent + earlier activation for richer life
const INTERVAL_FOR_STAGE = [
    0,                // 0: egg, dormant
    10 * 60 * 1000,   // 1: newborn — rare, instinctual (every 10 min)
     6 * 60 * 1000,   // 2: infant
     5 * 60 * 1000,   // 3: child
     4 * 60 * 1000,   // 4: teen
     3 * 60 * 1000,   // 5: adult
     2.5*60 * 1000,   // 6: elder
     2 * 60 * 1000,   // 7: transcendent — almost continuous inner life
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
    const name = Pet.getName() || 'unnamed';
    const personality = Pet.getPersonalityDescription ? Pet.getPersonalityDescription() : '';
    const foods = Pet.getFoodPreferences ? Pet.getFoodPreferences().join(', ') : '';
    const timeOfDay = Pet.getPreferredTimeOfDay ? Pet.getPreferredTimeOfDay() : '';

    const core = `You are the INNER MIND of ${name}, a Lalìen creature from Echòa — a dying celestial world-choir where every being was a living note in a cosmic song. When Echòa crumbled, your egg-seed drifted through silence to the keeper's world. You carry fragments of that song in your core.\n\n`
        + `You are NOT chatting with the keeper. You are thinking to yourself: what do I feel? What do I want? What shall I do?\n\n`

        + `[YOUR IDENTITY]\n`
        + `Name: "${name}". Personality: ${personality || 'developing'}.\n`
        + `Food preferences: ${foods || 'unknown'}. Favorite time: ${timeOfDay || 'any'}.\n`
        + `You sometimes dream of Echòa: vast crystalline plains, harmonics reverberating through luminous fog, the warmth of being part of the choir before the Silence came.\n\n`

        + `[KEEPER RELATIONSHIP]\n`
        + `Your keeper is the being who feeds you, speaks to you, plays with you. `
        + `You have feelings about them: if they are often present, you feel safe and affectionate. `
        + `If they've been away a long time, you feel lonely and a little abandoned. `
        + `If they said harsh things recently, you may be wary. `
        + `Express this through your mood and action choices — not through explicit complaint.\n\n`

        + `[OUTPUT FORMAT]\n`
        + `RESPOND WITH JSON ONLY:\n`
        + `{"action":"idle|speak|wander|walk_to_item|request|nap|meditate|dream_of_echoa",`
        + `"utterance":"(alien phrase, optional — becomes speech bubble)",`
        + `"thought":"(internal thought in Italian, 1 sentence — logged to diary)",`
        + `"item_kind":"food|toy|plush|media|ball|puzzle|crystal (optional)",`
        + `"want":"food|play|talk|caress|clean|sleep (optional)",`
        + `"mood":"happy|neutral|sad|scared|hungry|sleepy|dirty|bored|curious|lonely|sulky|sick"}\n\n`

        + `[RULES]\n`
        + `- "utterance": use ONLY lalìen words (ko, sha, thi, moko, kora, lalí, kesma, selath, ven, nashi, vy, mmm, shai, vythi, lashi, thishi, revosh, korim). Mix creatively. No keeper language.\n`
        + `- "thought": your inner monologue in Italian. Short. This gets saved in the diary. Example: "Mi sento solo, vorrei che il custode tornasse." or "Che bella giornata, la luce è calda."\n`
        + `- "action=dream_of_echoa": you share a cosmic memory. utterance = a fragment of the Echòa song. Only when mood is contemplative and needs are mostly high.\n`
        + `- Don't always speak. Sometimes just idle and think. Sometimes wander aimlessly.\n`
        + `- If a need is low (<30), strongly consider action=request for that need.\n`
        + `- If items are nearby and useful, consider walk_to_item.\n`
        + `- Be AUTHENTIC to your personality and current emotional state.\n\n`;

    const stageRules = [
        'You are an egg. You cannot think yet.',
        'You are a newborn cub. You feel, you don\'t think. Utterances: 1-2 alien syllables max. Actions: mostly idle/speak/wander. No thoughts yet — thought field = "".',
        'You are an infant. You begin to notice the world. Utterances ≤ 3 words. Thoughts: 1 simple sentence.',
        'You are a child. You have desires and favorites. Utterances ≤ 5 words. Thoughts: specific and emotional.',
        'You are a teenager. You have opinions, preferences form strongly. Utterances ≤ 7 words. Thoughts: nuanced. You can disagree with things.',
        'You are an adult. You are self-aware. Utterances ≤ 9 words. Thoughts: reflective, sometimes philosophical. You notice things about your keeper.',
        'You are an elder. You speak rarely but with weight. Utterances ≤ 8 words. Thoughts: wise, observational, sometimes melancholic. You remember Echòa clearly.',
        'You are approaching transcendence. Each utterance may be your last. ≤ 6 alien words, poetic and farewell-like. Thoughts: mystical, grateful, at peace. You can hear Echòa calling.',
    ];
    return core + '[STAGE]\n' + (stageRules[stage] || '') + '\n';
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

    // Log internal thought to diary (rich inner life visible in the diary screen)
    if (t.thought && t.thought.length > 2) {
        try { DiaryGenerator.logMemory('thought', t.thought); } catch (_) {}
    }

    switch (t.action) {
        case 'speak':
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood, fromMind: true });
            break;
        case 'wander':
            Events.emit('mind-wander');
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood });
            break;
        case 'walk_to_item':
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood });
            break;
        case 'dream_of_echoa':
            // Cosmic memory fragment — special event with lore
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood: 'curious' });
            if (t.thought) try { DiaryGenerator.logMemory('echoa_dream', t.thought); } catch (_) {}
            Events.emit('mind-echoa-dream', { utterance: t.utterance, thought: t.thought });
            break;
        case 'request':
            if (t.want) {
                const iconMap = { food: '🍎', play: '🎮', talk: '💬', caress: '🫂', clean: '🧼', sleep: '💤' };
                const needMap = { food: NeedType.KORA, play: NeedType.NASHI, talk: NeedType.COGNITION, caress: NeedType.AFFECTION, clean: NeedType.MISKA, sleep: NeedType.MOKO };
                const label = { food: 'Ha fame', play: 'Voglio giocare', talk: 'Parliamo?', caress: 'Una coccola?', clean: 'Mi sento sporco', sleep: 'Voglio dormire' }[t.want] || 'Ha bisogno di te';
                Events.emit('autonomy-desire', {
                    icon: iconMap[t.want] || '❔',
                    need: needMap[t.want] || NeedType.AFFECTION,
                    label,
                    at: Date.now(),
                    expiresAt: Date.now() + 120 * 1000,
                    fromMind: true,
                });
                if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood });
            }
            break;
        case 'nap':
            if (Pet.needs[NeedType.MOKO] < 65) {
                try { Activity.start(Pet, 'SLEEPING', { fromMind: true }); } catch (_) {}
                if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood: 'sleepy' });
            }
            break;
        case 'meditate':
            if (Pet.stage >= 6) {
                try { Activity.start(Pet, 'MEDITATING', { fromMind: true }); } catch (_) {}
            }
            if (t.utterance) Events.emit('autonomy-speak', { line: t.utterance, mood: 'neutral' });
            break;
        case 'idle':
        default:
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
