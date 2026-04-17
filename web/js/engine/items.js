/**
 * items.js -- Physical items the keeper can drop on the scene.
 *
 * The keeper drags a chip outside the pet's body and releases on the floor:
 * an item (food / toy / plush / snack…) materializes at that spot. The pet
 * autonomously walks toward it and consumes/uses it.
 *
 * Item lifecycle:
 *   spawn → target for pet → consume on contact → vanish
 * Items have a lifespan (food spoils after 15 min real, toys last ~5 uses).
 */
import { Pet } from '../pet/pet.js';
import { NeedType } from '../pet/needs.js';
import { Events } from './events.js';
import { Activity } from '../pet/activity.js';

// mode: 'consumable' = one-shot effect + uses decrement + vanish when depleted
//       'persistent' = pet stays nearby and gets continuous bonus; uses tick
//                      down slowly over time (1 use per 60s), then vanishes
const ITEM_TYPES = {
    feed:   { icon: '🍎', label: 'Cibo',     kind: 'food',  mode: 'consumable', need: NeedType.KORA,      lifespanMs: 15*60*1000 },
    play:   { icon: '🎮', label: 'Giocattolo', kind: 'toy', mode: 'persistent', need: NeedType.NASHI,     uses: 8,  lifespanMs: 30*60*1000, tickBonus: 0.35, stayRadius: 50 },
    caress: { icon: '🧸', label: 'Peluche',  kind: 'plush', mode: 'persistent', need: NeedType.AFFECTION, uses: 12, lifespanMs: 60*60*1000, tickBonus: 0.25, stayRadius: 40 },
    talk:   { icon: '📻', label: 'Radio',    kind: 'media', mode: 'persistent', need: NeedType.COGNITION, uses: 10, lifespanMs: 30*60*1000, tickBonus: 0.30, stayRadius: 60 },
    clean:  { icon: '🧼', label: 'Sapone',   kind: 'clean', mode: 'consumable', need: NeedType.MISKA,     uses: 3,  lifespanMs: 10*60*1000 },
    sleep:  { icon: '🛏️', label: 'Cuscino',  kind: 'bed',   mode: 'consumable', need: NeedType.MOKO,      lifespanMs: 60*60*1000 },
    meditate:{ icon: '✨', label: 'Cristallo', kind: 'crystal', mode: 'consumable', need: NeedType.COSMIC, uses: 3, lifespanMs: 60*60*1000 },
    ball:   { icon: '🏐', label: 'Palla',     kind: 'ball',  mode: 'persistent', need: NeedType.CURIOSITY, uses: 8, lifespanMs: 20*60*1000, tickBonus: 0.30, stayRadius: 45 },
    puzzle: { icon: '🧩', label: 'Puzzle',    kind: 'puzzle',mode: 'persistent', need: NeedType.COGNITION, uses: 10, lifespanMs: 40*60*1000, tickBonus: 0.25, stayRadius: 55 },
};

let _items = [];
let _nextId = 1;
let _targetItemId = null;          // the item the pet is currently walking toward
let _stageWidth = 800;
let _stageHeight = 600;

function now() { return Date.now(); }

function ensureTarget() {
    if (_targetItemId) {
        const still = _items.find(i => i.id === _targetItemId);
        if (still) return still;
    }
    // Pick the closest interesting item matching a low need
    if (!_items.length) { _targetItemId = null; return null; }
    const weight = (it) => {
        const def = ITEM_TYPES[it.action];
        if (!def) return 0;
        const need = Pet.needs[def.need] ?? 100;
        return 100 - need;
    };
    _items.sort((a, b) => weight(b) - weight(a));
    const t = _items[0];
    _targetItemId = t ? t.id : null;
    return t;
}

function consumeItem(it) {
    const def = ITEM_TYPES[it.action];
    if (!def) return;
    // Apply effect based on kind
    switch (def.kind) {
        case 'food':
            Pet.needs[def.need] = Math.min(100, Pet.needs[def.need] + 35);
            Pet.needs[NeedType.NASHI] = Math.min(100, Pet.needs[NeedType.NASHI] + 3);
            break;
        case 'toy':
            Pet.needs[def.need] = Math.min(100, Pet.needs[def.need] + 18);
            Pet.needs[NeedType.CURIOSITY] = Math.min(100, Pet.needs[NeedType.CURIOSITY] + 8);
            break;
        case 'plush':
            Pet.needs[def.need] = Math.min(100, Pet.needs[def.need] + 15);
            Pet.needs[NeedType.SECURITY] = Math.min(100, Pet.needs[NeedType.SECURITY] + 10);
            break;
        case 'media':
            Pet.needs[def.need] = Math.min(100, Pet.needs[def.need] + 15);
            break;
        case 'clean':
            Pet.needs[def.need] = Math.min(100, Pet.needs[def.need] + 30);
            break;
        case 'bed':
            // Pet sleeps when reaching a bed — only if not already sleeping
            if (!Activity.is(Pet, Activity.Type.SLEEPING)) {
                Activity.start(Pet, Activity.Type.SLEEPING, { fromBed: true });
            }
            break;
        case 'crystal':
            if (Pet.stage >= 6 && !Activity.is(Pet, Activity.Type.MEDITATING)) {
                Activity.start(Pet, Activity.Type.MEDITATING);
            } else {
                Pet.needs[def.need] = Math.min(100, Pet.needs[def.need] + 10);
            }
            break;
    }
    Events.emit('item-consumed', { action: it.action, x: it.x, y: it.y });
    // Decrement uses or delete
    if (def.uses && it.usesLeft > 1) {
        it.usesLeft--;
        it.lastUseAt = now();
    } else {
        _items = _items.filter(o => o !== it);
        if (_targetItemId === it.id) _targetItemId = null;
    }
}

export const Items = {
    ITEM_TYPES,

    /** Logic tick — expire old items, advance pet position toward target */
    tick(pet, dt) {
        const t = now();
        // Expire
        _items = _items.filter(it => t - it.createdAt < ITEM_TYPES[it.action].lifespanMs);

        if (!pet || !pet.isAlive || !pet.isAlive() || pet.isEgg()) return;
        const act = Activity.getType(pet);
        if (['SLEEPING','EATING','MEDITATING','SICK'].indexOf(act) !== -1) return;

        // Pick a target item
        const target = ensureTarget();
        if (!target) {
            // No items → release the motion lock if we had one set it
            if (pet._itemWalking) {
                pet._itemWalking = false;
                if (pet.motion) pet.motion.targetOffsetX = 0;
            }
            return;
        }

        if (!pet.motion) pet.motion = { offsetX: 0, offsetY: 0, targetOffsetX: 0, targetOffsetY: 0, bob: 0, scaleBoost: 0 };

        // Walk only HORIZONTALLY — pet stays on the ground line.
        // Compute desired offset so that target.x lines up with pet position.
        // worldCx is the pet's "home" base; motion.offsetX shifts it left/right.
        const worldCx = _stageWidth / 2;
        let desiredDx = target.x - worldCx;
        // Clamp to canvas so pet never walks off-screen
        const maxOff = _stageWidth * 0.42;
        desiredDx = Math.max(-maxOff, Math.min(maxOff, desiredDx));

        pet.motion.targetOffsetX = desiredDx;
        pet.motion.targetOffsetY = 0;        // STAY on ground (no vertical dive)
        pet._itemWalking = true;

        const cfg = ITEM_TYPES[target.action];
        const reach = cfg.stayRadius || 30;
        const distToTarget = Math.abs(pet.motion.offsetX - desiredDx);

        if (distToTarget < reach) {
            if (cfg.mode === 'persistent') {
                // Continuous bonus while near the toy — keeps the pet entertained
                pet.needs[cfg.need] = Math.min(100, pet.needs[cfg.need] + (cfg.tickBonus || 0.2));
                // Also a tiny ambient boost so nearby toys lift mood
                pet.needs[NeedType.NASHI] = Math.min(100, pet.needs[NeedType.NASHI] + 0.05);
                // Decay uses slowly (1 use per 60 real seconds)
                if (!target.lastUseAt) target.lastUseAt = now();
                if (now() - target.lastUseAt > 60 * 1000) {
                    target.usesLeft = (target.usesLeft || 1) - 1;
                    target.lastUseAt = now();
                    Events.emit('item-used', { action: target.action });
                    if (target.usesLeft <= 0) {
                        _items = _items.filter(o => o !== target);
                        _targetItemId = null;
                    }
                }
            } else {
                // One-shot consumable
                consumeItem(target);
            }
        }
    },

    /** Place a new item at canvas-relative coordinates.
     *  Y is snapped near the ground so the pet can reach it without diving off-screen. */
    spawn(action, x, y) {
        const def = ITEM_TYPES[action];
        if (!def) return null;
        // Clamp x to canvas bounds with a margin; snap y to ground region
        const clampedX = Math.max(40, Math.min(_stageWidth - 40, x));
        const groundY = _stageHeight * 0.72;
        const finalY = Math.max(groundY - 20, Math.min(_stageHeight - 30, y));
        const it = {
            id: _nextId++,
            action,
            x: clampedX,
            y: finalY,
            createdAt: now(),
            usesLeft: def.uses || 1,
            lastUseAt: now(),
        };
        _items.push(it);
        Events.emit('item-spawned', { action, x: clampedX, y: finalY });
        return it;
    },

    getAll() { return [..._items]; },
    clear() { _items = []; _targetItemId = null; },
    setStage(w, h) { _stageWidth = w; _stageHeight = h; },
    /** Drawn in renderer — returns list to paint */
    draw(ctx, tick) {
        const t = now();
        for (const it of _items) {
            const def = ITEM_TYPES[it.action];
            if (!def) continue;
            const age = t - it.createdAt;
            const lifeRatio = age / def.lifespanMs;
            const bob = Math.sin(tick * 0.05 + it.id * 1.3) * 2.5;
            const alpha = lifeRatio > 0.85 ? (1 - (lifeRatio - 0.85) / 0.15) * 0.9 + 0.1 : 1;
            ctx.save();
            ctx.globalAlpha = alpha;
            // Drop shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath();
            ctx.ellipse(it.x, it.y + 20, 16, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            // Icon emoji
            ctx.font = '32px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#000';
            ctx.shadowBlur = 6;
            ctx.fillText(def.icon, it.x, it.y + bob);
            // Uses indicator if applicable
            if (def.uses && it.usesLeft < def.uses) {
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#EAFBFB';
                ctx.font = 'bold 10px monospace';
                ctx.fillText(`${it.usesLeft}/${def.uses}`, it.x, it.y + 24);
            }
            ctx.restore();
        }
    },
};
