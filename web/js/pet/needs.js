/**
 * needs.js -- 10-need system with decay and care mechanics
 * Port of firmware/src/pet/needs.cpp
 */

export const NeedType = {
    KORA: 0,       // hunger
    MOKO: 1,       // rest
    MISKA: 2,      // hygiene
    NASHI: 3,      // happiness
    HEALTH: 4,     // derived
    COGNITION: 5,  // mental stimulation
    AFFECTION: 6,  // bond
    CURIOSITY: 7,  // variety
    COSMIC: 8,     // cosmic connection
    SECURITY: 9,   // environmental stability
    COUNT: 10
};

export const NEED_NAMES = [
    'kora', 'moko', 'miska', 'nashi', 'health',
    'cognition', 'affection', 'curiosity', 'cosmic', 'security'
];

export const NEED_COLORS = [
    '#E07030', '#6A5AAA', '#40C4C4', '#E0C040', '#C04040',
    '#40A0E0', '#E060A0', '#60E060', '#A060E0', '#80A0B0'
];

export function createNeedsState() {
    const values = new Float32Array(NeedType.COUNT);
    values.fill(100.0);
    return values;
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }

function addNeed(state, n, delta) {
    state[n] = clamp(state[n] + delta);
}

// Decay rates (per second at 1x)
const DECAY_KORA = 0.015;
const DECAY_MOKO_DAY = 0.008;
const DECAY_MOKO_STIM = 0.025;
const DECAY_MISKA = 0.005;
const DECAY_NASHI = 0.012;
const DECAY_NASHI_CRASH = 0.030;
const DECAY_HEALTH = 0.003;
const DECAY_COGNITION = 0.010;
const DECAY_AFFECTION = 0.003;
const DECAY_CURIOSITY = 0.010;
const DECAY_CURIOSITY_ROUTINE = 0.005;
const DECAY_COSMIC = 0.002;
const RECOVERY_SECURITY = 0.005;

// Internal state
let _gameTimeSeconds = 0;
let _isStimulated = false;
let _nashiIgnoredStart = 0;
let _miskaLowStart = 0;
let _securityLowStart = 0;
let _velinStart = 0;
let _renaStart = 0;
const ROUTINE_HISTORY = 10;
let _actionHistory = new Uint8Array(ROUTINE_HISTORY);
let _actionIndex = 0;

function isRoutine() {
    if (_gameTimeSeconds < ROUTINE_HISTORY) return false;
    const first = _actionHistory[0];
    let same = 0;
    for (let i = 0; i < ROUTINE_HISTORY; i++) {
        if (_actionHistory[i] === first) same++;
    }
    return same >= 7;
}

function recordAction(id) {
    _actionHistory[_actionIndex % ROUTINE_HISTORY] = id;
    _actionIndex++;
}

function needsAvgExcludingHealth(state) {
    let sum = 0, count = 0;
    for (let i = 0; i < NeedType.COUNT; i++) {
        if (i === NeedType.HEALTH) continue;
        sum += state[i];
        count++;
    }
    return count > 0 ? sum / count : 0;
}

export const Needs = {
    /**
     * @param {Float32Array} state   needs array
     * @param {number} timeMult      seconds of simulated time to apply
     * @param {number} [stage]       pet stage (affects cosmic decay)
     * @param {number} [decayScale]  scalar applied ONLY to decay deltas, not
     *   to game-time advancement. Use 0.35-0.4 for offline catch-up so the
     *   pet "rests" while the keeper is away instead of being obliterated.
     * @param {number} [vocabSize]   size of the alien lexicon the pet shares
     *   with its keeper. A larger vocabulary slows COGNITION decay: a Lalìen
     *   with a rich shared language stays mentally alive longer — it has an
     *   inner conversation to lean on. At 0 words: full rate. Converges
     *   toward 35% of the original rate around 150+ words.
     */
    decay(state, timeMult, stage = 0, decayScale = 1, vocabSize = 0) {
        // Advance game-time by the real elapsed seconds so pathological
        // timers (velin, morak, zevol) tick correctly even when a big
        // chunk is simulated in one call.
        _gameTimeSeconds += Math.max(1, Math.round(timeMult));
        const ts = timeMult * decayScale;

        // Kora
        addNeed(state, NeedType.KORA, -DECAY_KORA * ts);

        // Moko
        const mokoRate = _isStimulated ? DECAY_MOKO_STIM : DECAY_MOKO_DAY;
        addNeed(state, NeedType.MOKO, -mokoRate * ts);
        _isStimulated = false;

        // Miska
        addNeed(state, NeedType.MISKA, -DECAY_MISKA * ts);

        // Nashi
        let nashiRate = DECAY_NASHI;
        if (state[NeedType.NASHI] < 30) {
            if (_nashiIgnoredStart === 0) {
                _nashiIgnoredStart = _gameTimeSeconds;
            } else if ((_gameTimeSeconds - _nashiIgnoredStart) > 7200) {
                nashiRate = DECAY_NASHI_CRASH;
            }
        } else {
            _nashiIgnoredStart = 0;
        }
        addNeed(state, NeedType.NASHI, -nashiRate * ts);

        // Health (derived from overall care). Converges toward the average
        // of the other needs: good care → heals up; neglect → sickens.
        const othersAvg = needsAvgExcludingHealth(state);
        const hp = state[NeedType.HEALTH];
        if (othersAvg >= 70) {
            const gap = 100 - hp;
            if (gap > 0) addNeed(state, NeedType.HEALTH, Math.min(gap, 0.020 * ts));
        } else if (othersAvg >= 45) {
            if (hp < othersAvg) {
                addNeed(state, NeedType.HEALTH, 0.008 * ts);
            } else {
                addNeed(state, NeedType.HEALTH, -DECAY_HEALTH * 0.5 * ts);
            }
        } else if (othersAvg >= 25) {
            addNeed(state, NeedType.HEALTH, -DECAY_HEALTH * ts);
        } else {
            addNeed(state, NeedType.HEALTH, -DECAY_HEALTH * 2.5 * ts);
        }

        // Cognition — decay is softened by the size of the alien lexicon
        // shared with the keeper. Formula converges: mult=1 at 0 words,
        // mult=0.35 at 145 words, floor 0.35.
        const wisdomMult = Math.max(0.35, 1 - (vocabSize || 0) / 220);
        addNeed(state, NeedType.COGNITION, -DECAY_COGNITION * ts * wisdomMult);

        // Affection
        addNeed(state, NeedType.AFFECTION, -DECAY_AFFECTION * ts);

        // Curiosity
        let curiosityRate = DECAY_CURIOSITY;
        if (isRoutine()) curiosityRate += DECAY_CURIOSITY_ROUTINE;
        addNeed(state, NeedType.CURIOSITY, -curiosityRate * ts);

        // Cosmic — dormant before stage 6 (Lali-mere): no decay, self-heals to full
        if (stage >= 6) {
            addNeed(state, NeedType.COSMIC, -DECAY_COSMIC * ts);
        } else if (state[NeedType.COSMIC] < 100) {
            state[NeedType.COSMIC] = 100;
        }

        // Security — a calm world heals, but NOT while the pet is actively
        // dying. If HEALTH is crashed or the other needs are in disaster,
        // the pet cannot feel safer; SECURITY drifts with the crisis instead.
        const othersAvgForSec = needsAvgExcludingHealth(state);
        if (state[NeedType.HEALTH] > 35 && othersAvgForSec > 25) {
            if (state[NeedType.SECURITY] < 100) {
                addNeed(state, NeedType.SECURITY, RECOVERY_SECURITY * timeMult);
            }
        } else if (state[NeedType.SECURITY] > 0) {
            // Tangible crisis → SECURITY erodes at half the recovery rate
            addNeed(state, NeedType.SECURITY, -RECOVERY_SECURITY * 0.5 * timeMult);
        }

        // ---- Emotional coupling ----
        // Happiness (NASHI) cannot float on its own — it is sustained by the
        // mind being engaged (COGNITION), the heart feeling loved (AFFECTION),
        // the world feeling interesting (CURIOSITY), and safe (SECURITY). If
        // those collapse, NASHI drifts down toward them; otherwise the pet
        // would read as "euforico e apatico" at the same time.
        const emoSupport = (
            state[NeedType.COGNITION] * 0.30 +
            state[NeedType.AFFECTION] * 0.35 +
            state[NeedType.CURIOSITY] * 0.15 +
            state[NeedType.SECURITY]  * 0.20
        );
        // NASHI can exceed support by up to 22 points (brief joy bursts allowed),
        // beyond that it decays toward the ceiling.
        const nashiCeiling = Math.min(100, emoSupport + 22);
        if (state[NeedType.NASHI] > nashiCeiling) {
            const gap = state[NeedType.NASHI] - nashiCeiling;
            // Drift: 0.02/s at gap=20, 0.06/s at gap=60. Converges in minutes.
            const rate = 0.02 + 0.001 * gap;
            addNeed(state, NeedType.NASHI, -rate * ts);
        }
        // Symmetrically, AFFECTION cannot float if the pet has not seen the
        // keeper in a while AND CURIOSITY/COGNITION are low (nothing reminds
        // the pet of connection).
        const mindActive = (state[NeedType.COGNITION] + state[NeedType.CURIOSITY]) / 2;
        if (state[NeedType.AFFECTION] > 60 && mindActive < 20) {
            addNeed(state, NeedType.AFFECTION, -0.005 * ts);
        }

        // Pathological tracking
        if (state[NeedType.MISKA] < 20) {
            if (_miskaLowStart === 0) _miskaLowStart = _gameTimeSeconds;
        } else { _miskaLowStart = 0; }

        if (state[NeedType.SECURITY] < 15) {
            if (_securityLowStart === 0) _securityLowStart = _gameTimeSeconds;
        } else { _securityLowStart = 0; }

        if (state[NeedType.NASHI] < 10 && state[NeedType.AFFECTION] < 10 && state[NeedType.COSMIC] < 10) {
            if (_velinStart === 0) _velinStart = _gameTimeSeconds;
        } else { _velinStart = 0; }

        if (state[NeedType.COGNITION] < 5 && state[NeedType.CURIOSITY] < 5) {
            if (_renaStart === 0) _renaStart = _gameTimeSeconds;
        } else { _renaStart = 0; }
    },

    /**
     * Simulate `elapsedGameSeconds` of decay in 5-minute chunks at a reduced
     * rate so HEALTH convergence and pathological timers progress realistically
     * instead of being flattened by a single huge call. Used by the catch-up
     * path when the keeper returns after an absence.
     */
    catchUp(state, elapsedGameSeconds, stage = 0, rate = 0.4, vocabSize = 0) {
        const CHUNK = 300;  // 5 game minutes
        const pre = Array.from(state);
        let remaining = Math.max(0, Math.floor(elapsedGameSeconds));
        while (remaining > 0) {
            const step = Math.min(CHUNK, remaining);
            this.decay(state, step, stage, rate, vocabSize);
            remaining -= step;
        }
        // Soft floor: the pet conserves energy while alone, so no single
        // need can collapse below a threshold purely from an absence of
        // modest length. Multi-day neglect still allows permadeath.
        let floor;
        if      (elapsedGameSeconds <=  4 * 3600) floor = 45;
        else if (elapsedGameSeconds <= 12 * 3600) floor = 28;
        else if (elapsedGameSeconds <= 24 * 3600) floor = 12;
        else                                       floor = 0;
        if (floor > 0) {
            for (let i = 0; i < state.length; i++) {
                // Only lift a need that STARTED above the floor; a need
                // already below the floor when the keeper left stays there.
                if (pre[i] >= floor && state[i] < floor) state[i] = floor;
            }
        }
    },

    // Care actions
    feed(state) {
        addNeed(state, NeedType.KORA, 30);
        addNeed(state, NeedType.NASHI, 5);
        recordAction(1);
    },

    sleep(state) {
        addNeed(state, NeedType.MOKO, 40);
        recordAction(2);
    },

    clean(state) {
        addNeed(state, NeedType.MISKA, 35);
        recordAction(3);
    },

    play(state) {
        addNeed(state, NeedType.NASHI, 20);
        addNeed(state, NeedType.CURIOSITY, 10);
        addNeed(state, NeedType.MOKO, -5);
        _isStimulated = true;
        _nashiIgnoredStart = 0;
        recordAction(4);
    },

    talk(state) {
        addNeed(state, NeedType.COGNITION, 25);
        addNeed(state, NeedType.AFFECTION, 5);
        addNeed(state, NeedType.CURIOSITY, 5);
        _isStimulated = true;
        recordAction(5);
    },

    caress(state) {
        addNeed(state, NeedType.AFFECTION, 15);
        addNeed(state, NeedType.NASHI, 10);
        addNeed(state, NeedType.SECURITY, 10);
        recordAction(6);
    },

    meditate(state, stage) {
        if (stage >= 6) {
            addNeed(state, NeedType.COSMIC, 20);
            addNeed(state, NeedType.AFFECTION, 5);
        }
        recordAction(7);
    },

    applyGameNeeds(state, result) {
        addNeed(state, NeedType.NASHI, result.nashiBonus);
        addNeed(state, NeedType.COGNITION, result.cognitionBonus);
        addNeed(state, NeedType.CURIOSITY, result.curiosityBonus);
        addNeed(state, NeedType.AFFECTION, result.affectionBonus);
        addNeed(state, NeedType.MISKA, result.miskaBonus);
        addNeed(state, NeedType.COSMIC, result.cosmicBonus);
        addNeed(state, NeedType.SECURITY, result.securityBonus);
        addNeed(state, NeedType.MOKO, -result.mokoCost);
    },

    // Pathological checks
    isZevol(state) {
        if (state[NeedType.HEALTH] < 15) return true;
        if (_miskaLowStart > 0 && (_gameTimeSeconds - _miskaLowStart) > 86400) return true;
        return false;
    },

    isMorak(state) {
        if (_securityLowStart > 0 && (_gameTimeSeconds - _securityLowStart) > 3600) return true;
        return false;
    },

    isVelin(state) {
        if (_velinStart > 0 && (_gameTimeSeconds - _velinStart) > 172800) return true;
        return false;
    },

    isRenaThishi(state) {
        if (_renaStart > 0 && (_gameTimeSeconds - _renaStart) > 259200) return true;
        return false;
    },

    getOverallWellness(state) {
        let sum = 0;
        for (let i = 0; i < NeedType.COUNT; i++) sum += state[i];
        return sum / NeedType.COUNT;
    },

    getGameTimeSeconds() { return _gameTimeSeconds; },
    setGameTimeSeconds(v) { _gameTimeSeconds = v; },

    resetTracking() {
        _gameTimeSeconds = 0;
        _isStimulated = false;
        _nashiIgnoredStart = 0;
        _miskaLowStart = 0;
        _securityLowStart = 0;
        _velinStart = 0;
        _renaStart = 0;
        _actionHistory.fill(0);
        _actionIndex = 0;
    }
};
