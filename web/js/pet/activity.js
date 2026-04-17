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
    IDLE:       'IDLE',
    SLEEPING:   'SLEEPING',
    EATING:     'EATING',
    MEDITATING: 'MEDITATING',
    SICK:       'SICK',
    AFRAID:     'AFRAID',
    SULKY:      'SULKY',
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
        decayMultiplier: 0.0,   // needs FROZEN while asleep — sleep is sacred
        tick(pet, dt) {
            pet.needs[NeedType.MOKO]     = clamp(pet.needs[NeedType.MOKO]     + 0.06  * dt, 0, 100);
            pet.needs[NeedType.SECURITY] = clamp(pet.needs[NeedType.SECURITY] + 0.012 * dt, 0, 100);
            pet.needs[NeedType.NASHI]    = clamp(pet.needs[NeedType.NASHI]    + 0.003 * dt, 0, 100);
            pet.needs[NeedType.HEALTH]   = clamp(pet.needs[NeedType.HEALTH]   + 0.004 * dt, 0, 100);
            // Only auto-wake when MOKO full AND at least 2 real minutes asleep
            // (prevents instant exit if the keeper puts pet to sleep at MOKO=100)
            const elapsed = pet.activity ? (Date.now() - (pet.activity.startedAt || 0)) : 0;
            if (pet.needs[NeedType.MOKO] >= 99.5 && elapsed > 2 * 60 * 1000) return 'auto';
            return null;
        },
        /**
         * Sleep duration:
         *   • Day nap — 3-18 min scaled by MOKO deficit
         *   • Night (22:00 – 06:59 local) — extends until 07:00 AM next morning,
         *     so the keeper can put the pet to bed and it wakes at dawn
         */
        durationFor(pet) {
            const deficit = clamp(100 - pet.needs[NeedType.MOKO], 0, 100);
            const napMs = Math.round((180 + deficit * 9) * 1000);
            const now = new Date();
            const hour = now.getHours();
            if (hour >= 21 || hour < 7) {
                const wake = new Date(now);
                if (hour >= 21) wake.setDate(wake.getDate() + 1);
                wake.setHours(7, 0, 0, 0);
                const nightMs = wake.getTime() - now.getTime();
                return Math.max(napMs, nightMs);
            }
            return napMs;
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
            return Math.round((12 + deficit * 0.2) * 1000);
        },
        onEnter(pet) {
            pet.needs[NeedType.KORA] = clamp(pet.needs[NeedType.KORA] + 6, 0, 100);
        },
    },

    // 5 minutes of cosmic meditation — only meaningful from stage 6+
    [ActivityType.MEDITATING]: {
        decayMultiplier: 0.6,
        tick(pet, dt) {
            pet.needs[NeedType.COSMIC]    = clamp(pet.needs[NeedType.COSMIC]    + 0.20 * dt, 0, 100);
            pet.needs[NeedType.AFFECTION] = clamp(pet.needs[NeedType.AFFECTION] + 0.05 * dt, 0, 100);
            pet.needs[NeedType.SECURITY]  = clamp(pet.needs[NeedType.SECURITY]  + 0.04 * dt, 0, 100);
            // MOKO decays slightly more — meditation is wakeful
            pet.needs[NeedType.MOKO]      = clamp(pet.needs[NeedType.MOKO]      - 0.02 * dt, 0, 100);
            if (pet.needs[NeedType.COSMIC] >= 99.5) return 'auto';
            return null;
        },
        durationFor() { return 5 * 60 * 1000; },
        onEnter(pet) {
            pet.needs[NeedType.SECURITY] = clamp(pet.needs[NeedType.SECURITY] + 4, 0, 100);
        },
    },

    // Sickness — HEALTH < 25 sustained; all positive actions have reduced effect
    [ActivityType.SICK]: {
        decayMultiplier: 1.25,  // slight extra decay — illness takes a toll
        actionEfficiency: 0.5,  // all care actions 50% effective
        tick(pet, dt) {
            // NASHI erodes while sick
            pet.needs[NeedType.NASHI] = clamp(pet.needs[NeedType.NASHI] - 0.03 * dt, 0, 100);
            // Exit when HEALTH recovered above threshold
            if (pet.needs[NeedType.HEALTH] > 50) return 'auto';
            return null;
        },
        durationFor() { return 0; },  // condition-based, not timed
    },

    // Afraid — SECURITY very low OR triggered by explicitly hostile sentiment
    [ActivityType.AFRAID]: {
        decayMultiplier: 1.10,
        tick(pet, dt) {
            // Caress recovers SECURITY; passive recovery is very slow while afraid
            pet.needs[NeedType.SECURITY] = clamp(pet.needs[NeedType.SECURITY] + 0.01 * dt, 0, 100);
            if (pet.needs[NeedType.SECURITY] > 45) return 'auto';
            return null;
        },
        durationFor() { return 0; },
    },

    // Sulky — short-term grumpy from negative sentiment, grumpy-wake, or repeated rejections
    [ActivityType.SULKY]: {
        decayMultiplier: 1,
        tick() { return null; },
        durationFor(pet) {
            // 2–5 minutes scaled by NASHI deficit
            const deficit = clamp(100 - pet.needs[NeedType.NASHI], 0, 100);
            return Math.round((120 + deficit * 1.8) * 1000);
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
     * based on REAL time elapsed since last tick, scaled by the game's
     * timeMultiplier so activities keep up with need decay at high speeds.
     */
    tick(pet, timeMultiplier = 1) {
        if (!pet.activity) this.init(pet);
        if (pet.activity.type === ActivityType.IDLE) {
            pet.activity.lastTickAt = now();
            return;
        }
        const cfg = CFG[pet.activity.type];
        if (!cfg) { pet.activity = makeIdle(); return; }

        const nowMs = now();
        const last = pet.activity.lastTickAt || nowMs;
        const realDt = Math.max(0, Math.min(3600, (nowMs - last) / 1000));
        pet.activity.lastTickAt = nowMs;

        // Scale effect dt by time multiplier so tick boosts can keep pace with decay.
        // Activity DURATION stays in real time (we compare endsAt against real clock).
        const effectDt = realDt * Math.max(1, timeMultiplier);

        const hint = cfg.tick(pet, effectDt);

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

        // Meta-actions (open screens that don't touch the pet): do NOT wake.
        // These are UI-only: settings, manual, diary, lexicon, graveyard.
        const NON_WAKING = new Set(['settings', 'manual', 'diary', 'lexicon', 'graveyard']);
        if (cur === ActivityType.SLEEPING && NON_WAKING.has(action)) {
            return { accept: true };
        }

        if (cur === ActivityType.SLEEPING) {
            const wasLowMoko = pet.needs[NeedType.MOKO] < 60;
            if (wasLowMoko) {
                // Grumpy wake → transition to SULKY
                this._exit(pet, 'interrupt');
                this.start(pet, ActivityType.SULKY, { reason: 'grumpy-wake' });
            } else {
                this._exit(pet, 'interrupt');
            }
            return {
                accept: false,
                woke: true,
                reason: wasLowMoko
                    ? 'Lo hai svegliato troppo presto... ora è di pessimo umore.'
                    : 'Era in dormiveglia. Lo hai svegliato.',
            };
        }
        if (cur === ActivityType.EATING) {
            if (action === 'feed') return { accept: false, reason: 'Sta già mangiando.' };
            this._exit(pet, 'interrupt');
            return { accept: true };
        }
        if (cur === ActivityType.MEDITATING) {
            if (action === 'meditate') return { accept: false, reason: 'Sta già meditando.' };
            if (action === 'caress') {
                // Gentle touch forgiven
                this._exit(pet, 'interrupt');
                return { accept: true };
            }
            // Interrupt a meditation → small COSMIC penalty, no severe mood cost
            pet.needs[NeedType.COSMIC] = Math.max(0, pet.needs[NeedType.COSMIC] - 3);
            this._exit(pet, 'interrupt');
            return { accept: true, reason: 'Hai interrotto la meditazione.' };
        }
        if (cur === ActivityType.SICK) {
            // Accept actions with reduced effect (handled by callers checking actionEfficiency)
            return { accept: true, efficiency: 0.5 };
        }
        if (cur === ActivityType.AFRAID) {
            if (action === 'caress' || action === 'talk') {
                return { accept: true, efficiency: 1.5 };  // reassurance is especially effective
            }
            if (action === 'play') {
                return { accept: false, reason: 'Ha paura. Ha bisogno di essere rassicurato prima.' };
            }
            return { accept: true };
        }
        if (cur === ActivityType.SULKY) {
            if (action === 'caress') {
                // First caress is refused; the sulky reaction is recorded but accepted acknowledgment
                return {
                    accept: false,
                    reason: 'Si gira dall\'altra parte... non vuole essere toccato.',
                    flinch: true,
                };
            }
            if (action === 'play') {
                return { accept: false, reason: 'Non ha voglia di giocare adesso.' };
            }
            if (action === 'talk') return { accept: true, efficiency: 0.3 };
            return { accept: true };
        }
        return { accept: true };
    },

    /**
     * Automatic checks: SICK and AFRAID are triggered purely by pet state.
     * Called from Pet.update() before Activity.tick().
     */
    autoDetect(pet) {
        if (!pet.activity) this.init(pet);
        const cur = pet.activity.type;
        const n = pet.needs;

        // Exit self-resolving states — tick() handles those. Here we only ENTER.
        // Don't override more-important states: SLEEPING/EATING/MEDITATING preempt.
        const blocking = [ActivityType.SLEEPING, ActivityType.EATING, ActivityType.MEDITATING];
        if (blocking.indexOf(cur) !== -1) return;

        // SICK — HEALTH < 25 for >30 real seconds (track via state.sickCandidateAt)
        if (cur !== ActivityType.SICK) {
            if (n[NeedType.HEALTH] < 25) {
                pet._sickAt = pet._sickAt || Date.now();
                if (Date.now() - pet._sickAt > 30 * 1000) {
                    this.start(pet, ActivityType.SICK);
                    pet._sickAt = 0;
                    return;
                }
            } else {
                pet._sickAt = 0;
            }
        }

        // AFRAID — SECURITY < 15 immediate
        if (cur !== ActivityType.AFRAID && cur !== ActivityType.SICK) {
            if (n[NeedType.SECURITY] < 15) {
                this.start(pet, ActivityType.AFRAID);
                return;
            }
        }
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
