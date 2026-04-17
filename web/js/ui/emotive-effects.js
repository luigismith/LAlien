/**
 * emotive-effects.js -- Pixel-art particles + symbolic feedback overlays
 *
 * Sits ABOVE the pet sprite. Draws contextual particles (hearts, tears,
 * question marks, music notes, sparkles, sweat drops, exclamation) and
 * simulates "missing sprites" (caress, thinking, surprised, meditating-
 * specific) as canvas overlays on top of the base sprite.
 *
 * Also owns a small screen-shake buffer used on flinches/scares.
 */
import { Pet } from '../pet/pet.js';
import { Activity } from '../pet/activity.js';
import { NeedType } from '../pet/needs.js';
import { Events } from '../engine/events.js';
import { Interactions } from './interactions.js';

const _particles = [];
let _shakeMagnitude = 0;
let _shakeDecay = 0.92;
let _flashColor = null;
let _flashAlpha = 0;
let _thinkingUntil = 0;

// 16-bit palette
const PAL = {
    heartRed:   '#E0506A',
    heartDark:  '#8C2840',
    tearBlue:   '#A0D8F0',
    tearDark:   '#4888B0',
    gold:       '#FFE899',
    goldDark:   '#A87820',
    note:       '#C080E0',
    noteDark:   '#603090',
    question:   '#F0E060',
    excl:       '#FF5050',
    sweat:      '#8CC8E0',
    sparkleW:   '#FFFFFF',
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---------------------------------------------------------------------------
// Pixel-art primitive drawers (no antialiasing — stroked with integer rects)
// ---------------------------------------------------------------------------

function pxHeart(ctx, cx, cy, size, color, dark) {
    // ~10×8 px heart at size 1, scaled
    const s = Math.max(1, Math.round(size / 10));
    const grid = [
        '0110011000',
        '1221122100',
        '1222222210',
        '1222222210',
        '0122222210',
        '0012222100',
        '0001221000',
        '0000110000',
    ];
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const v = grid[y][x];
            if (v === '0') continue;
            ctx.fillStyle = v === '1' ? dark : color;
            ctx.fillRect(cx - 5 * s + x * s, cy - 4 * s + y * s, s, s);
        }
    }
}

function pxTear(ctx, cx, cy, size, color, dark) {
    const s = Math.max(1, Math.round(size / 6));
    const grid = [
        '001100',
        '012210',
        '122221',
        '122221',
        '012210',
        '001100',
    ];
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const v = grid[y][x];
            if (v === '0') continue;
            ctx.fillStyle = v === '1' ? dark : color;
            ctx.fillRect(cx - 3 * s + x * s, cy - 3 * s + y * s, s, s);
        }
    }
}

function pxNote(ctx, cx, cy, size, color, dark) {
    const s = Math.max(1, Math.round(size / 8));
    // Eighth note: rounded head + stem
    ctx.fillStyle = dark;
    ctx.fillRect(cx - 1 * s, cy - 5 * s, s, 6 * s);
    ctx.fillStyle = color;
    ctx.fillRect(cx - 3 * s, cy - 1 * s, 4 * s, 2 * s);
    ctx.fillStyle = dark;
    ctx.fillRect(cx - 3 * s, cy - 1 * s, s, 2 * s);
    ctx.fillRect(cx + s, cy - 1 * s, s, 2 * s);
}

function pxSparkle(ctx, cx, cy, size, color) {
    const s = Math.max(1, Math.round(size / 6));
    ctx.fillStyle = color;
    ctx.fillRect(cx - s * 0.5, cy - 3 * s, s, 6 * s);
    ctx.fillRect(cx - 3 * s, cy - s * 0.5, 6 * s, s);
    ctx.fillRect(cx - s, cy - s, 2 * s, 2 * s);
}

function pxQuestion(ctx, cx, cy, size, color) {
    const s = Math.max(1, Math.round(size / 8));
    const grid = [
        '011100',
        '100010',
        '000010',
        '000100',
        '001000',
        '001000',
        '000000',
        '001000',
    ];
    ctx.fillStyle = color;
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            if (grid[y][x] === '1') ctx.fillRect(cx - 3 * s + x * s, cy - 4 * s + y * s, s, s);
        }
    }
}

function pxExclam(ctx, cx, cy, size, color) {
    const s = Math.max(1, Math.round(size / 6));
    ctx.fillStyle = color;
    ctx.fillRect(cx - s * 0.5, cy - 4 * s, s, 4 * s);
    ctx.fillRect(cx - s * 0.5, cy + s, s, s);
}

// ---------------------------------------------------------------------------
// Particle spawn API
// ---------------------------------------------------------------------------
function spawn(type, x, y, opts = {}) {
    _particles.push({
        type,
        x, y,
        vx: opts.vx ?? (Math.random() - 0.5) * 1.2,
        vy: opts.vy ?? -(0.5 + Math.random() * 1.2),
        life: 1.0,
        decay: opts.decay ?? 0.016,
        size: opts.size ?? 14,
        color: opts.color,
        gravity: opts.gravity ?? -0.02,
        spin: opts.spin ?? 0,
        born: performance.now(),
    });
}

// ---------------------------------------------------------------------------
// Public: trigger effects on events
// ---------------------------------------------------------------------------
function hearts(cx, cy, count = 5, color = PAL.heartRed, dark = PAL.heartDark) {
    for (let i = 0; i < count; i++) {
        spawn('heart', cx + (Math.random() - 0.5) * 40, cy - 20, {
            vx: (Math.random() - 0.5) * 1.8,
            vy: -(1 + Math.random() * 1.5),
            size: 12 + Math.random() * 8,
            decay: 0.012,
            color: { light: color, dark },
        });
    }
}
function tears(cx, cy, count = 3) {
    for (let i = 0; i < count; i++) {
        spawn('tear', cx + (Math.random() - 0.5) * 30, cy + 10, {
            vx: (Math.random() - 0.5) * 0.6,
            vy: 0.8 + Math.random() * 0.6,
            gravity: 0.04,
            size: 8 + Math.random() * 4,
            decay: 0.010,
        });
    }
}
function musicNotes(cx, cy, count = 4) {
    for (let i = 0; i < count; i++) {
        setTimeout(() => spawn('note', cx + (Math.random() - 0.5) * 20, cy - 30, {
            vx: (Math.random() - 0.5) * 0.8,
            vy: -(0.6 + Math.random() * 0.6),
            size: 14 + Math.random() * 4,
            decay: 0.008,
            spin: (Math.random() - 0.5) * 0.05,
        }), i * 150);
    }
}
function sparkles(cx, cy, count = 6, color = PAL.gold) {
    for (let i = 0; i < count; i++) {
        spawn('sparkle', cx + (Math.random() - 0.5) * 50, cy + (Math.random() - 0.5) * 50, {
            vx: (Math.random() - 0.5) * 0.8,
            vy: -(0.3 + Math.random() * 0.8),
            size: 10 + Math.random() * 6,
            decay: 0.018,
            color: { light: color },
        });
    }
}
function sweatDrops(cx, cy) {
    spawn('tear', cx + 15, cy - 25, {
        vx: 0.3, vy: 0.4, gravity: 0.06, size: 10, color: { light: PAL.sweat, dark: '#406080' }, decay: 0.014,
    });
}
function questionMark(cx, cy) {
    spawn('question', cx + 20, cy - 45, { vx: 0, vy: -0.2, gravity: 0, size: 16, decay: 0.010 });
}
function exclamation(cx, cy) {
    spawn('excl', cx, cy - 55, { vx: 0, vy: -0.6, gravity: 0, size: 18, decay: 0.020 });
}

function shake(magnitude = 6, decay = 0.88) {
    _shakeMagnitude = Math.max(_shakeMagnitude, magnitude);
    _shakeDecay = decay;
}
function flash(color, alpha = 0.5) {
    _flashColor = color;
    _flashAlpha = alpha;
}
function setThinking(ms = 2000) {
    _thinkingUntil = performance.now() + ms;
}

// ---------------------------------------------------------------------------
// Auto-emissions based on pet state (called per frame)
// ---------------------------------------------------------------------------
let _autoLastCheck = 0;
function autoEmit(cx, cy, tick) {
    const now = performance.now();
    if (now - _autoLastCheck < 1200) return;
    _autoLastCheck = now;

    if (!Pet || !Pet.isAlive || !Pet.isAlive() || Pet.isEgg()) return;
    const act = Activity.getType(Pet);
    const isPetting = Interactions.isPetting && Interactions.isPetting();

    if (isPetting) hearts(cx, cy - 10, 2);
    if (act === 'SULKY') tears(cx, cy, 1);
    if (act === 'AFRAID') sweatDrops(cx, cy);
    if (act === 'SICK' && Math.random() < 0.6) sweatDrops(cx, cy);
    if (act === 'MEDITATING' && Math.random() < 0.7) musicNotes(cx, cy, 1);
    if (act === 'SLEEPING') return;  // Zs are handled elsewhere
    if (Pet.needs[NeedType.NASHI] > 80 && Pet.needs[NeedType.AFFECTION] > 70 && Math.random() < 0.25) {
        sparkles(cx, cy, 2, PAL.gold);
    }
}

// ---------------------------------------------------------------------------
// Facial overlays — drawn ON TOP of the sprite for real-time expression
// ---------------------------------------------------------------------------
function drawFace(ctx, cx, cy, tick) {
    if (!Pet || !Pet.isAlive || !Pet.isAlive() || Pet.isEgg()) return;

    const act = Activity.getType(Pet);
    const mood = Pet.getMood ? Pet.getMood() : 'neutral';
    const stage = Pet.stage || 0;
    const isPetting = Interactions.isPetting && Interactions.isPetting();

    // Scale factor: bigger pet = bigger overlays
    const sc = (140 + stage * 22) / 140;
    const eyeY = cy - 14 * sc;   // approximate eye region center
    const eyeSpan = 12 * sc;     // half-distance between eyes

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // Blush when being pet or very happy
    if (isPetting || (Pet.needs[NeedType.NASHI] > 85 && Pet.needs[NeedType.AFFECTION] > 80)) {
        const blushAlpha = isPetting ? 0.65 : 0.35;
        ctx.globalAlpha = blushAlpha;
        ctx.fillStyle = '#E08090';
        const bs = Math.max(3, 4 * sc);
        ctx.fillRect(Math.round(cx - eyeSpan - bs * 1.5), Math.round(eyeY + 6 * sc), bs, bs * 0.6);
        ctx.fillRect(Math.round(cx + eyeSpan + bs * 0.5), Math.round(eyeY + 6 * sc), bs, bs * 0.6);
        ctx.globalAlpha = 1;
    }

    // Angry eyebrows when SULKY
    if (act === 'SULKY') {
        ctx.strokeStyle = '#4A2A2A';
        ctx.lineWidth = Math.max(2, 2.5 * sc);
        ctx.lineCap = 'round';
        // Left brow: angled down-inward
        ctx.beginPath();
        ctx.moveTo(Math.round(cx - eyeSpan - 5 * sc), Math.round(eyeY - 8 * sc));
        ctx.lineTo(Math.round(cx - eyeSpan + 3 * sc), Math.round(eyeY - 4 * sc));
        ctx.stroke();
        // Right brow: mirror
        ctx.beginPath();
        ctx.moveTo(Math.round(cx + eyeSpan + 5 * sc), Math.round(eyeY - 8 * sc));
        ctx.lineTo(Math.round(cx + eyeSpan - 3 * sc), Math.round(eyeY - 4 * sc));
        ctx.stroke();
    }

    // Worried brows when AFRAID
    if (act === 'AFRAID') {
        ctx.strokeStyle = '#6060A0';
        ctx.lineWidth = Math.max(1.5, 2 * sc);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(Math.round(cx - eyeSpan - 4 * sc), Math.round(eyeY - 5 * sc));
        ctx.lineTo(Math.round(cx - eyeSpan + 2 * sc), Math.round(eyeY - 8 * sc));
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.round(cx + eyeSpan + 4 * sc), Math.round(eyeY - 5 * sc));
        ctx.lineTo(Math.round(cx + eyeSpan - 2 * sc), Math.round(eyeY - 8 * sc));
        ctx.stroke();
    }

    // Spiral eyes when SICK (dizzy)
    if (act === 'SICK') {
        ctx.strokeStyle = '#90C070';
        ctx.lineWidth = Math.max(1, 1.5 * sc);
        ctx.globalAlpha = 0.7;
        for (const side of [-1, 1]) {
            const ex = cx + side * eyeSpan;
            ctx.beginPath();
            const spiralR = 4 * sc;
            for (let a = 0; a < Math.PI * 3; a += 0.15) {
                const r = (a / (Math.PI * 3)) * spiralR;
                const px = ex + Math.cos(a + tick * 0.04) * r;
                const py = eyeY + Math.sin(a + tick * 0.04) * r;
                a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // Star/sparkle eyes when mood is happy AND high affection (ecstatic)
    if (mood === 'happy' && Pet.needs[NeedType.AFFECTION] > 80 && act === 'IDLE') {
        const sparkle = Math.sin(tick * 0.08) * 0.5 + 0.5;
        ctx.globalAlpha = 0.6 + sparkle * 0.3;
        ctx.fillStyle = '#FFE899';
        for (const side of [-1, 1]) {
            const ex = cx + side * eyeSpan;
            pxSparkle(ctx, Math.round(ex), Math.round(eyeY), 8 * sc, '#FFE899');
        }
        ctx.globalAlpha = 1;
    }

    // Closed content eyes when SLEEPING (complement the sprite's sleep pose)
    if (act === 'SLEEPING') {
        const wobble = Math.sin(tick * 0.025) * 0.6;
        ctx.strokeStyle = 'rgba(40,30,60,0.55)';
        ctx.lineWidth = Math.max(1.5, 2 * sc);
        ctx.lineCap = 'round';
        for (const side of [-1, 1]) {
            const ex = cx + side * eyeSpan;
            ctx.beginPath();
            ctx.moveTo(Math.round(ex - 4 * sc), Math.round(eyeY + wobble));
            ctx.quadraticCurveTo(Math.round(ex), Math.round(eyeY + 2 * sc + wobble), Math.round(ex + 4 * sc), Math.round(eyeY + wobble));
            ctx.stroke();
        }
    }

    // Tear streams when SAD or SULKY (thin pixel lines from eyes)
    if (mood === 'sad' || act === 'SULKY') {
        ctx.fillStyle = '#A0D8F0';
        ctx.globalAlpha = 0.6;
        for (const side of [-1, 1]) {
            const ex = cx + side * eyeSpan;
            const tearPhase = (tick * 0.5 + side * 20) % 30;
            const ty = eyeY + 4 * sc + tearPhase * 0.7 * sc;
            const alpha = 1 - tearPhase / 30;
            ctx.globalAlpha = alpha * 0.6;
            ctx.fillRect(Math.round(ex + side * 2 * sc), Math.round(ty), Math.max(1.5, 2 * sc), Math.max(1.5, 2 * sc));
        }
        ctx.globalAlpha = 1;
    }

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Render (called from the renderer overlay pass)
// ---------------------------------------------------------------------------
function draw(ctx, cx, cy, tick) {
    // Draw facial overlays FIRST (on top of sprite, before particles)
    drawFace(ctx, cx, cy, tick);
    autoEmit(cx, cy, tick);

    // Shake is applied by renderer (reads via getShakeOffset)
    // Update shake decay
    _shakeMagnitude *= _shakeDecay;
    if (_shakeMagnitude < 0.2) _shakeMagnitude = 0;

    // Update and draw particles
    for (let i = _particles.length - 1; i >= 0; i--) {
        const p = _particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.life -= p.decay;
        if (p.life <= 0) { _particles.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.imageSmoothingEnabled = false;
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        switch (p.type) {
            case 'heart':
                pxHeart(ctx, px, py, p.size, p.color?.light || PAL.heartRed, p.color?.dark || PAL.heartDark);
                break;
            case 'tear':
                pxTear(ctx, px, py, p.size, p.color?.light || PAL.tearBlue, p.color?.dark || PAL.tearDark);
                break;
            case 'note':
                pxNote(ctx, px, py, p.size, p.color?.light || PAL.note, p.color?.dark || PAL.noteDark);
                break;
            case 'sparkle':
                pxSparkle(ctx, px, py, p.size, p.color?.light || PAL.gold);
                break;
            case 'question':
                pxQuestion(ctx, px, py, p.size, p.color?.light || PAL.question);
                break;
            case 'excl':
                pxExclam(ctx, px, py, p.size, p.color?.light || PAL.excl);
                break;
        }
        ctx.restore();
    }

    // Thinking overlay above pet head
    if (performance.now() < _thinkingUntil) {
        const osc = Math.sin(performance.now() * 0.004);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        pxQuestion(ctx, Math.round(cx + 30), Math.round(cy - 60 + osc * 3), 18, PAL.question);
        ctx.restore();
    }

    // Flash overlay
    if (_flashAlpha > 0 && _flashColor) {
        ctx.save();
        ctx.globalAlpha = _flashAlpha;
        ctx.fillStyle = _flashColor;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
        _flashAlpha *= 0.88;
        if (_flashAlpha < 0.02) { _flashAlpha = 0; _flashColor = null; }
    }
}

function getShakeOffset() {
    if (_shakeMagnitude < 0.2) return { x: 0, y: 0 };
    return {
        x: (Math.random() - 0.5) * _shakeMagnitude,
        y: (Math.random() - 0.5) * _shakeMagnitude,
    };
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
function wireEvents() {
    Events.on('pet-poke', (pos) => {
        exclamation(pos?.x ?? 400, pos?.y ?? 240);
    });
    Events.on('pet-pet', (d) => {
        hearts(400, 260, 3 + Math.min(3, (d?.strokes || 3) / 2));
    });
    Events.on('evolution', () => {
        flash('#FFE899', 0.8);
        sparkles(400, 300, 16, PAL.gold);
    });
    Events.on('death', () => {
        flash('#303030', 0.7);
    });
    Events.on('activity-start', (ev) => {
        if (!ev) return;
        if (ev.type === 'SULKY')  tears(400, 280, 3);
        if (ev.type === 'AFRAID') { shake(10, 0.86); exclamation(400, 240); }
        if (ev.type === 'SICK')   sweatDrops(400, 260);
        if (ev.type === 'MEDITATING') sparkles(400, 260, 6, PAL.gold);
    });
    Events.on('activity-end', (ev) => {
        if (!ev) return;
        if (ev.from === 'SLEEPING' && !ev.grumpy) sparkles(400, 260, 4, PAL.gold);
        if (ev.from === 'SICK'  && ev.reason === 'auto') sparkles(400, 260, 5, '#80E0A0');
        if (ev.from === 'EATING' && ev.reason === 'auto') hearts(400, 260, 2, '#E09050', '#80401C');
    });
    Events.on('autonomy-desire-fulfilled', () => {
        hearts(400, 260, 5);
        sparkles(400, 260, 3);
    });
    Events.on('item-consumed', (ev) => {
        const vx = ev?.x ?? 400;
        const vy = ev?.y ?? 400;
        if (ev?.action === 'feed') hearts(vx, vy - 20, 3, '#E09050', '#80401C');
        else if (ev?.action === 'caress') hearts(vx, vy - 20, 4);
        else if (ev?.action === 'play') sparkles(vx, vy - 20, 4, PAL.gold);
        else if (ev?.action === 'talk') questionMark(vx, vy);
        else if (ev?.action === 'meditate') sparkles(vx, vy, 5, PAL.gold);
    });
    Events.on('gesture-shake', () => shake(6));
}

wireEvents();

export const EmotiveEffects = {
    draw,
    getShakeOffset,
    hearts, tears, musicNotes, sparkles, sweatDrops, questionMark, exclamation,
    shake, flash, setThinking,
    PAL,
};
