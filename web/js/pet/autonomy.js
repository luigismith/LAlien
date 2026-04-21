/**
 * autonomy.js -- Spontaneous initiatives from the pet
 *
 * Every few seconds the pet may decide to:
 *   - say something unprompted (mood-appropriate alien phrase)
 *   - move (idle hop, wiggle, lean towards cursor, body-rhythm)
 *   - express a desire (thought bubble with an icon)
 *
 * Movement is exposed as a live `Pet.motion` object the renderer lerps
 * toward its target each frame. All timing uses REAL seconds.
 */
import { Pet } from './pet.js';
import { NeedType } from './needs.js';
import { Activity } from './activity.js';
import { Events } from '../engine/events.js';
import { Weather } from '../engine/weather.js';

const CHECK_INTERVAL_MS = 6 * 1000;
// Base gaps (modulated by personality)
const BASE_GAP_SPEAK_MS   = 22 * 1000;
const BASE_GAP_MOVE_MS    = 4 * 1000;
const BASE_GAP_DESIRE_MS  = 90 * 1000;
const BASE_GAP_TEACH_MS   = 5 * 60 * 1000;   // teach a word every ~5 min at most
const BASE_GAP_NIGHT_MS   = 8 * 60 * 1000;
const LONELINESS_MS       = 2 * 60 * 1000;   // 2 min no interaction = sad chirp

let _lastSpeakAt  = 0;
let _lastMoveAt   = 0;
let _lastDesireAt = 0;
let _lastTeachAt  = 0;
let _lastNightInviteAt = 0;
let _lastLonelyFireAt = 0;
let _lastKeeperInteraction = Date.now();
let _tickHandle   = null;
let _currentDesire = null;

// ---------------------------------------------------------------------------
// Mood-keyed alien phrases (stage-agnostic, readable on stages 1+)
// ---------------------------------------------------------------------------
const PHRASES = {
    // NOTE: non-hungry banks must NOT contain `kora`/`ven-kora` — those mean
    // "hunger/want food" in lalien and reading them when the pet is actually
    // sated breaks the keeper's trust in the simulation.
    happy:   ['la-shi thi!', 'thi-thi la-la!', 'selath… kesma!', 'ko! ko thi!', 'thi-thi la-shi', 'shi shi ko!', 'kesma-thi lalí!', 'ven-thi lalí!'],
    neutral: ['lalí…', 'shi thi', 'shi… thi.', 'mmh… la-shi', 'ko ko', 'thi…', 'shi-la.', 'lalí-ven.', 'ko. shi. thi.'],
    sad:     ['sha… lalí', 'moko… thi', 'kesma sha', 'thi… ven…', 'sha-sha… lalí', 'kora sha ven…'],
    scared:  ['shai! sha-sha', 'ven-thi… sha', 'kèsma?! shi-shi', 'shai… lalí custode', 'sha-sha… sha!'],
    hungry:  ['kora… kora?', 'ko… kora sha', 'lalí: kora thi', 'shi… kora sha thi', 'kora sha ven!', 'ven-kora?'],
    sleepy:  ['moko… moko thi', 'Zzz… lalí', 'shi… moko sha-la', 'moko-ven thi…', 'ko sha moko'],
    dirty:   ['miska sha!', 'vyth-thi miska', 'sha… miska sha', 'miska-sha!', 'ven-miska!'],
    bored:   ['shi-thi?', 'la-shi ven?', 'mmh… shi', 'ven? ven-la?', 'thi… sha-la.'],
    curious: ['la-la? thi?', 'shai? kesma?', 'shai-thi?', 'ven? ven-la?', 'thi? la-shi?', 'mmh… shai?'],
    lonely:  ['kesma… lalí?', 'custode? custode?', 'thi sha… lalí', 'ven-thi? custode…', 'lalí solo… sha'],
    evening: ['selath… sha. moko ven…', 'thi… moko sha-la.', 'ven-ora moko? sha-sha.', 'kèsma. moko thi.'],
    sing:    ['la-la-la shi', 'mo-ko-la-la', 'thi-la-thi-la', 'shi-shi-la ven'],
};

// Teaching moments — pet utters an alien word it knows, keeper reads it (goes in TTS)
const TEACHABLE_SNIPPETS = [
    { word: 'kora',   line: 'kora… kora. ko-ra. (fame)' },
    { word: 'moko',   line: 'moko thi. mo-ko. (sonno)' },
    { word: 'miska',  line: 'miska… pulizia. miska.' },
    { word: 'nashi',  line: 'nashi = felicità. nashi-thi.' },
    { word: 'kesma',  line: 'kesma… carezza. ke-sma.' },
    { word: 'selath', line: 'selath. cosmico. selath-thi.' },
    { word: 'ven',    line: 'ven = voglio. ven-kora.' },
    { word: 'sha',    line: 'sha… no. sha-sha.' },
    { word: 'thi',    line: 'thi = sì. thi-thi!' },
    { word: 'ko',     line: 'ko! ko ko. (va bene!)' },
    { word: 'lalí',   line: 'lalí sono io. la-lí!' },
];

const DESIRE_ICONS = {
    play:    { icon: '🎮', need: NeedType.NASHI,     label: 'Voglio giocare' },
    talk:    { icon: '💬', need: NeedType.COGNITION, label: 'Parliamo?' },
    caress:  { icon: '🫂', need: NeedType.AFFECTION, label: 'Una coccola?' },
    feed:    { icon: '🍎', need: NeedType.KORA,      label: 'Ho fame' },
    sleep:   { icon: '💤', need: NeedType.MOKO,      label: 'Sto crollando' },
    clean:   { icon: '💧', need: NeedType.MISKA,     label: 'Mi sento sporco' },
    explore: { icon: '✨', need: NeedType.CURIOSITY, label: 'Qualcosa di nuovo?' },
};

// ---------------------------------------------------------------------------
function pickMood() {
    const n = Pet.needs;
    if (Activity.is(Pet, Activity.Type.SLEEPING)) return 'sleepy';
    if (n[NeedType.SECURITY] < 20) return 'scared';
    if (n[NeedType.KORA] < 25)     return 'hungry';
    if (n[NeedType.MOKO] < 25)     return 'sleepy';
    if (n[NeedType.MISKA] < 25)    return 'dirty';
    if (n[NeedType.AFFECTION] < 25) return 'lonely';
    if (n[NeedType.NASHI] < 30)    return 'bored';
    if (n[NeedType.CURIOSITY] < 30) return 'bored';
    const avg = (n[NeedType.NASHI] + n[NeedType.AFFECTION] + n[NeedType.HEALTH]) / 3;
    if (avg < 40) return 'sad';
    if (avg > 75) return 'happy';
    if (n[NeedType.CURIOSITY] > 70) return 'curious';
    return 'neutral';
}

function pickLine(mood) {
    const bank = PHRASES[mood] || PHRASES.neutral;
    return bank[Math.floor(Math.random() * bank.length)];
}

function pickDesire() {
    // Desire is the most under-satisfied actionable need, within 30-65% range
    const n = Pet.needs;
    const candidates = [
        { k: 'feed',    v: n[NeedType.KORA] },
        { k: 'sleep',   v: n[NeedType.MOKO] },
        { k: 'clean',   v: n[NeedType.MISKA] },
        { k: 'play',    v: n[NeedType.NASHI] },
        { k: 'talk',    v: n[NeedType.COGNITION] },
        { k: 'caress',  v: n[NeedType.AFFECTION] },
        { k: 'explore', v: n[NeedType.CURIOSITY] },
    ].filter(c => c.v < 65 && c.v > 15);  // only when mid-range: not dying, not full
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.v - b.v);
    const pick = candidates[0];
    return DESIRE_ICONS[pick.k] || null;
}

// ---------------------------------------------------------------------------
// Motion — Pet.motion is set here, Renderer reads it
// ---------------------------------------------------------------------------
function ensureMotion() {
    if (!Pet.motion) {
        Pet.motion = {
            offsetX: 0, offsetY: 0,
            targetOffsetX: 0, targetOffsetY: 0,
            scaleBoost: 0, targetScaleBoost: 0,
            bob: 0,                   // continuous breathing / bob
            mood: 'neutral',
        };
    }
}

function wantsShelter() {
    // AFRAID → always seek shelter; real rain/snow → seek shelter; very tired → nest in cave.
    const n = Pet.needs;
    if (Activity.getType(Pet) === 'AFRAID') return true;
    if (n[NeedType.SECURITY] < 25) return true;
    try {
        if (Weather.isRaining() || Weather.isSnowing() || Weather.isThunder()) return true;
    } catch (_) {}
    if (n[NeedType.MOKO] < 20) return true;
    return false;
}

function shelterOffsetX() {
    // Canvas right-side; Shelter.entryPoint at ~89% of width. Pet's offsetX is
    // relative to canvas center, so shelter offset ≈ (0.89 − 0.5) × width.
    const canvas = document.getElementById('game-canvas');
    const w = canvas ? canvas.width : 800;
    return Math.floor(w * 0.39);
}

function scheduleMove() {
    ensureMotion();
    const m = Pet.motion;
    if (Activity.is(Pet, Activity.Type.SLEEPING)) {
        // When sleeping in shelter, stay put; otherwise tiny sway
        if (Pet._inShelter) { m.targetOffsetX = shelterOffsetX(); m.targetOffsetY = 0; return; }
        m.targetOffsetX = (Math.random() - 0.5) * 4;
        m.targetOffsetY = 0;
        m.targetScaleBoost = 0;
        return;
    }
    // Shelter-seeking overrides normal wandering
    if (wantsShelter()) {
        m.targetOffsetX = shelterOffsetX();
        m.targetOffsetY = 0;
        m.targetScaleBoost = 0;
        return;
    }
    // While it's sunny and the pet is dirty/bored, sometimes drift left to play
    try {
        if (Weather.get().condition === 'clear' && Pet.needs[NeedType.NASHI] < 60 && Math.random() < 0.35) {
            m.targetOffsetX = -150 + Math.random() * 120;
            m.targetOffsetY = -2;
            return;
        }
    } catch (_) {}
    const roll = Math.random();
    if (roll < 0.45) {
        // WANDER: walk to a new spot on the ground (up to ±150 px horizontally)
        const target = (Math.random() - 0.5) * 300;
        m.targetOffsetX = target;
        m.targetOffsetY = -2;  // slight bounce while walking
        // After arriving, return-ish to slight wander position (stays away from center)
        setTimeout(() => {
            if (!Pet.motion) return;
            Pet.motion.targetOffsetY = 0;
        }, 1400);
    } else if (roll < 0.65) {
        // Small hop in place
        m.targetOffsetY = -24;
        m.targetScaleBoost = 0.06;
        setTimeout(() => {
            if (!Pet.motion) return;
            Pet.motion.targetOffsetY = 0;
            Pet.motion.targetScaleBoost = 0;
        }, 420);
    } else if (roll < 0.82) {
        // Wiggle
        const dir = Math.random() > 0.5 ? 1 : -1;
        m.targetOffsetX = (m.targetOffsetX || 0) + dir * 12;
        setTimeout(() => Pet.motion && (Pet.motion.targetOffsetX = (Pet.motion.targetOffsetX || 0) - dir * 18), 220);
        setTimeout(() => Pet.motion && (Pet.motion.targetOffsetX = (Pet.motion.targetOffsetX || 0) + dir * 6), 440);
    } else {
        // Stretch
        m.targetScaleBoost = -0.08;
        setTimeout(() => Pet.motion && (Pet.motion.targetScaleBoost = 0), 520);
    }
}

// ---------------------------------------------------------------------------
// Personality traits derived from DNA — modulate everything the pet does
function personality() {
    const traits = Pet.dna?.personalityTraits ?? 0;
    // 0x01 curious, 0x02 calm, 0x04 anxious, 0x08 playful, 0x10 affectionate
    const curious = (traits & 0x01) ? 1 : 0;
    const calm    = (traits & 0x02) ? 1 : 0;
    const anxious = (traits & 0x04) ? 1 : 0;
    const playful = (traits & 0x08) ? 1 : 0;
    const affect  = (traits & 0x10) ? 1 : 0;
    // Speech gap: curious/playful pets talk more; calm pets less
    const speakMul = calm ? 1.4 : (curious ? 0.7 : 1);
    const moveMul  = playful ? 0.7 : (calm ? 1.3 : 1);
    const desireMul= curious ? 0.75 : 1.1;
    return { curious, calm, anxious, playful, affect, speakMul, moveMul, desireMul };
}

function checkTick() {
    if (!Pet.isAlive || !Pet.isAlive()) return;
    if (Pet.isEgg && Pet.isEgg()) return;
    // Silence and no initiative while sleeping — only breathing
    if (Activity.is(Pet, Activity.Type.SLEEPING)) return;

    const nowMs = Date.now();
    const p = personality();
    const hour = new Date().getHours();
    const isEvening = hour >= 20 && hour < 22;
    const isNight   = hour >= 22 || hour < 6;

    // ---- EVENING: invite the keeper to sleep ----
    if (isEvening && nowMs - _lastNightInviteAt > BASE_GAP_NIGHT_MS) {
        _lastNightInviteAt = nowMs;
        const line = PHRASES.evening[Math.floor(Math.random() * PHRASES.evening.length)];
        Events.emit('autonomy-speak', { line, mood: 'sleepy' });
        Events.emit('autonomy-desire', { icon: '💤', need: NeedType.MOKO, label: 'Sarebbe ora di dormire', at: nowMs, expiresAt: nowMs + 5 * 60 * 1000 });
        return;
    }

    // ---- LONELINESS: if keeper hasn't interacted for > 2 min, chirp sadly ----
    if (nowMs - _lastKeeperInteraction > LONELINESS_MS
        && nowMs - _lastLonelyFireAt > 45 * 1000) {
        _lastLonelyFireAt = nowMs;
        const loneliness = Math.min(1, (nowMs - _lastKeeperInteraction - LONELINESS_MS) / (5 * 60 * 1000));
        const mood = loneliness > 0.6 ? 'sad' : 'lonely';
        const line = pickLine(mood);
        // Pet actually SUFFERS — slight AFFECTION+SECURITY drop
        Pet.needs[NeedType.AFFECTION] = Math.max(0, Pet.needs[NeedType.AFFECTION] - 0.5 - loneliness * 2);
        Pet.needs[NeedType.SECURITY]  = Math.max(0, Pet.needs[NeedType.SECURITY]  - 0.3 - loneliness * 1.5);
        Events.emit('autonomy-speak', { line, mood });
        return;
    }

    // ---- TEACHING: occasionally pet "teaches" an alien word to the keeper ----
    if (nowMs - _lastTeachAt > BASE_GAP_TEACH_MS * (p.curious ? 0.8 : 1.2)) {
        if (Math.random() < 0.25 && Pet.stage >= 2) {
            _lastTeachAt = nowMs;
            const snippet = TEACHABLE_SNIPPETS[Math.floor(Math.random() * TEACHABLE_SNIPPETS.length)];
            // Try to add to vocabulary silently (if it's in lexicon)
            import('../i18n/alien-lexicon.js').then(m => {
                m.AlienLexicon.tryDiscover && m.AlienLexicon.tryDiscover(snippet.word, 'pet');
            }).catch(() => {});
            Events.emit('autonomy-speak', { line: snippet.line, mood: 'curious' });
            Pet.needs[NeedType.COGNITION] = Math.min(100, Pet.needs[NeedType.COGNITION] + 1.5);
            return;
        }
    }

    // ---- SINGING: happy & well-fed pets occasionally sing a tiny fragment ----
    if (Pet.needs[NeedType.NASHI] > 75 && Pet.needs[NeedType.AFFECTION] > 60
        && nowMs - _lastSpeakAt > BASE_GAP_SPEAK_MS * p.speakMul) {
        if (Math.random() < 0.08) {
            _lastSpeakAt = nowMs;
            const line = PHRASES.sing[Math.floor(Math.random() * PHRASES.sing.length)];
            // Pet actually sings — a short pentatonic melody in its own voice
            // that the keeper can hear alongside the text bubble.
            try {
                import('../audio/sound-engine.js').then(m => {
                    m.SoundEngine.playPetMelody(Pet.getStage ? Pet.getStage() : 2);
                }).catch(() => {});
            } catch (_) {}
            Events.emit('autonomy-speak', { line, mood: 'happy' });
            return;
        }
    }

    // ---- AUTO-NAP: if very tired or very bored, the pet decides to sleep on its own ----
    if (Pet.needs[NeedType.MOKO] < 25 || (Pet.needs[NeedType.NASHI] < 20 && Pet.needs[NeedType.MOKO] < 60)) {
        if (Activity.getType(Pet) === 'IDLE' && Math.random() < 0.3) {
            try {
                Activity.start(Pet, Activity.Type.SLEEPING, { fromAutoNap: true });
                Events.emit('autonomy-speak', { line: 'moko... sha-la thi', mood: 'sleepy' });
            } catch (_) {}
            return;
        }
    }

    // ---- Normal speech initiative ----
    if (nowMs - _lastSpeakAt > BASE_GAP_SPEAK_MS * p.speakMul) {
        // Probability: base 25% + boredom + loneliness + curiosity bonus
        const prob = 0.25
            + (100 - Pet.needs[NeedType.AFFECTION]) / 400
            + (100 - Pet.needs[NeedType.NASHI]) / 400
            + (p.curious ? 0.15 : 0)
            + (p.anxious ? 0.10 : 0);
        if (Math.random() < prob) {
            const mood = pickMood();
            const line = pickLine(mood);
            _lastSpeakAt = nowMs;
            Events.emit('autonomy-speak', { line, mood });
        }
    }

    // ---- Motion initiative ----
    if (nowMs - _lastMoveAt > BASE_GAP_MOVE_MS * p.moveMul) {
        if (Math.random() < 0.5 + p.playful * 0.2) {
            _lastMoveAt = nowMs;
            scheduleMove();
        }
    }

    // ---- Desire initiative ----
    if (nowMs - _lastDesireAt > BASE_GAP_DESIRE_MS * p.desireMul && !_currentDesire) {
        if (Math.random() < 0.35 + p.curious * 0.15) {
            const d = pickDesire();
            if (d) {
                _currentDesire = { ...d, at: nowMs, expiresAt: nowMs + 90 * 1000 };
                _lastDesireAt = nowMs;
                Events.emit('autonomy-desire', _currentDesire);
            }
        }
    }

    if (_currentDesire && nowMs > _currentDesire.expiresAt) {
        Events.emit('autonomy-desire-expire', _currentDesire);
        _currentDesire = null;
    }
}

// Track keeper interactions → reset loneliness timer
function trackInteraction() { _lastKeeperInteraction = Date.now(); }

// Call this every render frame for smooth motion lerp
function motionLerp() {
    if (!Pet.motion) return;
    const m = Pet.motion;
    const k = 0.18;
    m.offsetX    += (m.targetOffsetX    - m.offsetX) * k;
    m.offsetY    += (m.targetOffsetY    - m.offsetY) * k;
    m.scaleBoost += (m.targetScaleBoost - m.scaleBoost) * k;
    // Continuous slow bob (breathing)
    m.bob = Math.sin(Date.now() * 0.0014) * 2.4;
}

export const Autonomy = {
    init() {
        ensureMotion();
        if (_tickHandle) clearInterval(_tickHandle);
        _tickHandle = setInterval(checkTick, CHECK_INTERVAL_MS);

        _lastSpeakAt = Date.now();
        _lastMoveAt  = Date.now();
        _lastDesireAt = Date.now();
        _lastTeachAt  = Date.now();
        _lastNightInviteAt = Date.now();
        _lastKeeperInteraction = Date.now();

        // Track keeper attention: any interaction resets loneliness
        Events.on('pet-poke', trackInteraction);
        Events.on('pet-pet',  trackInteraction);
        Events.on('pet-scrub', trackInteraction);
        Events.on('gesture-action', trackInteraction);

        Events.on('pet-changed', () => {
            if (!_currentDesire) return;
            const need = _currentDesire.need;
            if (Pet.needs[need] > 65) {
                Events.emit('autonomy-desire-fulfilled', _currentDesire);
                _currentDesire = null;
                Pet.needs[NeedType.AFFECTION] = Math.min(100, Pet.needs[NeedType.AFFECTION] + 3);
            }
        });
    },

    /** Public: keeper did something — reset loneliness */
    notifyInteraction() { trackInteraction(); },

    /** Called from the render loop for smooth motion */
    updateMotion() { motionLerp(); },

    getCurrentDesire() { return _currentDesire; },
};
