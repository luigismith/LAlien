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

const CHECK_INTERVAL_MS = 6 * 1000;      // evaluate every 6s
const MIN_GAP_SPEAK_MS   = 25 * 1000;    // don't speak unprompted more often than this
const MIN_GAP_MOVE_MS    = 4 * 1000;
const MIN_GAP_DESIRE_MS  = 90 * 1000;

let _lastSpeakAt  = 0;
let _lastMoveAt   = 0;
let _lastDesireAt = 0;
let _tickHandle   = null;
let _currentDesire = null;

// ---------------------------------------------------------------------------
// Mood-keyed alien phrases (stage-agnostic, readable on stages 1+)
// ---------------------------------------------------------------------------
const PHRASES = {
    happy:   ['la-shi thi!', 'kora thi la-la!', 'selath… kesma!', 'ko! ko thi!', 'thi-thi la-shi'],
    neutral: ['lalí…', 'kora thi', 'shi… thi.', 'mmh… la-shi', 'ko ko'],
    sad:     ['sha… lalí', 'moko… thi', 'kesma sha', 'thi… ven…'],
    scared:  ['shai! sha-sha', 'ven-thi… sha', 'kèsma?! shi-shi'],
    hungry:  ['kora… kora?', 'ko… kora sha', 'lalí: kora thi', 'shi… kora sha thi'],
    sleepy:  ['moko… moko thi', 'Zzz… lalí', 'shi… moko sha-la'],
    dirty:   ['miska sha!', 'vyth-thi miska', 'sha… miska sha'],
    bored:   ['shi-thi?', 'la-shi ven?', 'kora thi sha… ven'],
    curious: ['la-la? thi?', 'shai? kesma?', 'kora ven-la?'],
    lonely:  ['kesma… lalí?', 'custode? custode?', 'thi sha… lalí'],
};

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

function scheduleMove() {
    ensureMotion();
    const m = Pet.motion;
    if (Activity.is(Pet, Activity.Type.SLEEPING)) {
        // Gentle rocking only
        m.targetOffsetX = (Math.random() - 0.5) * 4;
        m.targetOffsetY = 0;
        m.targetScaleBoost = 0;
        return;
    }
    const roll = Math.random();
    if (roll < 0.25) {
        // Small hop
        m.targetOffsetX = 0;
        m.targetOffsetY = -18;
        m.targetScaleBoost = 0.05;
        setTimeout(() => {
            if (!Pet.motion) return;
            Pet.motion.targetOffsetY = 0;
            Pet.motion.targetScaleBoost = 0;
        }, 420);
    } else if (roll < 0.55) {
        // Lean left or right
        m.targetOffsetX = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 12);
        m.targetOffsetY = -2;
        setTimeout(() => {
            if (!Pet.motion) return;
            Pet.motion.targetOffsetX = 0;
            Pet.motion.targetOffsetY = 0;
        }, 900);
    } else if (roll < 0.80) {
        // Wiggle (quick double offset)
        m.targetOffsetX = 7;
        setTimeout(() => Pet.motion && (Pet.motion.targetOffsetX = -7), 180);
        setTimeout(() => Pet.motion && (Pet.motion.targetOffsetX = 0), 360);
    } else {
        // Stretch (squash)
        m.targetScaleBoost = -0.06;
        setTimeout(() => Pet.motion && (Pet.motion.targetScaleBoost = 0), 500);
    }
}

// ---------------------------------------------------------------------------
function checkTick() {
    if (!Pet.isAlive || !Pet.isAlive()) return;
    if (Pet.isEgg && Pet.isEgg()) return;

    const nowMs = Date.now();

    // --- Speech initiative ---
    if (nowMs - _lastSpeakAt > MIN_GAP_SPEAK_MS) {
        // Probability scales with: boredom (low NASHI), loneliness (low AFFECTION)
        const p = 0.25 + (100 - Pet.needs[NeedType.AFFECTION]) / 400 + (100 - Pet.needs[NeedType.NASHI]) / 400;
        if (Math.random() < p) {
            const mood = pickMood();
            const line = pickLine(mood);
            _lastSpeakAt = nowMs;
            Events.emit('autonomy-speak', { line, mood });
        }
    }

    // --- Motion initiative (more frequent, subtle) ---
    if (nowMs - _lastMoveAt > MIN_GAP_MOVE_MS) {
        if (Math.random() < 0.5) {
            _lastMoveAt = nowMs;
            scheduleMove();
        }
    }

    // --- Desire initiative ---
    if (nowMs - _lastDesireAt > MIN_GAP_DESIRE_MS && !_currentDesire
        && !Activity.is(Pet, Activity.Type.SLEEPING)) {
        if (Math.random() < 0.35) {
            const d = pickDesire();
            if (d) {
                _currentDesire = { ...d, at: nowMs, expiresAt: nowMs + 90 * 1000 };
                _lastDesireAt = nowMs;
                Events.emit('autonomy-desire', _currentDesire);
            }
        }
    }

    // Expire desire after a while
    if (_currentDesire && nowMs > _currentDesire.expiresAt) {
        Events.emit('autonomy-desire-expire', _currentDesire);
        _currentDesire = null;
    }
}

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

        // Reset triggers
        _lastSpeakAt = Date.now();
        _lastMoveAt  = Date.now();
        _lastDesireAt = Date.now();

        // When the keeper satisfies the current desire, clear it
        Events.on('pet-changed', () => {
            if (!_currentDesire) return;
            const need = _currentDesire.need;
            if (Pet.needs[need] > 65) {
                Events.emit('autonomy-desire-fulfilled', _currentDesire);
                _currentDesire = null;
                // Gratitude boost
                Pet.needs[NeedType.AFFECTION] = Math.min(100, Pet.needs[NeedType.AFFECTION] + 3);
            }
        });
    },

    /** Called from the render loop for smooth motion */
    updateMotion() { motionLerp(); },

    getCurrentDesire() { return _currentDesire; },
};
