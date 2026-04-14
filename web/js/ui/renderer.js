/**
 * renderer.js -- Canvas 2D sprite renderer
 * Draws the pet creature procedurally based on DNA and stage.
 * Includes: cosmic background, needs visual manifestation,
 * cursor-tracking eyes, interaction particles.
 */
import { NeedType } from '../pet/needs.js';
import { Needs } from '../pet/needs.js';
import { Evolution } from '../pet/evolution.js';
import { Interactions } from './interactions.js';

let _canvas, _ctx;
let _scaleX = 1, _scaleY = 1;
let _tick = 0;
let _interactionsInit = false;

// Persistent stars (generated once)
let _stars = null;
let _nebulaGrad = null;

function initStars(w, h) {
    _stars = [];
    for (let i = 0; i < 120; i++) {
        _stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: 0.3 + Math.random() * 1.2,
            speed: 0.2 + Math.random() * 0.8,       // twinkle speed
            phase: Math.random() * Math.PI * 2,
            layer: Math.floor(Math.random() * 3),    // 0=far 1=mid 2=near
        });
    }
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function hslToRgba(h, s, l, a) {
    s /= 100; l /= 100;
    const c = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        return l - c * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return `rgba(${Math.round(f(0)*255)},${Math.round(f(8)*255)},${Math.round(f(4)*255)},${a})`;
}

function getPetColors(pet) {
    const hue = pet.dna.coreHue;
    const regression = Evolution.getVisualRegression(pet.needs);
    const sat = Math.round(70 - regression * 40);
    const light = Math.round(50 - regression * 15);

    return {
        core: hslToHex(hue, sat, light),
        glow: hslToHex(hue, sat + 15, light + 20),
        accent: hslToHex((hue + 120) % 360, sat - 10, light + 10),
        eye: '#E0E0E0',
        dark: hslToHex(hue, sat - 20, light - 20),
        hue, sat, light,
    };
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------
function drawBackground(ctx, w, h, tick, pet) {
    // Sky gradient: deep space to dark nebula
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#010508');
    grad.addColorStop(0.3, '#020A12');
    grad.addColorStop(0.6, '#051520');
    grad.addColorStop(0.85, '#0A1929');
    grad.addColorStop(1, '#0F2233');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Nebula clouds (2 soft color blobs)
    const nTime = tick * 0.0003;
    ctx.save();
    ctx.globalAlpha = 0.06;
    const n1x = w * 0.3 + Math.sin(nTime) * 50;
    const n1y = h * 0.25 + Math.cos(nTime * 0.7) * 30;
    const ng1 = ctx.createRadialGradient(n1x, n1y, 10, n1x, n1y, 200);
    ng1.addColorStop(0, '#4060C0');
    ng1.addColorStop(1, 'transparent');
    ctx.fillStyle = ng1;
    ctx.fillRect(0, 0, w, h);

    const n2x = w * 0.75 + Math.cos(nTime * 1.3) * 40;
    const n2y = h * 0.35 + Math.sin(nTime * 0.9) * 25;
    const ng2 = ctx.createRadialGradient(n2x, n2y, 10, n2x, n2y, 160);
    ng2.addColorStop(0, '#A060E0');
    ng2.addColorStop(1, 'transparent');
    ctx.fillStyle = ng2;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Stars
    if (!_stars) initStars(w, h);
    for (const s of _stars) {
        const twinkle = Math.sin(tick * 0.008 * s.speed + s.phase);
        const brightness = 0.3 + twinkle * 0.35;
        if (brightness < 0.05) continue;

        ctx.save();
        ctx.globalAlpha = brightness;

        if (s.r > 1.0) {
            // Brighter star with soft glow
            const sg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
            sg.addColorStop(0, '#ffffff');
            sg.addColorStop(0.4, 'rgba(200,220,255,0.4)');
            sg.addColorStop(1, 'transparent');
            ctx.fillStyle = sg;
            ctx.fillRect(s.x - s.r * 3, s.y - s.r * 3, s.r * 6, s.r * 6);
        } else {
            ctx.fillStyle = '#C8DCFF';
            ctx.fillRect(s.x, s.y, s.r, s.r);
        }
        ctx.restore();
    }

    // Horizon glow (ground)
    const groundY = h * 0.82;
    const horizonGrad = ctx.createLinearGradient(0, groundY - 30, 0, h);
    horizonGrad.addColorStop(0, 'transparent');
    horizonGrad.addColorStop(0.3, 'rgba(62,207,207,0.015)');
    horizonGrad.addColorStop(0.6, 'rgba(10,25,41,0.6)');
    horizonGrad.addColorStop(1, 'rgba(15,34,51,0.9)');
    ctx.fillStyle = horizonGrad;
    ctx.fillRect(0, groundY - 30, w, h - groundY + 30);

    // Ground surface line
    ctx.strokeStyle = 'rgba(62,207,207,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    // Slightly undulating ground
    for (let x = 0; x <= w; x += 20) {
        const undulate = Math.sin(x * 0.008 + tick * 0.002) * 2;
        ctx.lineTo(x, groundY + undulate);
    }
    ctx.stroke();

    // Ground grid lines (perspective)
    ctx.save();
    ctx.globalAlpha = 0.04;
    ctx.strokeStyle = '#3ECFCF';
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 6; i++) {
        const gy = groundY + i * i * 3;
        if (gy > h) break;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
    }
    ctx.restore();

    // Floating cosmic particles
    ctx.save();
    for (let i = 0; i < 15; i++) {
        const px = (i * 53.7 + tick * 0.05 * (0.3 + i * 0.1)) % w;
        const py = (i * 37.3 + Math.sin(tick * 0.003 + i) * 20) % (groundY - 10);
        const pa = 0.15 + Math.sin(tick * 0.006 + i * 1.7) * 0.1;
        ctx.globalAlpha = Math.max(0, pa);
        ctx.fillStyle = i % 3 === 0 ? '#3ECFCF' : i % 3 === 1 ? '#D4A534' : '#A060E0';
        ctx.beginPath();
        ctx.arc(px, py, 1 + (i % 2), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    return groundY;
}

// ---------------------------------------------------------------------------
// Needs visual manifestation
// ---------------------------------------------------------------------------
function drawNeedsIndicators(ctx, pet, cx, cy, bodyW, bodyH, tick) {
    const needs = pet.needs;

    // === HUNGER (kòra) < 40: floating food thought ===
    if (needs[NeedType.KORA] < 40) {
        const urgency = 1 - needs[NeedType.KORA] / 40;
        const bubbleX = cx + bodyW + 20;
        const bubbleY = cy - bodyH - 20 + Math.sin(tick * 0.03) * 5;
        ctx.save();
        ctx.globalAlpha = 0.4 + urgency * 0.5;
        // Thought bubble
        ctx.fillStyle = 'rgba(10,25,41,0.8)';
        ctx.strokeStyle = '#E07030';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(bubbleX, bubbleY, 16, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Small connecting circles
        ctx.beginPath();
        ctx.arc(bubbleX - 12, bubbleY + 10, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bubbleX - 16, bubbleY + 16, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Food icon (star crystal)
        ctx.fillStyle = '#E07030';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✦', bubbleX, bubbleY + 4);
        ctx.restore();
    }

    // === SLEEP (mokó) < 40: Zzz particles ===
    if (needs[NeedType.MOKO] < 40) {
        const urgency = 1 - needs[NeedType.MOKO] / 40;
        ctx.save();
        ctx.globalAlpha = 0.3 + urgency * 0.5;
        ctx.fillStyle = '#6A5AAA';
        ctx.font = 'bold 10px sans-serif';
        for (let i = 0; i < 3; i++) {
            const zx = cx + bodyW * 0.3 + i * 8;
            const zy = cy - bodyH - 10 - i * 12 - (tick * 0.3 + i * 30) % 50;
            const zScale = 1 + i * 0.3;
            ctx.font = `bold ${Math.round(8 * zScale)}px sans-serif`;
            ctx.globalAlpha = (0.3 + urgency * 0.4) * (1 - ((tick * 0.3 + i * 30) % 50) / 50);
            ctx.fillText('z', zx, zy);
        }
        ctx.restore();
    }

    // === HYGIENE (miska) < 40: dirt particles ===
    if (needs[NeedType.MISKA] < 40) {
        const urgency = 1 - needs[NeedType.MISKA] / 40;
        ctx.save();
        for (let i = 0; i < Math.floor(3 + urgency * 5); i++) {
            const angle = (tick * 0.008 + i * 1.3) % (Math.PI * 2);
            const dist = bodyW * 1.1 + Math.sin(tick * 0.01 + i * 2) * 8;
            const dx = cx + Math.cos(angle) * dist;
            const dy = cy + Math.sin(angle) * dist * 0.7;
            ctx.globalAlpha = 0.2 + urgency * 0.3;
            ctx.fillStyle = '#5A4A30';
            ctx.beginPath();
            ctx.arc(dx, dy, 2 + Math.random(), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // === HAPPINESS (nashì) < 40: rain-like tear drops ===
    if (needs[NeedType.NASHI] < 40) {
        const urgency = 1 - needs[NeedType.NASHI] / 40;
        ctx.save();
        ctx.globalAlpha = 0.15 + urgency * 0.25;
        ctx.fillStyle = '#6A7ABA';
        for (let i = 0; i < 5; i++) {
            const rx = cx - bodyW + Math.sin(i * 2.1) * bodyW * 2;
            const ry = (cy - bodyH * 2 + (tick * 0.8 + i * 40) % (bodyH * 4));
            ctx.beginPath();
            ctx.ellipse(rx, ry, 1, 3, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // === HEALTH < 30: red warning pulse ===
    if (needs[NeedType.HEALTH] < 30) {
        const urgency = 1 - needs[NeedType.HEALTH] / 30;
        const pulse = Math.sin(tick * 0.06) * 0.5 + 0.5;
        ctx.save();
        ctx.globalAlpha = urgency * pulse * 0.15;
        ctx.fillStyle = '#C04040';
        ctx.beginPath();
        ctx.ellipse(cx, cy, bodyW * 1.5, bodyH * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // === COGNITION < 40: floating ? marks ===
    if (needs[NeedType.COGNITION] < 40) {
        const urgency = 1 - needs[NeedType.COGNITION] / 40;
        ctx.save();
        ctx.fillStyle = '#40A0E0';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < 2; i++) {
            const qx = cx - bodyW * 0.6 - 10 + i * 12;
            const qy = cy - bodyH - 5 - Math.sin(tick * 0.025 + i * 3) * 10;
            ctx.globalAlpha = 0.2 + urgency * 0.4 * Math.abs(Math.sin(tick * 0.02 + i));
            ctx.fillText('?', qx, qy);
        }
        ctx.restore();
    }

    // === AFFECTION < 40: reaching appendages (subtle pulsing glow toward viewer) ===
    if (needs[NeedType.AFFECTION] < 40) {
        const urgency = 1 - needs[NeedType.AFFECTION] / 40;
        const pulse = Math.sin(tick * 0.025) * 0.5 + 0.5;
        ctx.save();
        ctx.globalAlpha = urgency * pulse * 0.2;
        const reachGrad = ctx.createRadialGradient(cx, cy + bodyH * 0.5, bodyW * 0.3, cx, cy + bodyH * 2, bodyW * 2);
        reachGrad.addColorStop(0, '#E060A0');
        reachGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = reachGrad;
        ctx.fillRect(cx - bodyW * 2, cy, bodyW * 4, bodyH * 3);
        ctx.restore();
    }

    // === CURIOSITY < 40: dimmed eye sparkle (handled in eyes) ===
    // (nothing extra here; the eyes become duller)

    // === COSMIC < 30: dimmed aura ===
    if (needs[NeedType.COSMIC] < 30) {
        // Aura dims — already handled by visual regression in getPetColors
        // Add small static-like noise around body
        const urgency = 1 - needs[NeedType.COSMIC] / 30;
        ctx.save();
        ctx.globalAlpha = urgency * 0.15;
        for (let i = 0; i < 8; i++) {
            const nx = cx + (Math.random() - 0.5) * bodyW * 3;
            const ny = cy + (Math.random() - 0.5) * bodyH * 3;
            ctx.fillStyle = '#A060E0';
            ctx.fillRect(nx, ny, 1, 1);
        }
        ctx.restore();
    }

    // === SECURITY < 30: body shake effect (returned as offset) ===
    // This is handled in the main draw by applying a shake transform
}

/** Returns {shakeX, shakeY} for security-based trembling */
function getSecurityShake(needs, tick) {
    if (needs[NeedType.SECURITY] < 30) {
        const urgency = 1 - needs[NeedType.SECURITY] / 30;
        return {
            x: Math.sin(tick * 0.3) * urgency * 3,
            y: Math.cos(tick * 0.4) * urgency * 2,
        };
    }
    return { x: 0, y: 0 };
}

// ---------------------------------------------------------------------------
// Egg
// ---------------------------------------------------------------------------
function drawEgg(ctx, cx, cy, tick) {
    const pulse = Math.sin(tick * 0.03) * 3;
    const glowAlpha = 0.3 + Math.sin(tick * 0.05) * 0.15;

    // Outer glow
    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 50 + pulse);
    grad.addColorStop(0, `rgba(62, 207, 207, ${glowAlpha})`);
    grad.addColorStop(1, 'rgba(62, 207, 207, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 55 + pulse, 55 + pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // Egg body
    ctx.fillStyle = '#1A3A4A';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30, 38 + pulse * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner veins
    ctx.strokeStyle = `rgba(62, 207, 207, ${0.3 + glowAlpha * 0.3})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const angle = (tick * 0.01 + i * 1.256);
        const r = 15 + Math.sin(tick * 0.04 + i) * 5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r * 0.3, cy + Math.sin(angle) * r * 0.3, r, angle, angle + 1);
        ctx.stroke();
    }

    // Core pulse
    ctx.fillStyle = `rgba(62, 207, 207, ${glowAlpha + 0.1})`;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, 8 + pulse * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Interaction area for egg
    Interactions.setPetPosition(cx, cy, 38);
}

// ---------------------------------------------------------------------------
// Creature
// ---------------------------------------------------------------------------
function drawCreature(ctx, pet, cx, cy, tick) {
    const colors = getPetColors(pet);
    const stage = pet.stage;
    const mood = pet.getMood();
    const breathe = Math.sin(tick * 0.025) * 2;

    // Security shake
    const shake = getSecurityShake(pet.needs, tick);
    cx += shake.x;
    cy += shake.y;

    // Size scales with stage
    const baseSize = 25 + stage * 8;
    const bodyW = baseSize + pet.dna.bodyCurvature * 3;
    const bodyH = baseSize * 1.2 + breathe;

    // Update interaction hit area
    Interactions.setPetPosition(cx, cy, bodyW);

    // Petting glow effect
    if (Interactions.isPetting()) {
        const petGlow = ctx.createRadialGradient(cx, cy, bodyW * 0.5, cx, cy, bodyW * 2.5);
        petGlow.addColorStop(0, 'rgba(224,96,160,0.15)');
        petGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = petGlow;
        ctx.beginPath();
        ctx.ellipse(cx, cy, bodyW * 2.5, bodyH * 2, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Shadow on ground
    const groundY = cy + bodyH + 15;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY, bodyW * 0.9, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body glow
    const glowR = bodyW + 15 + Math.sin(tick * 0.02) * 4;
    const gGrad = ctx.createRadialGradient(cx, cy, bodyW * 0.3, cx, cy, glowR);
    gGrad.addColorStop(0, colors.glow + '33');
    gGrad.addColorStop(1, colors.glow + '00');
    ctx.fillStyle = gGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, glowR, glowR, 0, 0, Math.PI * 2);
    ctx.fill();

    // Appendages (behind body)
    const appendCount = Math.min(pet.dna.appendageCount, stage >= 3 ? 6 : 3);
    const appendLen = 12 + pet.dna.appendageLength * 6 + stage * 2;
    for (let i = 0; i < appendCount; i++) {
        const angle = (Math.PI * 2 * i / appendCount) + tick * 0.005;
        const wave = Math.sin(tick * 0.03 + i * 2) * 8;
        const ax = cx + Math.cos(angle) * (bodyW + appendLen * 0.5 + wave);
        const ay = cy + Math.sin(angle) * (bodyH * 0.6 + appendLen * 0.3 + wave * 0.5);

        ctx.strokeStyle = colors.accent + 'AA';
        ctx.lineWidth = 2 + stage * 0.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * bodyW * 0.7, cy + Math.sin(angle) * bodyH * 0.5);
        ctx.quadraticCurveTo(
            cx + Math.cos(angle) * (bodyW + wave),
            cy + Math.sin(angle) * bodyH * 0.8 + wave,
            ax, ay
        );
        ctx.stroke();

        // Appendage tip glow
        ctx.fillStyle = colors.glow + '66';
        ctx.beginPath();
        ctx.arc(ax, ay, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Wings (stage 5+)
    if (stage >= 5 && pet.dna.appendageCount >= 2) {
        const wingSpan = 30 + stage * 5;
        const wingFlap = Math.sin(tick * 0.015) * 10;
        ctx.fillStyle = colors.core + '22';
        ctx.strokeStyle = colors.glow + '44';
        ctx.lineWidth = 1;

        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(cx, cy - bodyH * 0.2);
            ctx.quadraticCurveTo(
                cx + side * wingSpan, cy - bodyH * 0.5 - wingFlap,
                cx + side * wingSpan * 0.7, cy + bodyH * 0.1
            );
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }

    // Main body
    const bodyGrad = ctx.createRadialGradient(cx - bodyW * 0.2, cy - bodyH * 0.2, 0, cx, cy, bodyW);
    bodyGrad.addColorStop(0, colors.glow);
    bodyGrad.addColorStop(0.6, colors.core);
    bodyGrad.addColorStop(1, colors.dark);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyW, bodyH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Core pattern
    const patternR = bodyW * 0.5;
    ctx.strokeStyle = colors.glow + '44';
    ctx.lineWidth = 1;
    const pattern = pet.dna.corePattern;
    if (pattern < 3) {
        for (let r = 0; r < pattern + 1; r++) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, patternR - r * 6, patternR * 0.8 - r * 5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    } else if (pattern < 5) {
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 * i / 6) + tick * 0.003;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * patternR, cy + Math.sin(a) * patternR * 0.8);
            ctx.stroke();
        }
    } else {
        for (let i = 0; i < pattern; i++) {
            const a = Math.PI * 2 * i / pattern;
            const r = patternR * 0.5;
            ctx.fillStyle = colors.glow + '22';
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // ----- Eyes with cursor tracking -----
    const eyeSize = 4 + pet.dna.eyeSize * 2 + stage;
    const eyeSpacing = bodyW * 0.35;
    const eyeY = cy - bodyH * 0.2;
    const cursor = Interactions.getCursorPos();

    // Sleepy eyes when moko is low
    const sleepy = pet.needs[NeedType.MOKO] < 35;
    const sleepSquint = sleepy ? 0.5 + (pet.needs[NeedType.MOKO] / 35) * 0.5 : 1.0;

    for (const side of [-1, 1]) {
        const ex = cx + side * eyeSpacing;

        ctx.save();
        // Squint clip for sleepy eyes
        if (sleepSquint < 1) {
            ctx.beginPath();
            const squintH = eyeSize * 1.2 * sleepSquint;
            ctx.ellipse(ex, eyeY + eyeSize * 0.3 * (1 - sleepSquint), eyeSize * 1.1, squintH, 0, 0, Math.PI * 2);
            ctx.clip();
        }

        // Eye white
        ctx.fillStyle = colors.eye;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeSize, eyeSize * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Pupil with cursor tracking
        let pupilSize = eyeSize * 0.5;
        let pupilColor = '#1A1A2E';
        if (mood === 'happy') pupilSize = eyeSize * 0.4;
        else if (mood === 'scared') pupilSize = eyeSize * 0.7;
        else if (mood === 'sad') pupilSize = eyeSize * 0.35;

        // Calculate pupil offset toward cursor
        let pupilOffX = 0, pupilOffY = 0;
        if (cursor.active) {
            const dx = cursor.x - ex;
            const dy = cursor.y - eyeY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxOff = eyeSize * 0.3;
            if (dist > 1) {
                pupilOffX = (dx / dist) * Math.min(maxOff, dist * 0.02);
                pupilOffY = (dy / dist) * Math.min(maxOff, dist * 0.02);
            }
        }

        ctx.fillStyle = pupilColor;
        ctx.beginPath();
        ctx.arc(ex + pupilOffX, eyeY + pupilOffY, pupilSize, 0, Math.PI * 2);
        ctx.fill();

        // Eye highlight
        ctx.fillStyle = '#FFFFFF88';
        ctx.beginPath();
        ctx.arc(ex + pupilOffX - pupilSize * 0.3, eyeY + pupilOffY - pupilSize * 0.3, pupilSize * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Curiosity sparkle (bright when curiosity is high, dim when low)
        if (pet.needs[NeedType.CURIOSITY] > 50) {
            const sparkle = Math.sin(tick * 0.05 + side) * 0.5 + 0.5;
            ctx.globalAlpha = sparkle * 0.6;
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(ex + pupilOffX + pupilSize * 0.2, eyeY + pupilOffY - pupilSize * 0.5, 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.restore();

        // Eyelid line for sleepy
        if (sleepy) {
            ctx.strokeStyle = colors.dark;
            ctx.lineWidth = 1.5;
            const lidY = eyeY - eyeSize * sleepSquint;
            ctx.beginPath();
            ctx.arc(ex, eyeY, eyeSize, -Math.PI * 0.9, -Math.PI * 0.1);
            ctx.stroke();
        }
    }

    // Mouth/rithó
    const mouthY = cy + bodyH * 0.15;
    ctx.strokeStyle = colors.eye + '88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (mood === 'happy' || Interactions.isPetting()) {
        ctx.arc(cx, mouthY, 6, 0.2, Math.PI - 0.2);
    } else if (mood === 'sad') {
        ctx.arc(cx, mouthY + 6, 6, Math.PI + 0.2, -0.2);
    } else if (mood === 'scared') {
        ctx.ellipse(cx, mouthY + 2, 4, 5, 0, 0, Math.PI * 2);
    } else {
        ctx.moveTo(cx - 4, mouthY);
        ctx.lineTo(cx + 4, mouthY);
    }
    ctx.stroke();

    // Mood particles
    if (mood === 'happy') {
        for (let i = 0; i < 3; i++) {
            const px = cx + Math.sin(tick * 0.04 + i * 2) * bodyW * 0.8;
            const py = cy - bodyH - 10 - (tick * 0.3 + i * 15) % 40;
            ctx.fillStyle = colors.glow + '66';
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (mood === 'scared') {
        const shakeVis = Math.sin(tick * 0.2) * 2;
        ctx.fillStyle = '#C0404044';
        for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(cx + shakeVis + i * 10 - 5, cy - bodyH - 5, 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Antenna/nèlash (stage 2+)
    if (stage >= 2) {
        const antLen = 15 + stage * 3;
        const antWave = Math.sin(tick * 0.02) * 5;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - bodyH);
        ctx.quadraticCurveTo(cx + antWave, cy - bodyH - antLen * 0.6, cx + antWave * 2, cy - bodyH - antLen);
        ctx.stroke();
        ctx.fillStyle = colors.glow;
        ctx.beginPath();
        ctx.arc(cx + antWave * 2, cy - bodyH - antLen, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Transcendence glow (stage 7)
    if (stage >= 7) {
        const tAlpha = 0.1 + Math.sin(tick * 0.01) * 0.05;
        const tGrad = ctx.createRadialGradient(cx, cy, bodyW, cx, cy, bodyW * 3);
        tGrad.addColorStop(0, `rgba(212, 165, 52, ${tAlpha})`);
        tGrad.addColorStop(1, 'rgba(212, 165, 52, 0)');
        ctx.fillStyle = tGrad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, bodyW * 3, bodyW * 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw needs indicators
    drawNeedsIndicators(ctx, pet, cx, cy, bodyW, bodyH, tick);
}

// ---------------------------------------------------------------------------
// Death sequence
// ---------------------------------------------------------------------------
function drawDeathSequence(ctx, pet, cx, cy, tick) {
    const elapsed = Date.now() - (pet._deathSeqStart || Date.now());
    const progress = Math.min(1, elapsed / 15000);
    const alpha = 1 - progress;

    ctx.globalAlpha = alpha;
    drawCreature(ctx, pet, cx, cy, tick);
    ctx.globalAlpha = 1;

    for (let i = 0; i < 8; i++) {
        const px = cx + Math.sin(tick * 0.02 + i) * 40;
        const py = cy - progress * 100 - i * 15;
        const pAlpha = alpha * 0.5;
        ctx.fillStyle = pet.transcended
            ? `rgba(212, 165, 52, ${pAlpha})`
            : `rgba(100, 120, 180, ${pAlpha})`;
        ctx.beginPath();
        ctx.arc(px, py, 3 - progress * 2, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const Renderer = {
    setScale(sx, sy) { _scaleX = sx; _scaleY = sy; },

    render(pet, gameState) {
        if (!_canvas) {
            _canvas = document.getElementById('game-canvas');
            _ctx = _canvas.getContext('2d');
        }
        if (!_interactionsInit) {
            Interactions.init(_canvas);
            _interactionsInit = true;
        }
        _tick++;

        const w = _canvas.width;
        const h = _canvas.height;
        const cx = w / 2;

        // Clear
        _ctx.clearRect(0, 0, w, h);

        // Background with ground
        const groundY = drawBackground(_ctx, w, h, _tick, pet);

        // Pet vertical position: sit on the ground
        const cy = pet.isEgg() ? h * 0.4 : groundY - 30 - (pet.stage * 5);

        // Draw pet
        if (!pet.isAlive()) {
            drawDeathSequence(_ctx, pet, cx, cy, _tick);
        } else if (pet.isEgg()) {
            drawEgg(_ctx, cx, cy, _tick);
        } else {
            drawCreature(_ctx, pet, cx, cy, _tick);
        }

        // Interaction particles (hearts, ripples)
        Interactions.update(_ctx, _tick);

        // Evolution animation
        if (Evolution.isEvolving()) {
            const flash = Math.sin(_tick * 0.1) * 0.3 + 0.3;
            _ctx.fillStyle = `rgba(212, 165, 52, ${flash})`;
            _ctx.fillRect(0, 0, w, h);

            _ctx.fillStyle = '#D4A534';
            _ctx.font = 'bold 20px sans-serif';
            _ctx.textAlign = 'center';
            _ctx.fillText(
                `${pet.getStageNameFor(Evolution.getFromStage())} → ${pet.getStageNameFor(Evolution.getToStage())}`,
                cx, h - 40
            );

            if (_tick % 90 === 0) {
                Evolution.clearState();
            }
        }
    }
};
