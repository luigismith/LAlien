/**
 * activity.js -- Pet activity state machine (Phase A: IDLE, SLEEPING, EATING)
 *
 * An activity is WHAT the pet is doing right now. Different from the static
 * needs array: activities have real-time duration, entry/exit effects,
 * continuous tick effects, and rules about which user actions they accept.
 *
 * Time is REAL (Date.now() ms), independent of GameState.timeMultiplier —
 * so "sleep for 15 minutes" means 15 minutes on the wall clock.
 *
 * Survives tab close / refresh via serialize/deserialize.
 */
import { NeedType } from './needs.js';
import { Events } from '../engine/events.js';

export const ActivityType = {
    IDLE:     'IDLE',
    SLEEPING: 'SLEEPING',
    EATING:   'EATING',
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function now() { return Date.now(); }

// ---------------------------------------------------------------------------
// Per-type configuration
// ---------------------------------------------------------------------------
const CFG = {
    [ActivityType.IDLE]: {
        decayMultiplier: 1,
        tick() { return null; },
    },

    [ActivityType.SLEEPING]: {
        decayMultiplier: 0.35,  // decay of all needs is slowed while asleep
        // Per-second boosts during sleep (dt = real seconds since last tick)
        tick(pet, dt) {
            pet.needs[NeedType.MOKO]     = clamp(pet.needs[NeedType.MOKO]     + 0.06  * dt, 0, 100);
            pet.needs[NeedType.SECURITY] = clamp(pet.needs[NeedType.SECURITY] + 0.012 * dt, 0, 100);
            pet.needs[NeedType.NASHI]    = clamp(pet.needs[NeedType.NASHI]    + 0.003 * dt, 0, 100);
            // Health quietly recovers when rested
            pet.needs[NeedType.HEALTH]   = clamp(pet.needs[NeedType.HEALTH]   + 0.004 * dt, 0, 100);
            if (pet.needs[NeedType.MOKO] >= 99.5) return 'auto';
            return null;
        },
        /**
         * Compute duration (ms) from current MOKO deficit:
         *   MOKO=20 → 15 min;   MOKO=60 → 8 min;   MOKO=90 → 3 min
         */
        durationFor(pet) {
            const deficit = clamp(100 - pet.needs[NeedType.MOKO], 0, 100);
            const seconds = 180 + deficit * 9;  // 3 to 15 minutes
            return Math.round(seconds * 1000);
        },
        onEnter(pet) {
            // Entry nudge: gets comfy, secure
            pet.needs[NeedType.MOKO]     = clamp(pet.needs[NeedType.MOKO]     + 4, 0, 100);
            pet.needs[NeedType.SECURITY] = clamp(pet.needs[NeedType.SECURITY] + 3, 0, 100);
        },
    },

    [ActivityType.EATING]: {
        decayMultiplier: 1,
        tick(pet, dt) {
            const cap = pet.activity?.data?.cap ?? 100;
            pet.needs[NeedType.KORA]  = clamp(pet.needs[NeedType.KORA]  + 2.8 * dt, 0, cap);
            pet.needs[NeedType.NASHI] = clamp(pet.needs[NeedType.NASHI] + 0.04 * dt, 0, 100);
            if (pet.needs[NeedType.KORA] >= cap - 0.2) return 'auto';
            return null;
        },
        durationFor(pet) {
            const deficit = clamp(100 - pet.needs[NeedType.KORA], 0, 100);
            // 12 s minimum, up to 30 s for a starving pet
            return Math.round((12 + deficit * 0.2) * 1000);
        },
        onEnter(pet) {
            pet.needs[NeedType.KORA] = clamp(pet.needs[NeedType.KORA] + 6, 0, 100);
        },
    },
};

// ---------------------------------------------------------------------------
// Activity module
// ---------------------------------------------------------------------------
function makeIdle() {
    const t = now();
    return { type: ActivityType.IDLE, startedAt: t, endsAt: null, lastTickAt: t, data: {} };
}

export const Activity = {
    Type: ActivityType,

    init(pet) {
        if (!pet.activity || !pet.activity.type) {
            pet.activity = makeIdle();
        }
        pet.activity.lastTickAt = pet.activity.lastTickAt || now();
    },

    /**
     * Catch-up after a refresh / long pause: apply effects up to endsAt (or
     * up to "now" if still running), auto-exit if duration has elapsed.
     */
    resume(pet) {
        if (!pet.activity || pet.activity.type === ActivityType.IDLE) {
            this.init(pet);
            return;
        }
        const cfg = CFG[pet.activity.type];
        if (!cfg) { pet.activity = makeIdle(); return; }

        const nowMs = now();
        const last = pet.activity.lastTickAt || pet.activity.startedAt || nowMs;
        const endsAt = pet.activity.endsAt;
        const upTo = endsAt ? Math.min(nowMs, endsAt) : nowMs;
        const dt = Math.max(0, Math.min(6 * 3600, (upTo - last) / 1000));  // cap at 6h of catch-up effects

        if (dt > 0) cfg.tick(pet, dt);
        pet.activity.lastTickAt = upTo;

        if (endsAt && nowMs >= endsAt) {
            this._exit(pet, 'duration');
        }
    },

    /**
     * Called every logic tick from Pet.update(). Runs continuous effects
     * based on REAL time elapsed since last tick, then checks exit conditions.
     */
    tick(pet) {
        if (!pet.activity) this.init(pet);
        if (pet.activity.type === ActivityType.IDLE) {
            pet.activity.lastTickAt = now();
            return;
        }
        const cfg = CFG[pet.activity.type];
        if (!cfg) { pet.activity = makeIdle(); return; }

        const nowMs = now();
        const last = pet.activity.lastTickAt || nowMs;
        const dt = Math.max(0, Math.min(3600, (nowMs - last) / 1000));  // sanity cap per tick: 1h
        pet.activity.lastTickAt = nowMs;

        const hint = cfg.tick(pet, dt);

        if (pet.activity.endsAt && nowMs >= pet.activity.endsAt) {
            this._exit(pet, 'duration');
        } else if (hint === 'auto') {
            this._exit(pet, 'auto');
        }
    },

    /** Start a new activity. Fails if pet is already doing something incompatible. */
    start(pet, type, data = {}) {
        if (!CFG[type]) return { ok: false, reason: 'unknown activity' };
        if (pet.activity && pet.activity.type !== ActivityType.IDLE) {
            if (pet.activity.type === type) return { ok: false, reason: 'already' };
            // Interrupt previous cleanly
            this._exit(pet, 'replaced');
        }
        const cfg = CFG[type];
        const nowMs = now();
        const duration = cfg.durationFor ? cfg.durationFor(pet) : 0;
        pet.activity = {
            type,
            startedAt: nowMs,
            endsAt: duration ? nowMs + duration : null,
            lastTickAt: nowMs,
            data,
        };
        if (cfg.onEnter) cfg.onEnter(pet);
        Events.emit('activity-start', { type, duration });
        return { ok: true, duration };
    },

    _exit(pet, reason) {
        if (!pet.activity) return;
        const from = pet.activity.type;
        if (from === ActivityType.IDLE) return;

        // Detect grumpy-wake BEFORE resetting activity
        let grumpy = false;
        if (from === ActivityType.SLEEPING && reason === 'interrupt' && pet.needs[NeedType.MOKO] < 60) {
            pet.needs[NeedType.NASHI]    = clamp(pet.needs[NeedType.NASHI]    - 5, 0, 100);
            pet.needs[NeedType.SECURITY] = clamp(pet.needs[NeedType.SECURITY] - 2, 0, 100);
            grumpy = true;
        }
        pet.activity = makeIdle();
        Events.emit('activity-end', { from, reason, grumpy });
    },

    /**
     * Gate user actions through the current activity.
     * Returns { accept, reason?, woke? }.
     * Side-effect: may mutate pet.activity (wake, interrupt).
     */
    onAction(pet, action) {
        if (!pet.activity) this.init(pet);
        const cur = pet.activity.type;

        if (cur === ActivityType.SLEEPING) {
            const wasLowMoko = pet.needs[NeedType.MOKO] < 60;
            this._exit(pet, 'interrupt');
            return {
                accept: false,
                woke: true,
                reason: wasLowMoko
                    ? 'Lo hai svegliato troppo presto... è di cattivo umore.'
                    : 'Era in dormiveglia. Lo hai svegliato.',
            };
        }
        if (cur === ActivityType.EATING) {
            if (action === 'feed') {
                return { accept: false, reason: 'Sta già mangiando.' };
            }
            // Other actions gently interrupt (no penalty)
            this._exit(pet, 'interrupt');
            return { accept: true };
        }
        return { accept: true };
    },

    is(pet, type) { return !!pet.activity && pet.activity.type === type; },
    getType(pet) { return pet.activity ? pet.activity.type : ActivityType.IDLE; },
    getDecayMultiplier(pet) {
        const cfg = pet.activity ? CFG[pet.activity.type] : null;
        return cfg ? cfg.decayMultiplier : 1;
    },

    /** 0..1 progress through the current timed activity (0 if open-ended) */
    getProgress(pet) {
        if (!pet.activity || !pet.activity.endsAt) return 0;
        const total = pet.activity.endsAt - pet.activity.startedAt;
        if (total <= 0) return 1;
        return clamp((now() - pet.activity.startedAt) / total, 0, 1);
    },

    remainingMs(pet) {
        if (!pet.activity || !pet.activity.endsAt) return 0;
        return Math.max(0, pet.activity.endsAt - now());
    },
};
