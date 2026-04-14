/**
 * renderer.js -- Canvas 2D sprite renderer
 * Draws the pet creature procedurally based on DNA and stage
 */
import { NeedType } from '../pet/needs.js';
import { Needs } from '../pet/needs.js';
import { Evolution } from '../pet/evolution.js';

let _canvas, _ctx;
let _scaleX = 1, _scaleY = 1;
let _tick = 0;

// Color palette derived from DNA hue
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

function getPetColors(pet) {
    const hue = pet.dna.coreHue;
    const warmth = pet.dna.paletteWarmth;
    const regression = Evolution.getVisualRegression(pet.needs);

    // Desaturate based on regression
    const sat = Math.round(70 - regression * 40);
    const light = Math.round(50 - regression * 15);

    return {
        core: hslToHex(hue, sat, light),
        glow: hslToHex(hue, sat + 15, light + 20),
        accent: hslToHex((hue + 120) % 360, sat - 10, light + 10),
        eye: '#E0E0E0',
        dark: hslToHex(hue, sat - 20, light - 20),
    };
}

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
}

function drawCreature(ctx, pet, cx, cy, tick) {
    const colors = getPetColors(pet);
    const stage = pet.stage;
    const mood = pet.getMood();
    const breathe = Math.sin(tick * 0.025) * 2;

    // Size scales with stage
    const baseSize = 25 + stage * 8;
    const bodyW = baseSize + pet.dna.bodyCurvature * 3;
    const bodyH = baseSize * 1.2 + breathe;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + bodyH + 5, bodyW * 0.8, 6, 0, 0, Math.PI * 2);
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
        // Rings
        for (let r = 0; r < pattern + 1; r++) {
            ctx.beginPath();
            ctx.ellipse(cx, cy, patternR - r * 6, patternR * 0.8 - r * 5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    } else if (pattern < 5) {
        // Radial lines
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 * i / 6) + tick * 0.003;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * patternR, cy + Math.sin(a) * patternR * 0.8);
            ctx.stroke();
        }
    } else {
        // Spots
        for (let i = 0; i < pattern; i++) {
            const a = Math.PI * 2 * i / pattern;
            const r = patternR * 0.5;
            ctx.fillStyle = colors.glow + '22';
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Eyes
    const eyeSize = 4 + pet.dna.eyeSize * 2 + stage;
    const eyeSpacing = bodyW * 0.35;
    const eyeY = cy - bodyH * 0.2;

    for (const side of [-1, 1]) {
        const ex = cx + side * eyeSpacing;

        // Eye white
        ctx.fillStyle = colors.eye;
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, eyeSize, eyeSize * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();

        // Pupil (mood-based)
        let pupilSize = eyeSize * 0.5;
        let pupilColor = '#1A1A2E';
        if (mood === 'happy') pupilSize = eyeSize * 0.4;
        else if (mood === 'scared') pupilSize = eyeSize * 0.7;
        else if (mood === 'sad') pupilSize = eyeSize * 0.35;

        ctx.fillStyle = pupilColor;
        ctx.beginPath();
        ctx.arc(ex, eyeY, pupilSize, 0, Math.PI * 2);
        ctx.fill();

        // Eye highlight
        ctx.fillStyle = '#FFFFFF88';
        ctx.beginPath();
        ctx.arc(ex - pupilSize * 0.3, eyeY - pupilSize * 0.3, pupilSize * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    // Mouth/rithó
    const mouthY = cy + bodyH * 0.15;
    ctx.strokeStyle = colors.eye + '88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (mood === 'happy') {
        ctx.arc(cx, mouthY, 6, 0.2, Math.PI - 0.2);
    } else if (mood === 'sad') {
        ctx.arc(cx, mouthY + 6, 6, Math.PI + 0.2, -0.2);
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
        const shake = Math.sin(tick * 0.2) * 2;
        // Re-translate slightly (visual shake effect was already applied via mood)
        ctx.fillStyle = '#C0404044';
        for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.arc(cx + shake + i * 10 - 5, cy - bodyH - 5, 3, 0, Math.PI * 2);
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
}

function drawDeathSequence(ctx, pet, cx, cy, tick) {
    const elapsed = Date.now() - (pet._deathSeqStart || Date.now());
    const progress = Math.min(1, elapsed / 15000);
    const alpha = 1 - progress;

    ctx.globalAlpha = alpha;
    drawCreature(ctx, pet, cx, cy, tick);
    ctx.globalAlpha = 1;

    // Fading particles rising
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

export const Renderer = {
    setScale(sx, sy) { _scaleX = sx; _scaleY = sy; },

    render(pet, gameState) {
        if (!_canvas) {
            _canvas = document.getElementById('game-canvas');
            _ctx = _canvas.getContext('2d');
        }
        _tick++;

        const w = _canvas.width;
        const h = _canvas.height;
        const cx = w / 2;
        const cy = h / 2;

        // Clear
        _ctx.clearRect(0, 0, w, h);

        // Background: dark space with subtle stars
        _ctx.fillStyle = '#020A0A';
        _ctx.fillRect(0, 0, w, h);

        // Stars
        _ctx.fillStyle = '#ffffff08';
        for (let i = 0; i < 30; i++) {
            const sx = (i * 271.7 + _tick * 0.01) % w;
            const sy = (i * 173.3) % h;
            const brightness = Math.sin(_tick * 0.005 + i) * 0.5 + 0.5;
            _ctx.globalAlpha = brightness * 0.3;
            _ctx.fillRect(sx, sy, 1, 1);
        }
        _ctx.globalAlpha = 1;

        // Draw pet
        if (!pet.isAlive()) {
            drawDeathSequence(_ctx, pet, cx, cy, _tick);
        } else if (pet.isEgg()) {
            drawEgg(_ctx, cx, cy, _tick);
        } else {
            drawCreature(_ctx, pet, cx, cy, _tick);
        }

        // Evolution animation
        if (Evolution.isEvolving()) {
            const flash = Math.sin(_tick * 0.1) * 0.3 + 0.3;
            _ctx.fillStyle = `rgba(212, 165, 52, ${flash})`;
            _ctx.fillRect(0, 0, w, h);

            _ctx.fillStyle = '#D4A534';
            _ctx.font = 'bold 20px sans-serif';
            _ctx.textAlign = 'center';
            _ctx.fillText(
                `${pet.getStageNameFor(Evolution.getFromStage())} -> ${pet.getStageNameFor(Evolution.getToStage())}`,
                cx, h - 40
            );

            // Auto-clear after 3 seconds
            if (_tick % 90 === 0) {
                Evolution.clearState();
            }
        }
    }
};
