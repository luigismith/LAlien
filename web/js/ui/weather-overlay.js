/**
 * weather-overlay.js -- Canvas overlays for real-world weather.
 *
 * Keeps particle state out of the renderer. Three layers:
 *   1. Cloud cover (below stars, tints the sky)
 *   2. Rain / snow particles (on top of scene, under UI)
 *   3. Lightning flashes (thunder condition)
 *
 * The `shelterRect` arg, if provided, masks particles falling inside the cave
 * footprint — so the sheltered pet visually stays dry.
 */
import { Weather } from '../engine/weather.js';

const RAIN = [];
const SNOW = [];
let _flashUntil = 0;
let _nextFlashAt = 0;

function seed(arr, n, w, h, kind) {
    while (arr.length < n) {
        if (kind === 'rain') {
            arr.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: -0.6,
                vy: 8 + Math.random() * 6,
                len: 8 + Math.random() * 6,
                alpha: 0.35 + Math.random() * 0.4,
            });
        } else {
            arr.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: (Math.random() - 0.5) * 0.6,
                vy: 0.8 + Math.random() * 1.1,
                r: 1 + Math.random() * 1.8,
                wobblePhase: Math.random() * Math.PI * 2,
                alpha: 0.55 + Math.random() * 0.45,
            });
        }
    }
    while (arr.length > n) arr.pop();
}

function maskedByShelter(x, y, rect) {
    if (!rect) return false;
    return x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h;
}

export const WeatherOverlay = {
    /** Call after the pet, before UI — draws rain/snow over the scene. */
    draw(ctx, w, h, tick, shelterRect = null) {
        const ws = Weather.get();
        const cond = ws.condition;
        const intensity = ws.intensity || 0;

        // --- Cloud veil (darkens sky) ---
        if (cond === 'clouds' || cond === 'rain' || cond === 'snow' || cond === 'thunder' || cond === 'mist') {
            const cover = Math.min(1, (ws.clouds || 50) / 100 + (cond === 'mist' ? 0.3 : 0));
            ctx.save();
            ctx.globalAlpha = 0.18 + cover * 0.25;
            const cg = ctx.createLinearGradient(0, 0, 0, h * 0.6);
            cg.addColorStop(0, cond === 'thunder' ? '#1A1A25' : '#202838');
            cg.addColorStop(1, 'rgba(10,15,25,0)');
            ctx.fillStyle = cg;
            ctx.fillRect(0, 0, w, h);

            // Drifting cloud puffs
            for (let i = 0; i < 5; i++) {
                const cx = ((tick * 0.3 + i * w / 4) % (w + 200)) - 100;
                const cy = 30 + i * 22;
                const cr = 40 + i * 10;
                ctx.globalAlpha = 0.08 + cover * 0.18;
                const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, cr);
                grad.addColorStop(0, 'rgba(180,190,205,0.55)');
                grad.addColorStop(1, 'rgba(10,15,25,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
            }
            ctx.restore();
        }

        // --- Rain ---
        if (cond === 'rain' || cond === 'thunder') {
            const count = Math.round(60 + intensity * 160);
            seed(RAIN, count, w, h, 'rain');
            ctx.save();
            ctx.strokeStyle = '#9EC8F0';
            ctx.lineWidth = 1.1;
            for (const d of RAIN) {
                d.x += d.vx; d.y += d.vy;
                if (d.y > h)      { d.y = -10; d.x = Math.random() * w; }
                if (d.x < -20)    { d.x = w; }
                if (maskedByShelter(d.x, d.y, shelterRect)) continue;
                ctx.globalAlpha = d.alpha;
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(d.x + d.vx * 2, d.y + d.len);
                ctx.stroke();
            }
            ctx.restore();
        } else if (RAIN.length) { RAIN.length = 0; }

        // --- Snow ---
        if (cond === 'snow') {
            const count = Math.round(45 + intensity * 90);
            seed(SNOW, count, w, h, 'snow');
            ctx.save();
            for (const s of SNOW) {
                s.wobblePhase += 0.03;
                s.x += s.vx + Math.sin(s.wobblePhase) * 0.5;
                s.y += s.vy;
                if (s.y > h)     { s.y = -5; s.x = Math.random() * w; }
                if (s.x < -10)   { s.x = w + 5; }
                if (s.x > w + 10){ s.x = -5;   }
                if (maskedByShelter(s.x, s.y, shelterRect)) continue;
                ctx.globalAlpha = s.alpha;
                ctx.fillStyle = '#F0F6FF';
                ctx.beginPath();
                ctx.arc(Math.floor(s.x), Math.floor(s.y), s.r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        } else if (SNOW.length) { SNOW.length = 0; }

        // --- Thunder flashes (very occasional) ---
        if (cond === 'thunder') {
            const now = performance.now();
            if (now > _nextFlashAt) {
                _nextFlashAt = now + 4000 + Math.random() * 9000;
                _flashUntil = now + 140;
            }
            if (now < _flashUntil) {
                const k = (_flashUntil - now) / 140;
                ctx.save();
                ctx.globalAlpha = 0.55 * k;
                ctx.fillStyle = '#F0F6FF';
                ctx.fillRect(0, 0, w, h);
                ctx.restore();
            }
        }

        // --- Mist overlay ---
        if (cond === 'mist') {
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = '#C8D8E8';
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }
    },
};
