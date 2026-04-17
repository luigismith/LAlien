/**
 * sprite-loader.js -- Pixel-art sprite sheets for each Lalìen stage
 *
 * Loads PNG strip sheets from /sprites/stage_<N>_<name>/variant_<VV>/<anim>.png
 * Each sheet is N frames laid out horizontally; meta.json describes frame size,
 * count, fps. Exposes an API:
 *
 *   SpriteLoader.preloadStage(stage) → Promise (starts loading asynchronously)
 *   SpriteLoader.draw(ctx, pet, cx, cy, baseScale) — draws the right frame
 *
 * Activity/mood → animation mapping:
 *   dead/dying      → dead / dying
 *   egg (stage 0)   → idle (with egg-specific animation)
 *   SLEEPING        → sleep
 *   EATING          → eat
 *   MEDITATING      → sing (hum/drone pose)
 *   SICK            → sick
 *   AFRAID          → escaping
 *   SULKY           → sad
 *   evolving flag   → evolving
 *   minigame active → play
 *   mood = happy    → happy
 *   mood = sad      → sad
 *   mood = scared   → escaping
 *   default         → idle
 */
import { Activity } from '../pet/activity.js';

const STAGE_DIRS = [
    'stage_0_syrma',
    'stage_1_lalina',
    'stage_2_lalishi',
    'stage_3_laliko',
    'stage_4_laliren',
    'stage_5_lalivox',
    'stage_6_lalimere',
    'stage_7_lalithishi',
];

// Animations we care about — expected in meta.json (some may be missing → fallback to idle).
const ANIMS = ['idle','happy','sad','sick','eat','sleep','play','sing','escaping','evolving','dying','dead','transcending'];

// Cache: key = `${stage}:${variant}:${anim}` → { img, meta, loaded, failed }
const _cache = new Map();
const _metaCache = new Map();   // key = `${stage}:${variant}` → metaJson
let _basePath = 'sprites';       // relative to /

function key(stage, variant, anim) { return `${stage}:${variant}:${anim}`; }
function pad(n, w) { return String(n).padStart(w, '0'); }

function loadMeta(stage, variant) {
    const k = `${stage}:${variant}`;
    if (_metaCache.has(k)) return _metaCache.get(k);
    const url = `${_basePath}/${STAGE_DIRS[stage]}/variant_${pad(variant, 2)}/meta.json`;
    const p = fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
    _metaCache.set(k, p);
    return p;
}

function loadAnim(stage, variant, anim) {
    const k = key(stage, variant, anim);
    if (_cache.has(k)) return _cache.get(k);
    const url = `${_basePath}/${STAGE_DIRS[stage]}/variant_${pad(variant, 2)}/${anim}.png`;
    const entry = { img: new Image(), meta: null, loaded: false, failed: false };
    entry.img.onload = () => { entry.loaded = true; };
    entry.img.onerror = () => { entry.failed = true; };
    entry.img.src = url;
    // Piggy-back on the shared meta for this variant
    loadMeta(stage, variant).then(meta => {
        if (meta && meta.animations && meta.animations[anim]) {
            entry.meta = meta.animations[anim];
        } else if (meta && meta.animations && meta.animations.idle) {
            entry.meta = meta.animations.idle;
        }
    });
    _cache.set(k, entry);
    return entry;
}

/**
 * Determine which variant to use for a pet, deterministically from DNA hash.
 * We currently only ship variant_00 as baseline; other variants can be
 * added later by DNA hash mod N.
 */
function pickVariant(pet) {
    const idx = pet?.dna?.variantIndex;
    if (Number.isInteger(idx) && idx >= 0 && idx < 16) return idx;
    return 0;
}

function pickAnimation(pet) {
    if (!pet) return 'idle';
    if (!pet.isAlive || !pet.isAlive()) {
        // death sequence phase distinction can come later
        return pet.deathType === 2 ? 'transcending' : 'dying';
    }
    if (pet.stage === 0) return 'idle';  // egg

    const act = Activity.getType(pet);
    switch (act) {
        case 'SLEEPING':   return 'sleep';
        case 'EATING':     return 'eat';
        case 'MEDITATING': return 'sing';
        case 'SICK':       return 'sick';
        case 'AFRAID':     return 'escaping';
        case 'SULKY':      return 'sad';
    }

    const mood = pet.getMood ? pet.getMood() : 'neutral';
    if (mood === 'happy')  return 'happy';
    if (mood === 'sad')    return 'sad';
    if (mood === 'scared') return 'escaping';
    return 'idle';
}

// Current anim fade bookkeeping (simple crossfade on animation changes)
const _animState = { current: null, previous: null, transition: 0 };

export const SpriteLoader = {
    setBasePath(p) { _basePath = p; },

    /** Start loading all animations for a stage/variant. Returns a Promise. */
    preloadStage(stage, variant = 0) {
        const meta = loadMeta(stage, variant);
        for (const a of ANIMS) loadAnim(stage, variant, a);
        return meta;
    },

    /** Draw the pet at (cx, cy), size controlled by baseScale (logical px). */
    draw(ctx, pet, cx, cy, baseScale = 1) {
        if (!pet || pet.stage == null) return false;
        const variant = pickVariant(pet);
        const anim = pickAnimation(pet);
        const entry = loadAnim(pet.stage, variant, anim);

        // Fallback chain: if not loaded or failed, try idle
        let active = entry;
        if (!active.loaded && anim !== 'idle') {
            active = loadAnim(pet.stage, variant, 'idle');
        }
        if (!active.loaded || active.failed) {
            // Image still loading or missing — fall back to procedural
            return false;
        }

        // Default meta fallback if JSON hasn't loaded yet (race condition on first frames)
        const meta = active.meta || { frames: 4, fps: 4, frame_width: 64, frame_height: 64 };
        const frames = meta.frames || 1;
        const fps = meta.fps || 4;
        const fw = meta.frame_width || 64;
        const fh = meta.frame_height || 64;
        const elapsed = (performance.now() / 1000) * fps;
        const frameIdx = Math.floor(elapsed) % frames;

        // Target drawn size — pet should occupy a strong portion of the canvas
        const stage = pet.stage;
        const targetH = (140 + stage * 22) * baseScale;   // was 60 + stage*12 (too small)
        const targetW = targetH * (fw / fh);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        // Crispness: floor to integer pixels so upscaling stays blocky
        const dx = Math.round(cx - targetW / 2);
        const dy = Math.round(cy - targetH / 2);
        ctx.drawImage(
            active.img,
            frameIdx * fw, 0, fw, fh,
            dx, dy,
            Math.round(targetW), Math.round(targetH)
        );
        ctx.restore();
        return true;
    },

    /** Test helper: is stage fully loaded? */
    isReady(stage, variant = 0) {
        const idle = _cache.get(key(stage, variant, 'idle'));
        return !!(idle && idle.loaded);
    },

    /** Width/height the pet occupies on screen (for hit-testing, overlays) */
    getBodySize(pet, baseScale = 1) {
        const stage = pet?.stage ?? 0;
        const targetH = (140 + stage * 22) * baseScale;
        return { w: targetH, h: targetH };
    },
};
