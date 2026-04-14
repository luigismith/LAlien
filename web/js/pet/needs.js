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
    decay(state, timeMult) {
        _gameTimeSeconds++;

        // Kora
        addNeed(state, NeedType.KORA, -DECAY_KORA * timeMult);

        // Moko
        const mokoRate = _isStimulated ? DECAY_MOKO_STIM : DECAY_MOKO_DAY;
        addNeed(state, NeedType.MOKO, -mokoRate * timeMult);
        _isStimulated = false;

        // Miska
        addNeed(state, NeedType.MISKA, -DECAY_MISKA * timeMult);

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
        addNeed(state, NeedType.NASHI, -nashiRate * timeMult);

        // Health (derived)
        const othersAvg = needsAvgExcludingHealth(state);
        if (othersAvg > 60) {
            const healthTarget = othersAvg * 0.3;
            if (state[NeedType.HEALTH] < healthTarget) {
                addNeed(state, NeedType.HEALTH, 0.01 * timeMult);
            }
        }
        addNeed(state, NeedType.HEALTH, -DECAY_HEALTH * timeMult);

        // Cognition
        addNeed(state, NeedType.COGNITION, -DECAY_COGNITION * timeMult);

        // Affection
        addNeed(state, NeedType.AFFECTION, -DECAY_AFFECTION * timeMult);

        // Curiosity
        let curiosityRate = DECAY_CURIOSITY;
        if (isRoutine()) curiosityRate += DECAY_CURIOSITY_ROUTINE;
        addNeed(state, NeedType.CURIOSITY, -curiosityRate * timeMult);

        // Cosmic
        addNeed(state, NeedType.COSMIC, -DECAY_COSMIC * timeMult);

        // Security (recovers)
        if (state[NeedType.SECURITY] < 100) {
            addNeed(state, NeedType.SECURITY, RECOVERY_SECURITY * timeMult);
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
