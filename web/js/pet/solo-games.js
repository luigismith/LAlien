/**
 * solo-games.js -- Little activities the pet invents for itself when bored.
 *
 * The keeper is not required. The pet looks around, decides to entertain
 * itself, and plays for 20-40 seconds with a visible on-screen effect.
 * Each game grants a modest boost to NASHI / CURIOSITY / COSMIC and stays
 * IDLE from the Activity state machine's perspective — these are "games
 * inside idle", not an activity override.
 *
 * Games:
 *   - chase_firefly   a glowing bug drifts around and the pet chases it
 *   - pebble_stack    the pet stacks a small tower of pebbles
 *   - shadow_dance    the pet spins in place while its shadow mirrors
 *   - star_gaze       the pet tilts up and watches a shooting star
 *   - bubble_blow     luminous bubbles float up from the pet's mouth
 *   - dig_hole        the pet digs a small hole and fills it back in
 *
 * Renderer reads `Pet._soloGame` each frame and draws the corresponding
 * particles. Motion targets are pushed through Pet.motion just like the
 * Autonomy module does for normal wandering.
 */
import { Pet } from './pet.js';
import { NeedType } from './needs.js';
import { Activity } from './activity.js';
import { Events } from '../engine/events.js';

const GAMES = {
    chase_firefly: {
        label: 'insegue una lucciola',
        duration: 22_000,
        needs: { [NeedType.NASHI]: 12, [NeedType.CURIOSITY]: 10, [NeedType.MOKO]: -4 },
        minStage: 1,
    },
    pebble_stack: {
        label: 'impila sassolini',
        duration: 28_000,
        needs: { [NeedType.CURIOSITY]: 12, [NeedType.COGNITION]: 8, [NeedType.NASHI]: 6 },
        minStage: 2,
    },
    shadow_dance: {
        label: 'balla con la propria ombra',
        duration: 18_000,
        needs: { [NeedType.NASHI]: 14, [NeedType.AFFECTION]: 4, [NeedType.MOKO]: -5 },
        minStage: 1,
    },
    star_gaze: {
        label: 'guarda le stelle',
        duration: 30_000,
        needs: { [NeedType.COSMIC]: 8, [NeedType.CURIOSITY]: 10, [NeedType.SECURITY]: 6 },
        minStage: 3,
        nightOnly: true,
    },
    bubble_blow: {
        label: 'soffia bolle luminose',
        duration: 20_000,
        needs: { [NeedType.NASHI]: 10, [NeedType.COSMIC]: 4, [NeedType.CURIOSITY]: 6 },
        minStage: 1,
    },
    dig_hole: {
        label: 'scava una piccola buca',
        duration: 24_000,
        needs: { [NeedType.CURIOSITY]: 10, [NeedType.NASHI]: 6, [NeedType.MISKA]: -4 },
        minStage: 2,
    },
};

let _state = null;  // { key, startedAt, endsAt, data }
let _tick = null;

function pickGame() {
    const stage = Pet.stage || 0;
    const hour = new Date().getHours();
    const isNight = hour < 6 || hour >= 21;
    const pool = [];
    for (const [k, g] of Object.entries(GAMES)) {
        if (stage < g.minStage) continue;
        if (g.nightOnly && !isNight) continue;
        // Favor games that help the need the pet is most missing
        let weight = 1;
        for (const [need, delta] of Object.entries(g.needs)) {
            if (delta > 0 && Pet.needs[need] < 60) weight += 1;
        }
        for (let i = 0; i < weight; i++) pool.push(k);
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

function shouldStart() {
    if (!Pet.isAlive || !Pet.isAlive()) return false;
    if (Pet.isEgg && Pet.isEgg()) return false;
    if (_state) return false;
    if (Activity.getType(Pet) !== 'IDLE') return false;
    if (Pet._inShelter) return false;  // not in the cave
    // Play when lightly bored: NASHI or CURIOSITY below 55, but not starving/sick
    if (Pet.needs[NeedType.KORA]   < 25) return false;
    if (Pet.needs[NeedType.MOKO]   < 20) return false;
    if (Pet.needs[NeedType.HEALTH] < 30) return false;
    if (Pet.needs[NeedType.NASHI]  < 60 || Pet.needs[NeedType.CURIOSITY] < 55) return true;
    // Occasionally play even when content
    return Math.random() < 0.05;
}

function startGame(key) {
    const def = GAMES[key];
    if (!def) return;
    const now = Date.now();
    // Game-specific initial data
    let data = {};
    if (key === 'chase_firefly') {
        data = { fireflyX: (Math.random() - 0.5) * 220, fireflyY: -30, phase: 0 };
    } else if (key === 'pebble_stack') {
        data = { stackX: (Math.random() - 0.5) * 120, stones: 0 };
    } else if (key === 'bubble_blow') {
        data = { bubbles: [] };
    } else if (key === 'dig_hole') {
        data = { holeX: (Math.random() - 0.5) * 150, dug: 0 };
    } else if (key === 'star_gaze') {
        data = { starX: (Math.random() * 0.6 + 0.2), starY: 0.1 + Math.random() * 0.2 };
    } else if (key === 'shadow_dance') {
        data = { spin: 0 };
    }
    _state = { key, startedAt: now, endsAt: now + def.duration, data };
    Pet._soloGame = _state;
    // Tiny narration
    const lines = {
        chase_firefly: 'shi! la-la… ven-thi!',
        pebble_stack:  'ko… ko… ko-thi!',
        shadow_dance:  'la-la-la shi!',
        star_gaze:     'selath… thi.',
        bubble_blow:   'vythi… la-shi!',
        dig_hole:      'shi-shi… ven!',
    };
    try { Events.emit('autonomy-speak', { line: lines[key] || 'thi!', mood: 'happy' }); } catch (_) {}
    Events.emit('solo-game-start', { key, label: def.label });
}

function endGame(reason = 'done') {
    if (!_state) return;
    const def = GAMES[_state.key];
    if (def && reason === 'done') {
        for (const [need, delta] of Object.entries(def.needs)) {
            Pet.needs[need] = Math.max(0, Math.min(100, Pet.needs[need] + delta));
        }
    }
    Events.emit('solo-game-end', { key: _state.key, reason });
    _state = null;
    Pet._soloGame = null;
}

function tickMotion() {
    if (!_state || !Pet.motion) return;
    const key = _state.key;
    const elapsed = (Date.now() - _state.startedAt) / 1000;
    if (key === 'chase_firefly') {
        _state.data.phase += 0.04;
        _state.data.fireflyX = Math.sin(_state.data.phase * 0.8) * 140 + Math.cos(_state.data.phase * 1.7) * 30;
        _state.data.fireflyY = -60 - Math.sin(_state.data.phase * 1.3) * 40;
        // Pet follows the firefly with a small delay
        Pet.motion.targetOffsetX = _state.data.fireflyX;
        Pet.motion.targetOffsetY = Math.min(0, _state.data.fireflyY + 58);
    } else if (key === 'pebble_stack') {
        Pet.motion.targetOffsetX = _state.data.stackX;
        Pet.motion.targetOffsetY = 0;
        // Drop a stone every ~5 seconds, up to 5 stones
        const wanted = Math.min(5, Math.floor(elapsed / 5));
        if (wanted > _state.data.stones) {
            _state.data.stones = wanted;
            Pet.motion.targetScaleBoost = -0.04;  // crouch nudge
            setTimeout(() => Pet.motion && (Pet.motion.targetScaleBoost = 0), 500);
        }
    } else if (key === 'shadow_dance') {
        _state.data.spin = elapsed;
        Pet.motion.targetOffsetX = Math.sin(elapsed * 3) * 40;
        Pet.motion.targetScaleBoost = Math.sin(elapsed * 6) * 0.05;
    } else if (key === 'star_gaze') {
        Pet.motion.targetOffsetX = 0;
        Pet.motion.targetOffsetY = 0;
    } else if (key === 'bubble_blow') {
        Pet.motion.targetOffsetY = Math.sin(elapsed * 2) * 3;
        if (Math.random() < 0.05) {
            _state.data.bubbles.push({
                x: (Math.random() - 0.5) * 20,
                y: -30,
                vy: -0.6 - Math.random() * 0.6,
                r: 2 + Math.random() * 4,
                hue: Math.random() * 360,
                life: 1,
            });
        }
        _state.data.bubbles = _state.data.bubbles.filter(b => b.life > 0);
        for (const b of _state.data.bubbles) {
            b.y += b.vy;
            b.life -= 0.008;
        }
    } else if (key === 'dig_hole') {
        Pet.motion.targetOffsetX = _state.data.holeX;
        Pet.motion.targetOffsetY = 0;
        _state.data.dug = Math.min(8, Math.floor(elapsed / 3));
    }

    if (Date.now() >= _state.endsAt) endGame('done');
}

export const SoloGames = {
    init() {
        if (_tick) clearInterval(_tick);
        // Evaluate every 30s whether to kick off a new game; motion tick is finer.
        _tick = setInterval(() => {
            if (!_state && shouldStart() && Math.random() < 0.4) {
                const k = pickGame();
                if (k) startGame(k);
            }
        }, 30_000);
        setInterval(tickMotion, 100);
        // Abort game if pet transitions to a blocking activity
        Events.on('activity-start', () => { if (_state) endGame('interrupted'); });
    },

    /** Read-only view for the renderer */
    getState() { return _state; },

    /** Immediate cancel (e.g., keeper action) */
    cancel() { endGame('interrupted'); },
};
