/**
 * death.js -- Death triggers, sequences, and types
 * Port of firmware/src/pet/death.cpp
 * 7 death types with duration tracking
 */
import { NeedType } from './needs.js';

export const DeathType = {
    NONE: 0,
    VELIN: 1,           // despair / starvation / neglect
    ZEVOL: 2,           // disease / sickness
    MORAK: 3,           // trauma / heartbreak
    RENA_THISHI: 4,     // home calling / loneliness / boredom
    OLD_AGE: 5,         // natural
    TRANSCENDENCE: 6,   // best ending
    FAREWELL: 7,        // keeper chose goodbye
};

// Thresholds (game-time seconds)
const STARVATION_THRESHOLD_S = 48 * 3600;
const NEGLECT_THRESHOLD_S = 24 * 3600;
const LONELINESS_THRESHOLD_S = 72 * 3600;
const SICKNESS_THRESHOLD_S = 24 * 3600;
const BOREDOM_THRESHOLD_S = 48 * 3600;
const HEARTBREAK_WINDOW_S = 12 * 3600;
const CRITICAL_THRESHOLD = 10;
const HEARTBREAK_HIGH = 80;
const HEARTBREAK_LOW = 20;
const OLD_AGE_THRESHOLD_HOURS = 2500;
const TRANSCEND_BOND_MIN = 90;
const TRANSCEND_COSMIC_MIN = 80;
const TRANSCEND_ALL_MIN = 80;
const TRANSCEND_SUSTAIN_S = 48 * 3600;
const SEQUENCE_DURATION_MS = 15000;

function countCriticalNeeds(needs) {
    let count = 0;
    for (let i = 0; i < NeedType.COUNT; i++) {
        if (needs[i] < CRITICAL_THRESHOLD) count++;
    }
    return count;
}

function allNeedsAbove(needs, threshold) {
    for (let i = 0; i < NeedType.COUNT; i++) {
        if (needs[i] < threshold) return false;
    }
    return true;
}

export const Death = {
    trackers: {
        starvationStart: 0,
        neglectStart: 0,
        lonelinessStart: 0,
        sicknessStart: 0,
        boredomStart: 0,
        heartbreakBondHighTime: 0,
        heartbreakLastBond: 0,
        transcendSustainStart: 0,
        lastInteractionTime: 0,
    },

    sequencePlaying: false,
    sequenceComplete: false,
    sequenceType: DeathType.NONE,
    sequenceStartMs: 0,

    init() {
        this.trackers = {
            starvationStart: 0, neglectStart: 0, lonelinessStart: 0,
            sicknessStart: 0, boredomStart: 0, heartbreakBondHighTime: 0,
            heartbreakLastBond: 0, transcendSustainStart: 0, lastInteractionTime: 0,
        };
        this.sequencePlaying = false;
        this.sequenceComplete = false;
        this.sequenceType = DeathType.NONE;
    },

    checkDeathTriggers(stage, ageHours, needs, gameTimeSeconds, totalInteractions) {
        const t = this.trackers;

        // TRANSCENDENCE
        if (stage >= 7) {
            if (needs[NeedType.AFFECTION] >= TRANSCEND_BOND_MIN &&
                needs[NeedType.COSMIC] >= TRANSCEND_COSMIC_MIN &&
                allNeedsAbove(needs, TRANSCEND_ALL_MIN)) {
                if (t.transcendSustainStart === 0) {
                    t.transcendSustainStart = gameTimeSeconds;
                } else if ((gameTimeSeconds - t.transcendSustainStart) >= TRANSCEND_SUSTAIN_S) {
                    return DeathType.TRANSCENDENCE;
                }
            } else {
                t.transcendSustainStart = 0;
            }
        }

        // OLD_AGE
        if (stage >= 7 && ageHours >= OLD_AGE_THRESHOLD_HOURS) {
            return DeathType.OLD_AGE;
        }

        // STARVATION
        if (needs[NeedType.KORA] <= 0) {
            if (t.starvationStart === 0) t.starvationStart = gameTimeSeconds;
            else if ((gameTimeSeconds - t.starvationStart) >= STARVATION_THRESHOLD_S) return DeathType.VELIN;
        } else { t.starvationStart = 0; }

        // SICKNESS
        if (needs[NeedType.HEALTH] <= 0) {
            if (t.sicknessStart === 0) t.sicknessStart = gameTimeSeconds;
            else if ((gameTimeSeconds - t.sicknessStart) >= SICKNESS_THRESHOLD_S) return DeathType.ZEVOL;
        } else { t.sicknessStart = 0; }

        // NEGLECT
        if (countCriticalNeeds(needs) >= 3) {
            if (t.neglectStart === 0) t.neglectStart = gameTimeSeconds;
            else if ((gameTimeSeconds - t.neglectStart) >= NEGLECT_THRESHOLD_S) return DeathType.VELIN;
        } else { t.neglectStart = 0; }

        // LONELINESS
        if (needs[NeedType.AFFECTION] <= 0) {
            const noRecent = (t.lastInteractionTime === 0) ||
                ((gameTimeSeconds - t.lastInteractionTime) >= LONELINESS_THRESHOLD_S);
            if (noRecent) {
                if (t.lonelinessStart === 0) t.lonelinessStart = gameTimeSeconds;
                else if ((gameTimeSeconds - t.lonelinessStart) >= LONELINESS_THRESHOLD_S) return DeathType.RENA_THISHI;
            }
        } else { t.lonelinessStart = 0; }

        // BOREDOM
        if (needs[NeedType.NASHI] <= 0 && needs[NeedType.CURIOSITY] <= 0) {
            if (t.boredomStart === 0) t.boredomStart = gameTimeSeconds;
            else if ((gameTimeSeconds - t.boredomStart) >= BOREDOM_THRESHOLD_S) return DeathType.RENA_THISHI;
        } else { t.boredomStart = 0; }

        // HEARTBREAK
        const currentBond = needs[NeedType.AFFECTION];
        if (currentBond >= HEARTBREAK_HIGH) {
            t.heartbreakBondHighTime = gameTimeSeconds;
        }
        if (currentBond < HEARTBREAK_LOW && t.heartbreakBondHighTime > 0) {
            const elapsed = gameTimeSeconds - t.heartbreakBondHighTime;
            if (elapsed <= HEARTBREAK_WINDOW_S && elapsed > 0) return DeathType.MORAK;
        }
        t.heartbreakLastBond = currentBond;

        return DeathType.NONE;
    },

    recordInteraction(gameTimeSeconds) {
        this.trackers.lastInteractionTime = gameTimeSeconds;
        this.trackers.lonelinessStart = 0;
    },

    startSequence(type) {
        this.sequenceType = type;
        this.sequencePlaying = true;
        this.sequenceComplete = false;
        this.sequenceStartMs = Date.now();
    },

    updateSequence() {
        if (!this.sequencePlaying) return true;
        if (Date.now() - this.sequenceStartMs >= SEQUENCE_DURATION_MS) {
            this.sequenceComplete = true;
            this.sequencePlaying = false;
            return true;
        }
        return false;
    },

    isSequencePlaying() { return this.sequencePlaying && !this.sequenceComplete; },
    isSequenceComplete() { return this.sequenceComplete; },

    getCauseString(type) {
        const names = { [DeathType.VELIN]: 'velin', [DeathType.ZEVOL]: 'zevol', [DeathType.MORAK]: 'morak',
            [DeathType.RENA_THISHI]: 'rena_thishi', [DeathType.OLD_AGE]: 'old_age',
            [DeathType.TRANSCENDENCE]: 'transcendence', [DeathType.FAREWELL]: 'farewell' };
        return names[type] || 'unknown';
    },

    serializeTrackers() { return { ...this.trackers }; },
    restoreTrackers(t) { if (t) Object.assign(this.trackers, t); },
};
