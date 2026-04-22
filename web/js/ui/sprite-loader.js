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
        // Play a bit faster than the metadata to hide the choppiness of 4-frame
        // loops — combined with the cross-fade below it reads much smoother.
        const fps = (meta.fps || 4) * 1.35;
        const fw = meta.frame_width || 64;
        const fh = meta.frame_height || 64;
        const elapsed = (performance.now() / 1000) * fps;
        const frameIdx = Math.floor(elapsed) % frames;
        // Fractional portion → used to cross-blend this frame into the next
        // (inter-frame tween) so motion never snaps hard between keyframes.
        const frameBlend = elapsed - Math.floor(elapsed);
        const nextFrameIdx = (frameIdx + 1) % frames;

        // Target drawn size — pet should occupy a strong portion of the canvas
        const stage = pet.stage;
        const targetH = (140 + stage * 22) * baseScale;   // was 60 + stage*12 (too small)
        const targetW = targetH * (fw / fh);

        // Dynamic transforms: squash/stretch, lean, bounce
        const mo = pet.motion || {};
        const activity = pet.activity ? pet.activity.type : 'IDLE';
        const now = performance.now() / 1000;

        // Breathing squash/stretch (subtle body pulse)
        const breathRate = activity === 'SLEEPING' ? 0.8 : (activity === 'EATING' ? 2.5 : 1.4);
        const breathAmt = activity === 'SLEEPING' ? 0.04 : 0.025;
        const breathPhase = Math.sin(now * breathRate);
        let scaleX = 1 + breathPhase * breathAmt;
        let scaleY = 1 - breathPhase * breathAmt;

        // Walking lean: tilt when moving horizontally
        let rotation = 0;
        const vel = (mo.targetOffsetX || 0) - (mo.offsetX || 0);
        if (Math.abs(vel) > 2) {
            rotation = Math.sign(vel) * 0.06;  // lean into movement
            // Walking bob: alternate feet bounce
            const walkBob = Math.sin(now * 6) * 2.5;
            cy += walkBob;
        }

        // Hop landing squash (when offsetY transitions from negative to zero)
        if (mo._lastOffY !== undefined && mo._lastOffY < -5 && Math.abs(mo.offsetY || 0) < 2) {
            mo._squashTimer = 8;  // frames of squash
        }
        mo._lastOffY = mo.offsetY || 0;
        if (mo._squashTimer > 0) {
            const t = mo._squashTimer / 8;
            scaleX *= 1 + t * 0.15;   // widen
            scaleY *= 1 - t * 0.12;   // flatten
            mo._squashTimer--;
        }

        // Eating: rhythmic forward bob
        if (activity === 'EATING') {
            const eatBob = Math.sin(now * 4) * 3;
            cx += eatBob;
            scaleY *= 1 + Math.abs(Math.sin(now * 4)) * 0.03;
        }

        // Afraid: rapid micro-shiver
        if (activity === 'AFRAID') {
            cx += (Math.random() - 0.5) * 3;
            cy += (Math.random() - 0.5) * 1.5;
        }

        // Sulky: slight turn away (scale X negative = mirror flip)
        if (activity === 'SULKY') {
            scaleX *= -1;  // turned away
            rotation = -0.04;
        }

        // Stage-specific idle motion on top of the sprite. This gives every
        // evolution its own "signature" micro-animation even when the sprite
        // sheet itself is only 4 frames (procedurally generated baseline).
        //   0 egg:      subtle vertical heartbeat pulse
        //   1 newborn:  small peek-out body jitter
        //   2 infant:   side-to-side baby rock
        //   3 child:    playful torso lean + tiny hop idle every ~6s
        //   4 teen:     confident sway, slight head tilt bias
        //   5 adult:    slow measured sway
        //   6 elder:    very slow drift, breath longer
        //   7 transcen: gentle rotation + alpha shimmer + dilation breath
        const stage = pet.stage;
        let idleRotBias = 0;
        let idleTx = 0, idleTy = 0;
        let idleAlpha = 1;
        if (activity === 'IDLE' || !activity || activity === 'MEDITATING') {
            switch (stage) {
                case 0: { // heartbeat
                    const hb = Math.abs(Math.sin(now * 2.2));
                    scaleY *= 1 + hb * 0.035;
                    scaleX *= 1 - hb * 0.012;
                    break;
                }
                case 1: { // peek jitter
                    idleTx = Math.sin(now * 1.6) * 1.2;
                    idleTy = Math.cos(now * 2.1) * 0.9;
                    break;
                }
                case 2: { // baby rock
                    idleRotBias = Math.sin(now * 1.1) * 0.07;
                    idleTy = Math.abs(Math.sin(now * 1.1)) * -1.4;
                    break;
                }
                case 3: { // playful torso
                    idleRotBias = Math.sin(now * 0.9) * 0.05;
                    idleTx = Math.sin(now * 0.9) * 3;
                    const bounceGate = Math.sin(now * 0.17);       // ~6s period
                    if (bounceGate > 0.92) idleTy = -4 * (bounceGate - 0.92) / 0.08;
                    break;
                }
                case 4: { // teen confident sway
                    idleRotBias = Math.sin(now * 0.75) * 0.055;
                    idleTx = Math.sin(now * 0.75) * 4;
                    break;
                }
                case 5: { // adult measured sway
                    idleRotBias = Math.sin(now * 0.55) * 0.035;
                    idleTx = Math.sin(now * 0.55) * 2.5;
                    break;
                }
                case 6: { // elder slow drift
                    idleRotBias = Math.sin(now * 0.38) * 0.025;
                    idleTx = Math.sin(now * 0.38) * 1.8;
                    scaleY *= 1 + Math.sin(now * 0.6) * 0.008;     // longer breath
                    break;
                }
                case 7: { // transcendent — ethereal
                    idleRotBias = Math.sin(now * 0.45) * 0.045;
                    idleTy = Math.sin(now * 0.9) * 2;
                    const shimmer = 0.5 + 0.5 * Math.sin(now * 2.3);
                    idleAlpha = 0.78 + shimmer * 0.22;              // translucency
                    scaleX *= 1 + Math.sin(now * 0.9) * 0.025;      // dilation
                    scaleY *= 1 + Math.cos(now * 0.9) * 0.025;
                    break;
                }
            }
        }
        rotation += idleRotBias;

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.translate(Math.round(cx + idleTx), Math.round(cy + idleTy));
        ctx.rotate(rotation);
        ctx.scale(scaleX, scaleY);

        // Draw the current frame at full alpha, then the next frame overlaid
        // at `frameBlend` alpha. This cross-fades between the 4 keyframes so
        // the eye sees continuous motion instead of a 4fps strobing loop.
        // Stage-7 translucency rides on top via globalAlpha.
        const drawX = Math.round(-targetW / 2);
        const drawY = Math.round(-targetH / 2);
        const drawW = Math.round(targetW);
        const drawH = Math.round(targetH);
        ctx.globalAlpha = idleAlpha;
        ctx.drawImage(active.img, frameIdx * fw, 0, fw, fh, drawX, drawY, drawW, drawH);
        if (frameBlend > 0.02 && frames > 1) {
            ctx.globalAlpha = idleAlpha * frameBlend;
            ctx.drawImage(active.img, nextFrameIdx * fw, 0, fw, fh, drawX, drawY, drawW, drawH);
        }

        // Stage-7 transcendent: emit a few sparkle particles around the silhouette.
        if (stage === 7 && (activity === 'IDLE' || !activity || activity === 'MEDITATING')) {
            ctx.globalAlpha = 0.55 + 0.3 * Math.sin(now * 3);
            const sparkles = 3;
            for (let i = 0; i < sparkles; i++) {
                const ang = now * 0.6 + i * (Math.PI * 2 / sparkles);
                const r = targetH * 0.55;
                const sx = Math.cos(ang) * r;
                const sy = Math.sin(ang * 0.8 + now * 0.4) * r * 0.4;
                const size = 1.5 + Math.sin(now * 2 + i) * 0.8;
                ctx.fillStyle = i % 2 ? '#FFF4B4' : '#EAFFFF';
                ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(size), Math.round(size));
            }
        }

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
