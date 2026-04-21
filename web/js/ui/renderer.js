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
import { Activity } from '../pet/activity.js';
import { Autonomy } from '../pet/autonomy.js';
import { SpriteLoader } from './sprite-loader.js';
import { Items } from '../engine/items.js';
import { EmotiveEffects } from './emotive-effects.js';
import { Environment } from '../engine/environment.js';
import { Weather } from '../engine/weather.js';
import { Shelter } from './shelter.js';
import { WeatherOverlay } from './weather-overlay.js';

let _canvas, _ctx;
let _scaleX = 1, _scaleY = 1;
let _tick = 0;
let _interactionsInit = false;

// Persistent stars (regenerated only on background-size change)
let _stars = null;
let _starsForW = 0, _starsForH = 0;

// Persistent crystals — positions captured per render pass for hit-testing.
// Stored in bg-res coords; converted to full-res at hit-test time.
let _crystals = [];
// Persistent fireflies — stateful so we can hit-test them against taps.
// Positions are in FULL-res canvas coords (not the bg low-res).
let _fireflies = [];
// Echo-moths — a small flock that drifts across the daytime scene every few
// minutes. Both the keeper and the pet can interact with them (keeper taps
// scatter, pet passively notices and gains CURIOSITY). Positions in bg-res.
let _moths = null;       // { flockX, flockY, vx, vy, members[], life, id }
let _mothsNextAt = 0;
let _fireflyNextRespawnAt = 0;
// Tap sparkle overlays drawn on full-res canvas.
let _envSparkles = [];
// Live celestial bodies for hit-testing (sun by day, moon at night).
let _celestial = null;  // { kind: 'sun'|'moon', x, y, r } in full-res coords
let _nebulaGrad = null;

// Pixel-art downscale factor — the entire background is rendered into an
// offscreen canvas at 1/PIXEL_SCALE resolution and upscaled with nearest-
// neighbour sampling so the sky, ground, crystals and weather all share the
// same chunky pixel-art look as the pet sprites.
const PIXEL_SCALE = 3;
let _bgCanvas = null;
let _bgCtx = null;

function initStars(w, h) {
    _stars = [];
    _starsForW = w; _starsForH = h;
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
let _shootingStars = [];
let _lastShootingStarTick = 0;

function drawBackground(ctx, w, h, tick, pet) {
    const petHue = (pet && pet.dna) ? pet.dna.coreHue : 200;
    const stage = pet ? pet.stage : 0;

    // Real day/night based on keeper's location (falls back to simple curve)
    const now = new Date();
    const dayLight = Environment.getDayLight(now);
    const phase    = Environment.getPhase(now);
    const starVis  = Environment.getStarVisibility(now);
    const nightDim = 1 - dayLight * 0.5;

    // Stage-specific sky palette (each stage has a unique cosmic atmosphere)
    const SKY_PALETTES = [
        // 0 Syrma: deep womb-violet nebula
        ['#0A0418','#120820','#1A0C30','#0D0620','#080410'],
        // 1 Lali-na: soft lavender-pink dawn
        ['#0C0818','#180C28','#201438','#180E30','#100820'],
        // 2 Lali-shi: teal-blue curiosity sky
        ['#020A10','#041018','#061822','#082028','#0A2830'],
        // 3 Lali-ko: warm orange-purple adventure
        ['#080408','#141018','#1A1025','#201830','#281E38'],
        // 4 Lali-ren: deep blue teenage contemplation
        ['#010510','#040C1A','#081428','#0C1C34','#102440'],
        // 5 Lali-vox: balanced cosmic teal-gold
        ['#020808','#041210','#061A18','#082420','#0A2E28'],
        // 6 Lali-mere: dark indigo-grey wisdom
        ['#060608','#0C0C10','#121218','#181820','#202028'],
        // 7 Lali-thishi: ethereal white-silver transcendence
        ['#080A10','#101418','#182024','#202830','#283038'],
    ];
    const pal = SKY_PALETTES[stage] || SKY_PALETTES[0];

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0,    pal[0]);
    grad.addColorStop(0.25, pal[1]);
    grad.addColorStop(0.50, pal[2]);
    grad.addColorStop(0.75, pal[3]);
    grad.addColorStop(1,    pal[4]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Daytime sky — full-alpha coverage past mid-morning so sunny days
    // actually LOOK sunny instead of bleeding dark cosmic colours through.
    if (dayLight > 0.12) {
        ctx.save();
        // Ramp to full opacity quickly: 50% of dayLight → 100% alpha
        ctx.globalAlpha = Math.min(1, dayLight * 2.0);
        const wCond = (typeof Weather !== 'undefined') ? Weather.get() : { condition: 'clear' };
        const cloudy = wCond.clouds > 65;
        let top, mid, bottom;
        if (wCond.condition === 'clouds' || cloudy) {
            top = '#7C8A9E'; mid = '#A0ADBF'; bottom = '#C8D0DC';
        } else if (wCond.condition === 'rain' || wCond.condition === 'thunder') {
            top = '#3C4656'; mid = '#5A6678'; bottom = '#7A8494';
        } else if (wCond.condition === 'snow') {
            top = '#A0B0C0'; mid = '#C8D4E0'; bottom = '#E8EEF4';
        } else if (wCond.condition === 'mist') {
            top = '#B0BBC6'; mid = '#CDD5DD'; bottom = '#E4E9ED';
        } else {
            // Clear — vivid sunny blue with a bright bottom
            top = '#2E7BC8'; mid = '#5FB0E4'; bottom = '#BEE8F8';
        }
        const skyG = ctx.createLinearGradient(0, 0, 0, h);
        skyG.addColorStop(0,    top);
        skyG.addColorStop(0.55, mid);
        skyG.addColorStop(1,    bottom);
        ctx.fillStyle = skyG;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // Sun position: true arc from horizon (sunrise) to zenith (noon) and
        // back down to horizon (sunset). Visible also at dawn/dusk so the
        // keeper sees it low on the horizon in late afternoon / early evening.
        if (phase !== 'night' && wCond.condition !== 'thunder') {
            const sun = Environment.getSunTimes(now);
            let arc = 0.5;
            if (sun.sunrise && sun.sunset) {
                const span = sun.sunset.getTime() - sun.sunrise.getTime();
                const t = (now.getTime() - sun.sunrise.getTime()) / span;
                arc = Math.max(-0.08, Math.min(1.08, t));
            }
            const horizonY = Math.floor(h * 0.80);
            const apexY    = Math.floor(h * 0.10);
            // True parabolic arc: sin(arc*π) is 0 at sunrise/sunset, 1 at noon
            const rise = Math.max(0, Math.sin(arc * Math.PI));
            const sunX = Math.floor(arc * w);
            const sunY = Math.floor(horizonY - rise * (horizonY - apexY));
            ctx.save();
            ctx.globalAlpha = Math.min(1, 1.1 * dayLight) * (wCond.condition === 'clouds' ? 0.55 : 1);
            // Big pixel-art sun — crisp concentric rings, no gaussian glow.
            const r = Math.max(6, Math.round(h * 0.028));
            // Soft outer corona (one ring of dim pixels — not a gradient)
            ctx.globalAlpha *= 1;
            ctx.fillStyle = 'rgba(255,216,106,0.35)';
            ctx.beginPath(); ctx.arc(sunX, sunY, r + 4, 0, Math.PI * 2); ctx.fill();
            // Outer rim (warm orange)
            ctx.fillStyle = '#F5A642';
            ctx.beginPath(); ctx.arc(sunX, sunY, r + 2, 0, Math.PI * 2); ctx.fill();
            // Mid (golden)
            ctx.fillStyle = '#FFD86A';
            ctx.beginPath(); ctx.arc(sunX, sunY, r + 1, 0, Math.PI * 2); ctx.fill();
            // Inner disc (bright)
            ctx.fillStyle = '#FFF4B4';
            ctx.beginPath(); ctx.arc(sunX, sunY, r - 1, 0, Math.PI * 2); ctx.fill();
            // Core highlight
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath(); ctx.arc(sunX - r * 0.3, sunY - r * 0.3, Math.max(1, r * 0.25), 0, Math.PI * 2); ctx.fill();
            // Eight short rays (1-2 px blocks, pixel-art spokes)
            ctx.fillStyle = '#FFD86A';
            for (let a = 0; a < 8; a++) {
                const ang = a * Math.PI / 4;
                const rx = Math.round(sunX + Math.cos(ang) * (r + 5));
                const ry = Math.round(sunY + Math.sin(ang) * (r + 5));
                ctx.fillRect(rx - 1, ry - 1, 2, 2);
            }
            // When low (late afternoon / evening) the sun takes a warmer hue
            if (rise < 0.35) {
                ctx.globalCompositeOperation = 'source-atop';
                ctx.fillStyle = 'rgba(255,120,60,0.28)';
                ctx.beginPath(); ctx.arc(sunX, sunY, r + 2, 0, Math.PI * 2); ctx.fill();
            }
            ctx.restore();
            // Store the sun position (bg-coords) for hit-testing
            _celestial = { kind: 'sun', x: sunX, y: sunY, r: r + 5 };
        } else {
            _celestial = null;
        }

        // --- Moon at night (new) ---
        if (phase === 'night' && wCond.condition !== 'thunder') {
            const nowMs = now.getTime();
            // Monthly phase (synodic month ≈ 29.53 days)
            const synodic = 29.53 * 86400 * 1000;
            const refNew = Date.UTC(2000, 0, 6);    // known new moon
            const mp = ((nowMs - refNew) % synodic) / synodic;  // 0..1
            // Arc across the night sky from east to west (very simplified)
            // Night fraction elapsed
            const sun = Environment.getSunTimes(now);
            let arc = 0.5;
            if (sun && sun.sunset && sun.sunrise) {
                const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
                const sr = sun.sunset.getTime();                 // tonight's sunset
                const tomorrowSr = Environment.getSunTimes(new Date(now.getTime() + 24 * 3600 * 1000)).sunrise;
                const srNext = tomorrowSr ? tomorrowSr.getTime() : sr + 10 * 3600 * 1000;
                const span = srNext - sr;
                const t = (nowMs - sr) / span;
                if (t >= 0 && t <= 1) arc = t;
            }
            const horizonY = Math.floor(h * 0.82);
            const apexY    = Math.floor(h * 0.14);
            const rise = Math.max(0.08, Math.sin(arc * Math.PI));
            const moonX = Math.floor(arc * w);
            const moonY = Math.floor(horizonY - rise * (horizonY - apexY));
            const mr = Math.max(5, Math.round(h * 0.022));
            ctx.save();
            // Soft halo
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = 'rgba(220,230,255,0.5)';
            ctx.beginPath(); ctx.arc(moonX, moonY, mr + 3, 0, Math.PI * 2); ctx.fill();
            // Full moon base
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#E8ECF6';
            ctx.beginPath(); ctx.arc(moonX, moonY, mr, 0, Math.PI * 2); ctx.fill();
            // Phase shadow: subtract a circle offset based on mp
            // mp=0 new, mp=0.5 full, mp=0.25 first quarter, 0.75 third
            const shadowOffset = Math.cos(mp * Math.PI * 2) * mr * 1.2;
            if (Math.abs(shadowOffset) > 0.5) {
                ctx.fillStyle = '#0A0F20';
                ctx.beginPath(); ctx.arc(moonX + shadowOffset, moonY, mr + 1, 0, Math.PI * 2); ctx.fill();
            }
            // Craters
            ctx.fillStyle = '#B8BDCF';
            ctx.beginPath(); ctx.arc(moonX - mr * 0.3, moonY - mr * 0.2, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(moonX + mr * 0.2, moonY + mr * 0.3, 1.2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            _celestial = { kind: 'moon', x: moonX, y: moonY, r: mr + 4 };
        } else if (phase === 'night') {
            _celestial = null;
        }
    }

    // Dawn / dusk horizon blaze — vivid orange-pink strip where the sun is
    if (phase === 'dawn' || phase === 'dusk') {
        ctx.save();
        const sunX = phase === 'dawn' ? w * 0.15 : w * 0.85;
        const blaze = ctx.createRadialGradient(sunX, h * 0.72, 8, sunX, h * 0.72, w * 0.55);
        blaze.addColorStop(0,   'rgba(255,200,120,0.75)');
        blaze.addColorStop(0.3, 'rgba(230,120,90,0.45)');
        blaze.addColorStop(0.7, 'rgba(120,60,120,0.22)');
        blaze.addColorStop(1,   'transparent');
        ctx.fillStyle = blaze;
        ctx.fillRect(0, 0, w, h);
        // A faint sun disc
        ctx.globalAlpha = 0.65;
        const sunG = ctx.createRadialGradient(sunX, h * 0.72, 2, sunX, h * 0.72, 28);
        sunG.addColorStop(0, '#FFE8A8');
        sunG.addColorStop(1, 'transparent');
        ctx.fillStyle = sunG;
        ctx.fillRect(sunX - 32, h * 0.72 - 32, 64, 64);
        ctx.restore();
    }

    // Subtle hue tint overlay from pet's DNA color
    ctx.save();
    ctx.globalAlpha = 0.04;
    const tintG = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.4, w * 0.7);
    tintG.addColorStop(0, `hsl(${petHue},60%,40%)`);
    tintG.addColorStop(1, 'transparent');
    ctx.fillStyle = tintG;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Nebula clouds (3 soft color blobs, more vivid)
    const nTime = tick * 0.0003;
    ctx.save();

    // Nebula 1 — blue/indigo
    ctx.globalAlpha = 0.13;
    const n1x = w * 0.25 + Math.sin(nTime) * 60;
    const n1y = h * 0.22 + Math.cos(nTime * 0.7) * 35;
    const ng1 = ctx.createRadialGradient(n1x, n1y, 5, n1x, n1y, Math.min(w, h) * 0.45);
    ng1.addColorStop(0,   `hsl(${(petHue + 20) % 360},80%,55%)`);
    ng1.addColorStop(0.4, `hsl(${(petHue + 20) % 360},60%,35%)`);
    ng1.addColorStop(1,   'transparent');
    ctx.fillStyle = ng1;
    ctx.fillRect(0, 0, w, h);

    // Nebula 2 — violet/purple
    ctx.globalAlpha = 0.10;
    const n2x = w * 0.78 + Math.cos(nTime * 1.3) * 45;
    const n2y = h * 0.30 + Math.sin(nTime * 0.9) * 28;
    const ng2 = ctx.createRadialGradient(n2x, n2y, 5, n2x, n2y, Math.min(w, h) * 0.38);
    ng2.addColorStop(0,   `hsl(${(petHue + 160) % 360},75%,50%)`);
    ng2.addColorStop(0.5, `hsl(${(petHue + 140) % 360},55%,32%)`);
    ng2.addColorStop(1,   'transparent');
    ctx.fillStyle = ng2;
    ctx.fillRect(0, 0, w, h);

    // Nebula 3 — warm accent, top center
    ctx.globalAlpha = 0.07;
    const n3x = w * 0.52 + Math.sin(nTime * 0.6 + 1) * 35;
    const n3y = h * 0.10 + Math.cos(nTime * 0.5) * 20;
    const ng3 = ctx.createRadialGradient(n3x, n3y, 5, n3x, n3y, Math.min(w, h) * 0.28);
    ng3.addColorStop(0,   `hsl(${(petHue + 300) % 360},70%,60%)`);
    ng3.addColorStop(1,   'transparent');
    ctx.fillStyle = ng3;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Stars (hidden during day, faded at dawn/dusk)
    if (!_stars || _starsForW !== w || _starsForH !== h) initStars(w, h);
    if (starVis > 0.03) for (const s of _stars) {
        const twinkle = Math.sin(tick * 0.008 * s.speed + s.phase);
        const brightness = (0.35 + twinkle * 0.4) * starVis;
        if (brightness < 0.05) continue;

        ctx.save();
        ctx.globalAlpha = brightness;

        if (s.r > 1.0) {
            // Brighter star with cross glow
            const sg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3.5);
            sg.addColorStop(0,   '#ffffff');
            sg.addColorStop(0.3, 'rgba(200,225,255,0.5)');
            sg.addColorStop(1,   'transparent');
            ctx.fillStyle = sg;
            ctx.fillRect(s.x - s.r * 4, s.y - s.r * 4, s.r * 8, s.r * 8);
            // Cross spike
            ctx.globalAlpha = brightness * 0.4;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(s.x - s.r * 5, s.y); ctx.lineTo(s.x + s.r * 5, s.y);
            ctx.moveTo(s.x, s.y - s.r * 5); ctx.lineTo(s.x, s.y + s.r * 5);
            ctx.stroke();
        } else {
            ctx.fillStyle = s.layer === 2 ? '#D8ECFF' : '#C8DCFF';
            ctx.fillRect(s.x, s.y, s.r, s.r);
        }
        ctx.restore();
    }

    // Shooting stars (occasional, ~every 8-12 seconds)
    if (tick - _lastShootingStarTick > 300 + Math.floor(Math.random() * 200)) {
        _lastShootingStarTick = tick;
        if (Math.random() < 0.65) {
            _shootingStars.push({
                x: Math.random() * w * 0.7,
                y: Math.random() * h * 0.4,
                vx: 3 + Math.random() * 4,
                vy: 1.5 + Math.random() * 2,
                len: 60 + Math.random() * 80,
                life: 1.0,
            });
        }
    }
    ctx.save();
    _shootingStars = _shootingStars.filter(ss => ss.life > 0);
    for (const ss of _shootingStars) {
        ctx.globalAlpha = ss.life * 0.85;
        const grad2 = ctx.createLinearGradient(ss.x, ss.y, ss.x - ss.len, ss.y - ss.len * 0.5);
        grad2.addColorStop(0, '#FFFFFF');
        grad2.addColorStop(1, 'transparent');
        ctx.strokeStyle = grad2;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ss.x, ss.y);
        ctx.lineTo(ss.x - ss.len, ss.y - ss.len * 0.5);
        ctx.stroke();
        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.life -= 0.035;
    }
    ctx.restore();

    // Horizon glow (ground)
    const groundY = h * 0.82;
    const petHexHorizon = `hsl(${petHue},50%,35%)`;
    const horizonGrad = ctx.createLinearGradient(0, groundY - 50, 0, h);
    horizonGrad.addColorStop(0,   'transparent');
    horizonGrad.addColorStop(0.25, `hsla(${petHue},50%,35%,0.06)`);
    horizonGrad.addColorStop(0.55, 'rgba(10,25,41,0.65)');
    horizonGrad.addColorStop(1,   'rgba(15,34,51,0.92)');
    ctx.fillStyle = horizonGrad;
    ctx.fillRect(0, groundY - 50, w, h - groundY + 50);

    // Horizon glow line
    ctx.save();
    const glowIntensity = 0.18 + Math.sin(tick * 0.004) * 0.04;
    ctx.globalAlpha = glowIntensity;
    const hg = ctx.createLinearGradient(0, groundY - 4, 0, groundY + 8);
    hg.addColorStop(0, `hsl(${petHue},70%,60%)`);
    hg.addColorStop(1, 'transparent');
    ctx.fillStyle = hg;
    ctx.fillRect(0, groundY - 4, w, 12);
    ctx.restore();

    // Ground surface line
    ctx.strokeStyle = `hsla(${petHue},60%,65%,0.25)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    for (let x = 0; x <= w; x += 20) {
        const undulate = Math.sin(x * 0.008 + tick * 0.002) * 2;
        ctx.lineTo(x, groundY + undulate);
    }
    ctx.stroke();

    // Ground grid lines (perspective)
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = `hsl(${petHue},60%,65%)`;
    ctx.lineWidth = 0.5;
    for (let i = 1; i <= 7; i++) {
        const gy = groundY + i * i * 3;
        if (gy > h) break;
        ctx.beginPath();
        ctx.moveTo(0, gy); ctx.lineTo(w, gy);
        ctx.stroke();
    }
    // Vertical vanishing lines
    ctx.globalAlpha = 0.03;
    const vp = w * 0.5;
    for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(vp + i * w * 0.15, groundY);
        ctx.lineTo(vp + i * w * 0.6, h);
        ctx.stroke();
    }
    ctx.restore();

    // Floating cosmic particles (sky)
    ctx.save();
    for (let i = 0; i < 18; i++) {
        const px = (i * 53.7 + tick * 0.05 * (0.3 + i * 0.1)) % w;
        const py = (i * 37.3 + Math.sin(tick * 0.003 + i) * 20) % (groundY - 10);
        const pa = 0.18 + Math.sin(tick * 0.006 + i * 1.7) * 0.12;
        ctx.globalAlpha = Math.max(0, pa);
        const particleHue = (petHue + [0, 120, 240, 60, 180][i % 5]) % 360;
        ctx.fillStyle = `hsl(${particleHue},80%,65%)`;
        ctx.beginPath();
        ctx.arc(px, py, 1 + (i % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Mood-reactive sky tint: happiness warms, sadness darkens, fear adds purple
    if (pet && pet.needs && pet.getMood) {
        const mood = pet.getMood();
        ctx.save();
        if (mood === 'happy') {
            ctx.globalAlpha = 0.06;
            ctx.fillStyle = '#FFE89940';
            ctx.fillRect(0, 0, w, h);
        } else if (mood === 'sad') {
            ctx.globalAlpha = 0.08;
            ctx.fillStyle = '#10182040';
            ctx.fillRect(0, 0, w, h);
        } else if (mood === 'scared') {
            ctx.globalAlpha = 0.06;
            ctx.fillStyle = '#40205040';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
    }

    // Crystal growths on the ground (pixel-art alien vegetation that pulses)
    ctx.save();
    const crystalSeed = petHue * 7 + 42;
    _crystals = [];
    for (let i = 0; i < 12; i++) {
        const cx = ((crystalSeed + i * 73) % w);
        const baseY = groundY + 2;
        const h1 = 8 + (i * 13 % 18);
        const pulse = Math.sin(tick * 0.015 + i * 0.9) * 2;
        const crystalH = h1 + pulse;
        const hue = (petHue + i * 30) % 360;
        // Record for hit-test: centre on the crystal's mid-height, radius
        // covers the whole spike.
        _crystals.push({ id: i, x: cx, y: baseY - crystalH / 2, r: Math.max(crystalH / 2 + 6, 12), hue });

        ctx.globalAlpha = 0.35 + Math.sin(tick * 0.02 + i) * 0.15;
        ctx.fillStyle = `hsl(${hue},70%,50%)`;
        // Main spike
        ctx.beginPath();
        ctx.moveTo(cx - 2, baseY);
        ctx.lineTo(cx, baseY - crystalH);
        ctx.lineTo(cx + 2, baseY);
        ctx.fill();
        // Side spike
        if (i % 3 === 0) {
            ctx.fillStyle = `hsl(${hue},60%,40%)`;
            ctx.beginPath();
            ctx.moveTo(cx + 1, baseY);
            ctx.lineTo(cx + 4, baseY - crystalH * 0.6);
            ctx.lineTo(cx + 5, baseY);
            ctx.fill();
        }
        // Glow tip
        ctx.globalAlpha = 0.4 + Math.sin(tick * 0.03 + i * 1.3) * 0.3;
        ctx.fillStyle = `hsl(${hue},90%,75%)`;
        ctx.beginPath();
        ctx.arc(cx, baseY - crystalH, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Fireflies — stateful (so they can be tapped). Positions stored at the
    // RATIO space (0..1) and mapped per-frame to the current background size,
    // so hit-testing in full-res (done later) can reuse them by simple scale.
    if (_fireflies.length === 0 && _fireflyNextRespawnAt <= tick) {
        for (let i = 0; i < 10; i++) {
            _fireflies.push({
                id: tick + i,
                rx: (i * 0.067 + 0.05) % 1,           // 0..1 canvas-width
                ry: 0.78 - (i * 11 % 40) / h,         // near ground
                phase: Math.random() * Math.PI * 2,
                hue: (petHue + 60 + i * 40) % 360,
                caught: 0,                            // 0..1 flare animation when tapped
                alive: true,
            });
        }
    }
    ctx.save();
    for (const f of _fireflies) {
        if (!f.alive) continue;
        f.phase += 0.008;
        // Live full-canvas coords (for rendering & hit-testing)
        const fx = (f.rx * w + Math.sin(f.phase) * 60 + tick * 0.02) % w;
        const fy = groundY - 15 - f.ry * 40 + Math.sin(f.phase * 1.4) * 10;
        f.x = fx; f.y = fy;
        const blink = Math.sin(f.phase * 3 + f.hue);
        if (blink < -0.2 && !f.caught) continue;

        const alpha = f.caught > 0 ? f.caught : Math.max(0, blink * 0.6);
        ctx.globalAlpha = alpha * 0.4;
        const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 8 + f.caught * 14);
        fg.addColorStop(0, `hsl(${f.hue},80%,70%)`);
        fg.addColorStop(1, 'transparent');
        ctx.fillStyle = fg;
        ctx.fillRect(fx - 10, fy - 10, 22, 22);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `hsl(${f.hue},90%,85%)`;
        ctx.fillRect(Math.floor(fx), Math.floor(fy), 2, 2);
        if (f.caught > 0) {
            f.caught = Math.max(0, f.caught - 0.05);
            if (f.caught === 0) f.alive = false;
        }
    }
    ctx.restore();
    // Schedule respawn after all fireflies fade out (5-8s later)
    if (_fireflies.length > 0 && _fireflies.every(f => !f.alive)) {
        _fireflies = [];
        _fireflyNextRespawnAt = tick + 300 + Math.random() * 200;
    }

    // --- Echo-moths — alien flock that drifts across the daytime scene ---
    // Spawn every ~3-7 min during daylight only. The flock has a centre that
    // drifts diagonally, and each member orbits around it. Both keeper and
    // pet can interact (keeper tap → scatter; pet notices → CURIOSITY bump).
    if (!_moths && tick > _mothsNextAt && dayLight > 0.5) {
        const fromLeft = Math.random() < 0.5;
        _moths = {
            id: 'moths-' + tick,
            flockX: fromLeft ? -20 : w + 20,
            flockY: h * (0.22 + Math.random() * 0.35),
            vx: fromLeft ? 0.35 + Math.random() * 0.2 : -(0.35 + Math.random() * 0.2),
            vy: (Math.random() - 0.5) * 0.15,
            members: [],
            life: 1,
            scattered: 0,
        };
        const count = 4 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            _moths.members.push({
                ox: (Math.random() - 0.5) * 30,
                oy: (Math.random() - 0.5) * 16,
                phase: Math.random() * Math.PI * 2,
                hue: 280 + Math.random() * 80,
                flap: 0,
            });
        }
        // Next spawn after 3-7 min
        _mothsNextAt = tick + 3 * 60 * 60 + Math.floor(Math.random() * 4 * 60 * 60);
    }
    if (_moths) {
        _moths.flockX += _moths.vx;
        _moths.flockY += _moths.vy + Math.sin(tick * 0.01) * 0.08;
        if (_moths.scattered > 0) _moths.scattered *= 0.96;
        // Life ticks down; also die when off-screen
        _moths.life -= 0.0015;
        if (_moths.life <= 0 || _moths.flockX < -40 || _moths.flockX > w + 40) {
            _moths = null;
        } else {
            ctx.save();
            for (const m of _moths.members) {
                m.phase += 0.08;
                const flockScatter = _moths.scattered;
                const mx = _moths.flockX + m.ox * (1 + flockScatter * 2) + Math.sin(m.phase) * 6;
                const my = _moths.flockY + m.oy * (1 + flockScatter * 2) + Math.cos(m.phase * 1.1) * 4;
                // Store resolved positions for hit-testing
                m.x = mx; m.y = my;
                // Pixel moth: 2 wings + 1-pixel body, flap every few frames
                const flap = Math.floor(tick * 0.25 + m.phase * 10) % 2 === 0 ? 1 : 0;
                ctx.globalAlpha = _moths.life;
                ctx.fillStyle = `hsl(${m.hue}, 70%, 72%)`;
                // Wings
                if (flap) {
                    ctx.fillRect(Math.round(mx) - 3, Math.round(my), 2, 1);
                    ctx.fillRect(Math.round(mx) + 2, Math.round(my), 2, 1);
                } else {
                    ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 1, 2, 2);
                    ctx.fillRect(Math.round(mx) + 1, Math.round(my) - 1, 2, 2);
                }
                // Body
                ctx.fillStyle = `hsl(${m.hue}, 85%, 85%)`;
                ctx.fillRect(Math.round(mx), Math.round(my), 1, 1);
            }
            ctx.restore();
        }
    }

    // Environmental grime when the pet has been dirty for a while —
    // dark patches on the ground + floating dust motes around the canvas.
    if (pet && pet.needs && pet.needs[2 /* MISKA */] < 45) {
        const dirt = 1 - pet.needs[2] / 45;
        ctx.save();
        // Dark smudges scattered on the ground
        for (let i = 0; i < 14; i++) {
            const dx = ((i * 97 + petHue) % w);
            const dy = groundY + 2 + (i % 4) * 3;
            ctx.globalAlpha = 0.25 * dirt;
            ctx.fillStyle = '#2A2014';
            ctx.beginPath();
            ctx.ellipse(dx, dy, 6 + (i % 3) * 3, 2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // Floating dust motes drifting upward
        for (let i = 0; i < Math.round(6 + dirt * 12); i++) {
            const dx = ((i * 41 + tick * 0.02) % w);
            const dy = groundY - ((tick * 0.4 + i * 31) % (groundY * 0.45));
            ctx.globalAlpha = 0.15 + dirt * 0.25;
            ctx.fillStyle = '#7A6B48';
            ctx.fillRect(Math.floor(dx), Math.floor(dy), 2, 2);
        }
        ctx.restore();
    }

    // Aurora borealis bands (undulating translucent ribbons, stage 4+ only)
    if (stage >= 4) {
        ctx.save();
        const auroraAlpha = 0.04 + Math.sin(tick * 0.002) * 0.02;
        ctx.globalAlpha = auroraAlpha;
        for (let band = 0; band < 3; band++) {
            const baseAY = h * (0.12 + band * 0.08);
            ctx.strokeStyle = `hsl(${(petHue + band * 80) % 360},80%,60%)`;
            ctx.lineWidth = 12 - band * 3;
            ctx.beginPath();
            for (let x = 0; x <= w; x += 8) {
                const aY = baseAY + Math.sin(x * 0.005 + tick * 0.003 + band * 1.5) * (20 + band * 8);
                x === 0 ? ctx.moveTo(x, aY) : ctx.lineTo(x, aY);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    return groundY;
}

// ---------------------------------------------------------------------------
// Needs visual manifestation
// ---------------------------------------------------------------------------
// Strip of big labeled icons above the pet, one per critically low need.
// Designed to be immediately readable at a glance — no ambiguous particles.
function drawNeedsBanner(ctx, pet, cx, cy, bodyW, bodyH, tick) {
    const needs = pet.needs;
    // Only show truly urgent ones (<30); warn level (<50) uses faded icon
    const items = [];
    const defs = [
        { i: 0, icon: '🍎', name: 'Fame',       color: '#E07030' },
        { i: 1, icon: '💤', name: 'Stanco',    color: '#6A5AAA' },
        { i: 2, icon: '💧', name: 'Sporco',    color: '#8EC8E0' },
        { i: 3, icon: '😢', name: 'Triste',    color: '#E0C070' },
        { i: 4, icon: '❤',  name: 'Malato',    color: '#E04848' },
        { i: 5, icon: '🧠', name: 'Apatico',   color: '#C06BC0' },
        { i: 6, icon: '🫂', name: 'Solo',      color: '#E06AA0' },
        { i: 7, icon: '👁', name: 'Annoiato',  color: '#60E0E0' },
        { i: 8, icon: '✨', name: 'Cosmico',   color: '#E0C848' },
        { i: 9, icon: '🛡', name: 'Impaurito', color: '#A070C0' },
    ];
    for (const d of defs) {
        const v = needs[d.i];
        if (v < 50) {
            const severity = v < 20 ? 'crit' : v < 35 ? 'warn' : 'mild';
            items.push({ ...d, v, severity });
        }
    }
    if (!items.length) return;
    // Sort by severity (lowest first)
    items.sort((a, b) => a.v - b.v);
    // Show at most 4 to avoid clutter
    const shown = items.slice(0, 4);

    const iconW = 42;
    const gap = 8;
    const totalW = shown.length * iconW + (shown.length - 1) * gap;
    const startX = cx - totalW / 2 + iconW / 2;
    const y = cy - bodyH - 56;

    for (let k = 0; k < shown.length; k++) {
        const it = shown[k];
        const x = startX + k * (iconW + gap);
        // Background pill
        const pulse = it.severity === 'crit' ? (Math.sin(tick * 0.12) * 0.5 + 0.5) : 0;
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.fillStyle = 'rgba(10,25,41,0.88)';
        ctx.strokeStyle = it.severity === 'crit'
            ? `rgba(224,72,72,${0.6 + pulse * 0.4})`
            : (it.severity === 'warn' ? 'rgba(224,200,72,0.7)' : 'rgba(212,165,52,0.4)');
        ctx.lineWidth = it.severity === 'crit' ? 2.2 : 1.5;
        const r = 10;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x - iconW / 2, y - 18, iconW, 36, r) : ctx.rect(x - iconW / 2, y - 18, iconW, 36);
        ctx.fill();
        ctx.stroke();
        // Icon
        ctx.globalAlpha = 1;
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = it.color;
        ctx.shadowBlur = it.severity === 'crit' ? 12 : 4;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(it.icon, x, y - 1);
        // Label under
        ctx.shadowBlur = 2;
        ctx.shadowColor = '#000';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = it.severity === 'crit' ? '#E04848' : '#E0C070';
        ctx.fillText(it.name, x, y + 14);
        ctx.restore();
    }
}

function drawNeedsIndicators(ctx, pet, cx, cy, bodyW, bodyH, tick) {
    // Clear labeled strip first (most legible layer)
    drawNeedsBanner(ctx, pet, cx, cy, bodyW, bodyH, tick);
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
function drawEgg(ctx, cx, cy, tick, pet) {
    // Pre-hatch excitement: if close to hatching, shake increases
    let closeToHatch = 0;
    if (pet) {
        const pctAge   = Math.min(1, (pet.ageSeconds / 60) / 10);
        const pctTouch = Math.min(1, (pet.touchInteractions || 0) / 3);
        closeToHatch = Math.min(pctAge, pctTouch);
    }
    const shakeAmp = closeToHatch > 0.7 ? (closeToHatch - 0.7) * 18 : 0;
    const shakeX = Math.sin(tick * 0.5) * shakeAmp;
    const shakeY = Math.cos(tick * 0.7) * shakeAmp * 0.6;
    cx += shakeX; cy += shakeY;

    const pulse = Math.sin(tick * 0.03) * 3;
    const glowAlpha = 0.3 + Math.sin(tick * 0.05) * 0.15;

    // Ground shadow
    ctx.fillStyle = `rgba(0,0,0,${0.18 + closeToHatch * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 50, 34 - shakeAmp * 0.4, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Outer glow — brightens as hatching nears
    const glowSize = 55 + pulse + closeToHatch * 18;
    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, glowSize);
    grad.addColorStop(0, `rgba(62, 207, 207, ${glowAlpha + closeToHatch * 0.3})`);
    grad.addColorStop(0.5, `rgba(212, 165, 52, ${closeToHatch * 0.25})`);
    grad.addColorStop(1, 'rgba(62, 207, 207, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, glowSize, glowSize, 0, 0, Math.PI * 2);
    ctx.fill();

    // Egg body with gradient (top-lit)
    const eggGrad = ctx.createRadialGradient(cx - 10, cy - 12, 4, cx, cy, 38);
    eggGrad.addColorStop(0, '#3C5F75');
    eggGrad.addColorStop(0.7, '#1A3A4A');
    eggGrad.addColorStop(1, '#0D2230');
    ctx.fillStyle = eggGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30, 38 + pulse * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rim highlight
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#6EBFD0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 2, 28, 36, 0, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.restore();

    // Specular highlight (top-left)
    ctx.save();
    ctx.globalAlpha = 0.55;
    const hl = ctx.createRadialGradient(cx - 10, cy - 14, 0, cx - 10, cy - 14, 12);
    hl.addColorStop(0, 'rgba(255,255,255,0.9)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(cx - 8, cy - 14, 9, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

    // Core pulse — gold & bigger near hatching
    const corePulse = 8 + pulse * 0.5 + closeToHatch * 4;
    const coreCol = closeToHatch > 0.8 ? `rgba(212, 165, 52, ${glowAlpha + 0.2})` : `rgba(62, 207, 207, ${glowAlpha + 0.1})`;
    ctx.fillStyle = coreCol;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, corePulse, 0, Math.PI * 2);
    ctx.fill();

    // Emerging cracks when very close to hatch
    if (closeToHatch > 0.85) {
        const crackAlpha = (closeToHatch - 0.85) / 0.15;
        ctx.save();
        ctx.strokeStyle = `rgba(255, 230, 120, ${crackAlpha})`;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#FFE699';
        ctx.shadowBlur = 8;
        for (let i = 0; i < 3; i++) {
            const a = i * Math.PI * 2 / 3 + tick * 0.003;
            const x0 = cx + Math.cos(a) * 8;
            const y0 = cy + Math.sin(a) * 8;
            const x1 = cx + Math.cos(a) * 28;
            const y1 = cy + Math.sin(a) * 32;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo((x0 + x1) / 2 + (Math.random() - 0.5) * 3, (y0 + y1) / 2 + (Math.random() - 0.5) * 3);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Interaction area for egg
    Interactions.setPetPosition(cx, cy, 38);

    // Hatching progress (shown below egg) — 10 minutes + 3 tocchi
    if (pet) {
        const ageMin = pet.getAgeMinutes ? pet.getAgeMinutes() : Math.floor(pet.ageSeconds / 60);
        const ageSec = Math.floor(pet.ageSeconds % 60);
        const touch  = pet.touchInteractions;
        const needMin  = 10;
        const needT    = 3;
        const pctAge   = Math.min(1, (pet.ageSeconds / 60) / needMin);
        const pctTouch = Math.min(1, touch / needT);
        const barW = 100;
        const barH = 7;
        const yBase = cy + 58;

        // Time bar
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(cx - barW / 2, yBase, barW, barH);
        const timeGrad = ctx.createLinearGradient(cx - barW / 2, 0, cx + barW / 2, 0);
        if (pctAge >= 1) { timeGrad.addColorStop(0, '#40C470'); timeGrad.addColorStop(1, '#90E0B0'); }
        else { timeGrad.addColorStop(0, '#3ECFCF'); timeGrad.addColorStop(1, '#80E8E8'); }
        ctx.fillStyle = timeGrad;
        ctx.fillRect(cx - barW / 2, yBase, barW * pctAge, barH);

        // Touch bar
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(cx - barW / 2, yBase + 12, barW, barH);
        const tGrad = ctx.createLinearGradient(cx - barW / 2, 0, cx + barW / 2, 0);
        if (pctTouch >= 1) { tGrad.addColorStop(0, '#40C470'); tGrad.addColorStop(1, '#90E0B0'); }
        else { tGrad.addColorStop(0, '#E060A0'); tGrad.addColorStop(1, '#F0A0C8'); }
        ctx.fillStyle = tGrad;
        ctx.fillRect(cx - barW / 2, yBase + 12, barW * pctTouch, barH);

        // Labels
        ctx.fillStyle = 'rgba(234,251,251,0.8)';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        const timeStr = ageMin >= needMin ? '✓' : `${ageMin}:${String(ageSec).padStart(2,'0')}/${needMin}:00`;
        ctx.fillText(`⏳ ${timeStr}`, cx - barW / 2, yBase - 3);
        ctx.fillText(`✋ ${touch}/${needT}`, cx - barW / 2, yBase + 9);
    }
}

// ---------------------------------------------------------------------------
// Solo games — small overlays for pet's self-entertainment.
// ---------------------------------------------------------------------------
function drawSoloGame(ctx, pet, cx, cy, tick) {
    const g = pet._soloGame;
    if (!g) return;
    const petHue = (pet.dna && pet.dna.coreHue) || 200;
    const groundY = cy + 50;

    if (g.key === 'chase_firefly') {
        const fx = cx + (g.data.fireflyX || 0);
        const fy = cy + (g.data.fireflyY || -60);
        const blink = 0.55 + Math.sin(tick * 0.25) * 0.4;
        ctx.save();
        // Glow
        ctx.globalAlpha = blink * 0.7;
        const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, 14);
        grad.addColorStop(0, '#FFF1A0');
        grad.addColorStop(0.4, 'rgba(255,200,120,0.5)');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(fx - 16, fy - 16, 32, 32);
        // Core
        ctx.globalAlpha = blink;
        ctx.fillStyle = '#FFF8C8';
        ctx.fillRect(Math.floor(fx) - 1, Math.floor(fy) - 1, 3, 3);
        ctx.restore();
    } else if (g.key === 'pebble_stack') {
        const baseX = cx + (g.data.stackX || 0) + 28;
        ctx.save();
        for (let i = 0; i < g.data.stones; i++) {
            const w = 10 - i * 1.4;
            const py = groundY - 4 - i * 5;
            ctx.fillStyle = i % 2 === 0 ? '#7A6A50' : '#5C4E38';
            ctx.fillRect(Math.floor(baseX - w / 2), Math.floor(py), Math.round(w), 4);
            ctx.fillStyle = '#A89878';
            ctx.fillRect(Math.floor(baseX - w / 2), Math.floor(py), Math.round(w), 1);
        }
        ctx.restore();
    } else if (g.key === 'shadow_dance') {
        ctx.save();
        const pulse = Math.sin(tick * 0.12);
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = `hsla(${petHue},80%,60%,0.35)`;
        ctx.beginPath();
        ctx.ellipse(cx, groundY + 4, 30 + pulse * 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        // Swirling sparkles
        for (let i = 0; i < 6; i++) {
            const ang = tick * 0.06 + i * Math.PI / 3;
            const r = 34;
            const sx = cx + Math.cos(ang) * r;
            const sy = cy + Math.sin(ang) * r * 0.3;
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = `hsl(${(petHue + i * 40) % 360},80%,70%)`;
            ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
        }
        ctx.restore();
    } else if (g.key === 'star_gaze') {
        // A shooting star streaks across the sky above the pet
        const canvas = document.getElementById('game-canvas');
        const W = (canvas && canvas.width) || 800;
        const H = (canvas && canvas.height) || 480;
        const elapsed = (Date.now() - g.startedAt) / 1000;
        const t = (elapsed % 10) / 10;
        const sx = g.data.starX * W + t * 200;
        const sy = g.data.starY * H + t * 40;
        ctx.save();
        ctx.strokeStyle = '#FFE8B0';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - 30, sy - 12);
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
        // Small eye-shine up from pet
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = `hsla(${petHue},80%,75%,0.9)`;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 10);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.restore();
    } else if (g.key === 'bubble_blow') {
        ctx.save();
        for (const b of (g.data.bubbles || [])) {
            ctx.globalAlpha = Math.max(0, b.life * 0.8);
            ctx.strokeStyle = `hsl(${b.hue},70%,80%)`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx + b.x, cy + b.y, b.r, 0, Math.PI * 2);
            ctx.stroke();
            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillRect(Math.floor(cx + b.x - b.r * 0.4), Math.floor(cy + b.y - b.r * 0.4), 1, 1);
        }
        ctx.restore();
    } else if (g.key === 'dig_hole') {
        const hx = cx + (g.data.holeX || 0) + 30;
        ctx.save();
        ctx.fillStyle = '#0C0A08';
        ctx.beginPath();
        ctx.ellipse(hx, groundY + 4, 6 + g.data.dug, 2 + g.data.dug * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        // Dirt pile beside it
        ctx.fillStyle = '#3A2A18';
        ctx.beginPath();
        ctx.ellipse(hx + 14, groundY + 2, 4 + g.data.dug * 0.5, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    // Small label above the pet
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#D4A534';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    const labels = {
        chase_firefly: '· insegue una lucciola ·',
        pebble_stack:  '· impila sassolini ·',
        shadow_dance:  '· balla con l\'ombra ·',
        star_gaze:     '· osserva le stelle ·',
        bubble_blow:   '· soffia bolle ·',
        dig_hole:      '· scava una buca ·',
    };
    ctx.fillText(labels[g.key] || '', cx, cy - 70);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Body dirt — seeded pixel stains that grow as MISKA drops.
// ---------------------------------------------------------------------------
function _drawBodyDirt(ctx, pet, cx, cy, bodyW, bodyH, tick) {
    const miska = pet.needs ? pet.needs[2 /* MISKA */] : 100;
    if (miska >= 55) return;
    const severity = 1 - miska / 55;  // 0..1
    const stainCount = Math.round(3 + severity * 9);
    // Stable seed from pet DNA so stains don't jitter between frames
    const seed = (pet.dna?.coreHue ?? 200) * 13 + (pet.stage || 0) * 7;
    ctx.save();
    const halfW = bodyW * 0.45;
    const halfH = bodyH * 0.75;
    for (let i = 0; i < stainCount; i++) {
        const r1 = ((seed + i * 131) % 1000) / 1000;
        const r2 = ((seed + i * 271) % 1000) / 1000;
        const r3 = ((seed + i * 59)  % 1000) / 1000;
        const dx = (r1 - 0.5) * halfW * 1.6;
        const dy = (r2 - 0.4) * halfH * 1.3;
        const size = 2 + Math.round(r3 * 3) + (severity > 0.7 ? 1 : 0);
        // Darkest when very dirty, with a slight green-brown bias
        ctx.globalAlpha = 0.4 + severity * 0.4;
        ctx.fillStyle = severity > 0.65 ? '#2F2410' : '#4A3A20';
        // Blocky pixel clump
        ctx.fillRect(Math.floor(cx + dx),      Math.floor(cy + dy),      size, size);
        if (size > 2) {
            ctx.fillRect(Math.floor(cx + dx + size), Math.floor(cy + dy),      size - 1, size - 1);
            ctx.fillRect(Math.floor(cx + dx),        Math.floor(cy + dy + size), size - 1, 1);
        }
    }
    // Flies buzz around very dirty pet
    if (severity > 0.6) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#111';
        for (let i = 0; i < 3; i++) {
            const ang = tick * 0.06 + i * 2.1;
            const fx = cx + Math.cos(ang) * (bodyW * 0.6);
            const fy = cy - bodyH * 0.3 + Math.sin(ang * 1.3) * 14;
            ctx.fillRect(Math.floor(fx), Math.floor(fy), 2, 1);
        }
    }
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Creature
// ---------------------------------------------------------------------------
function drawCreature(ctx, pet, cx, cy, tick) {
    // Preload this stage's sprites the first time we see it
    SpriteLoader.preloadStage(pet.stage);

    // Activity-based body transforms (sleep lies down, afraid shrinks, etc.)
    const act = Activity.getType(pet);
    const isSleeping = act === 'SLEEPING';
    const isAfraid = act === 'AFRAID';
    const isEating = act === 'EATING';
    // Breath rate
    const breathRate = isSleeping ? 0.012 : (isAfraid ? 0.055 : (isEating ? 0.045 : 0.025));
    const breathAmp  = isSleeping ? 3.5 : (isAfraid ? 1.0 : (isEating ? 2.5 : 2.0));
    const breathe = Math.sin(tick * breathRate) * breathAmp;

    // Security shake
    const shake = getSecurityShake(pet.needs, tick);
    cx += shake.x;
    cy += shake.y + breathe;

    // Afraid tremble
    if (isAfraid) { cx += (Math.random() - 0.5) * 1.5; cy += (Math.random() - 0.5) * 1.5; }
    // Eating bob
    if (isEating) cx += Math.sin(tick * 0.12) * 3;

    // Ground shadow under the pet (uses activity-aware scale)
    const baseSize = 25 + pet.stage * 8;
    const bodyW = baseSize + (pet.dna?.bodyCurvature ?? 0) * 3;
    const bodyH = baseSize * 1.2 + breathe;
    const groundY = cy + bodyH + 10;
    const hopLift = Math.max(0, -((pet.motion && pet.motion.offsetY) || 0));
    const shadowW = bodyW * (0.9 - hopLift * 0.004);
    if (shadowW > 8) {
        const sg = ctx.createRadialGradient(cx, groundY, 2, cx, groundY, shadowW);
        sg.addColorStop(0, `rgba(0,0,0,${0.22 - hopLift * 0.0015})`);
        sg.addColorStop(0.7, 'rgba(0,0,0,0.08)');
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(cx, groundY, shadowW, Math.max(2, 6 - hopLift * 0.08), 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Global filters for mood states (desaturation during sick/sulky)
    ctx.save();
    if (act === 'SICK') ctx.filter = 'saturate(0.55) brightness(0.92)';
    else if (act === 'SULKY') ctx.filter = 'saturate(0.75) brightness(0.85)';

    // Try the pixel-art sprite first; fall back to procedural if not ready
    let drawn = false;
    try { drawn = SpriteLoader.draw(ctx, pet, cx, cy, 1); } catch (_) {}
    if (!drawn) {
        try { _drawCreatureBody(pet, ctx, cx, cy, tick); } catch (e) { console.error('[DRAW]', e); }
    }
    // Sync hit area
    const sz = drawn ? SpriteLoader.getBodySize(pet, 1) : { w: bodyW * 2 };
    try { Interactions.setPetPosition(cx, cy, (sz.w || 50) * 0.45); } catch (_) {}
    // Dirt stains on the body (seeded per pet, stable across frames).
    _drawBodyDirt(ctx, pet, cx, cy, (sz.w || bodyW * 2), bodyH, tick);
    ctx.restore();

    // Draw needs banner above the pet (overlay)
    drawNeedsIndicators(ctx, pet, cx, cy, bodyW, bodyH, tick);
}

function _drawCreatureBody(pet, ctx, cx, cy, tick) {
    const colors = getPetColors(pet);
    const stage = pet.stage;
    const mood = pet.getMood();
    const actType = Activity.getType(pet);
    const isSleeping = actType === 'SLEEPING';
    const isEating   = actType === 'EATING';
    const isSick     = actType === 'SICK';
    const isAfraid   = actType === 'AFRAID';
    const isSulky    = actType === 'SULKY';
    const isMeditating = actType === 'MEDITATING';

    // Breath rate: slower & deeper when asleep, quicker when scared/eating
    const breathRate = isSleeping ? 0.012 : (isAfraid ? 0.055 : (isEating ? 0.045 : 0.025));
    const breathAmp  = isSleeping ? 3.5   : (isAfraid ? 1.0  : (isEating ? 2.5  : 2.0));
    const breathe = Math.sin(tick * breathRate) * breathAmp;

    // Security shake
    const shake = getSecurityShake(pet.needs, tick);
    cx += shake.x;
    cy += shake.y;

    // Posture: slight flattening when asleep (curled on ground)
    const size = 25 + stage * 8;
    const baseSize = size;
    const postureH = isSleeping ? 0.88 : (isSulky ? 0.95 : 1.0);
    const postureW = isSleeping ? 1.10 : (isAfraid ? 0.92 : 1.0);
    const bodyW = (baseSize + pet.dna.bodyCurvature * 3) * postureW;
    const bodyH = (baseSize * 1.2 + breathe) * postureH;

    // When sleeping, drop the pet a bit closer to the ground
    if (isSleeping) cy += size * 0.18;
    // When afraid, shrink a little
    if (isAfraid)   cy += size * 0.08;
    // Lean forward while eating (wobble)
    if (isEating)   cx += Math.sin(tick * 0.12) * 3;
    // Afraid trembling micro-motion
    if (isAfraid)   { cx += (Math.random() - 0.5) * 1.5; cy += (Math.random() - 0.5) * 1.5; }

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

    // Ground shadow (soft radial blur), narrower when the pet hops
    const groundY = cy + bodyH + 15;
    const hopLift = Math.max(0, -((pet.motion && pet.motion.offsetY) || 0));
    const shadowW = bodyW * (0.9 - hopLift * 0.004);
    const shadowH = 6 - hopLift * 0.08;
    const shadowAlpha = 0.18 - hopLift * 0.0015;
    if (shadowW > 8) {
        const sg = ctx.createRadialGradient(cx, groundY, 2, cx, groundY, shadowW);
        sg.addColorStop(0, `rgba(0,0,0,${Math.max(0.05, shadowAlpha)})`);
        sg.addColorStop(0.7, `rgba(0,0,0,${Math.max(0.02, shadowAlpha * 0.4)})`);
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.ellipse(cx, groundY, shadowW, Math.max(2, shadowH), 0, 0, Math.PI * 2);
        ctx.fill();
    }

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
    const bodyGrad = ctx.createRadialGradient(cx - bodyW * 0.25, cy - bodyH * 0.28, bodyW * 0.1, cx, cy, bodyW);
    bodyGrad.addColorStop(0, colors.glow);
    bodyGrad.addColorStop(0.55, colors.core);
    bodyGrad.addColorStop(1, colors.dark);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyW, bodyH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rim light (top edge) — extra depth; dimmed when SICK/AFRAID
    const rimAlpha = isSleeping ? 0.18 : (isSick ? 0.12 : (isAfraid ? 0.20 : 0.32));
    ctx.save();
    ctx.globalAlpha = rimAlpha;
    ctx.strokeStyle = colors.glow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy - bodyH * 0.08, bodyW * 0.96, bodyH * 0.96, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.restore();

    // Specular highlight (small bright spot, upper-left)
    ctx.save();
    ctx.globalAlpha = 0.45;
    const hl = ctx.createRadialGradient(cx - bodyW * 0.35, cy - bodyH * 0.4, 0, cx - bodyW * 0.35, cy - bodyH * 0.4, bodyW * 0.35);
    hl.addColorStop(0, 'rgba(255,255,255,0.9)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.ellipse(cx - bodyW * 0.3, cy - bodyH * 0.35, bodyW * 0.3, bodyH * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

    // Eye state: closed when sleeping, squinted when tired, idle blink otherwise
    // (activity flags isSleeping/isEating/isSick/isAfraid/isSulky/isMeditating are already
    //  declared at the top of _drawCreatureBody — reuse them.)
    const activityType = actType;

    // Blink animation: ~3.5s cycle, closes for ~120ms
    const blinkCycle = (tick % 210);     // ~3.5s at 60fps
    const blinkFactor = blinkCycle < 8 ? 1 - (blinkCycle / 8)
                      : blinkCycle < 16 ? (blinkCycle - 8) / 8 : 1;
    // Meditating: eyes half-closed
    const meditateFactor = isMeditating ? 0.35 : 1;
    // Afraid: eyes wide open
    const afraidFactor = isAfraid ? 1.25 : 1;
    // Sulky: eyes half-closed, averted
    const sulkyFactor = isSulky ? 0.55 : 1;

    const sleepy = pet.needs[NeedType.MOKO] < 35;
    const tiredSquint = sleepy ? 0.5 + (pet.needs[NeedType.MOKO] / 35) * 0.5 : 1.0;

    const sleepSquint = isSleeping
        ? 0.02
        : tiredSquint * blinkFactor * meditateFactor * afraidFactor * sulkyFactor;

    // When truly sleeping, draw closed-eye curves then skip normal pupils.
    if (isSleeping) {
        for (const side of [-1, 1]) {
            const ex = cx + side * (bodyW * 0.28);
            const wob = Math.sin(tick * 0.025 + side) * 0.8;
            ctx.save();
            ctx.strokeStyle = '#1A1A2E';
            ctx.lineWidth = Math.max(1.5, eyeSize * 0.18);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(ex - eyeSize * 0.9, eyeY + wob);
            ctx.quadraticCurveTo(ex, eyeY + eyeSize * 0.35 + wob, ex + eyeSize * 0.9, eyeY + wob);
            ctx.stroke();
            ctx.lineWidth = Math.max(1, eyeSize * 0.1);
            ctx.beginPath();
            ctx.moveTo(ex - eyeSize * 0.55, eyeY - eyeSize * 0.05 + wob);
            ctx.lineTo(ex - eyeSize * 0.72, eyeY - eyeSize * 0.3  + wob);
            ctx.moveTo(ex + eyeSize * 0.55, eyeY - eyeSize * 0.05 + wob);
            ctx.lineTo(ex + eyeSize * 0.72, eyeY - eyeSize * 0.3  + wob);
            ctx.stroke();
            ctx.restore();
        }
    }

    for (const side of [-1, 1]) {
        if (isSleeping) break;
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
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (isSleeping) {
        // Small open "O" for breathing
        const breath = 1 + Math.sin(tick * 0.04) * 0.15;
        ctx.ellipse(cx, mouthY + 2, 2.5 * breath, 2 * breath, 0, 0, Math.PI * 2);
    } else if (activityType === 'EATING') {
        // Mouth chewing (opens/closes with tick)
        const chew = Math.abs(Math.sin(tick * 0.18));
        ctx.ellipse(cx, mouthY + 1, 6, 2 + 3 * chew, 0, 0, Math.PI * 2);
    } else if (isSulky) {
        // Downward pout
        ctx.arc(cx, mouthY + 7, 5, Math.PI + 0.3, -0.3);
    } else if (mood === 'happy' || Interactions.isPetting()) {
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
// ---------------------------------------------------------------------------
// Activity overlays — big, readable cues on top of the pet
// ---------------------------------------------------------------------------
function drawActivityOverlay(ctx, pet, cx, cy, tick) {
    const type = Activity.getType(pet);
    if (type === 'SLEEPING') {
        // Big animated Z's rising from the head
        const headY = cy - 70;
        for (let i = 0; i < 3; i++) {
            const phase = (tick * 0.015 + i * 1.7) % (Math.PI * 2);
            const t = (tick * 0.4 + i * 40) % 120;
            const zx = cx + 24 + Math.sin(phase) * 10 + i * 10;
            const zy = headY - t;
            const life = 1 - t / 120;
            if (life <= 0) continue;
            ctx.save();
            ctx.globalAlpha = life * 0.95;
            ctx.fillStyle = '#8AB4FF';
            ctx.font = `bold ${14 + i * 6}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.shadowColor = '#4A6AE0';
            ctx.shadowBlur = 6;
            ctx.fillText('Z', zx, zy);
            ctx.restore();
        }
        // "DORMENDO" label
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(74,106,224,0.92)';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('· DORMENDO ·', cx, cy + 90);
        ctx.restore();
    } else if (type === 'EATING') {
        // Food sparkles orbiting near mouth
        for (let i = 0; i < 6; i++) {
            const ang = tick * 0.06 + i * (Math.PI * 2 / 6);
            const r = 32 + Math.sin(tick * 0.08 + i) * 4;
            const px = cx + Math.cos(ang) * r;
            const py = cy + 10 + Math.sin(ang) * r * 0.5;
            ctx.save();
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = '#E07030';
            ctx.beginPath();
            ctx.arc(px, py, 3 + Math.sin(tick * 0.15 + i) * 1.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.save();
        ctx.fillStyle = '#E07030';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 0.9;
        ctx.fillText('· KORA ·', cx, cy + 90);
        ctx.restore();
    } else if (type === 'MEDITATING') {
        // Golden aura + orbiting particles
        ctx.save();
        const auraR = 70 + Math.sin(tick * 0.05) * 8;
        const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, auraR * 1.6);
        grad.addColorStop(0, 'rgba(212,165,52,0.45)');
        grad.addColorStop(0.5, 'rgba(212,165,52,0.15)');
        grad.addColorStop(1, 'rgba(212,165,52,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, auraR * 1.6, 0, Math.PI * 2); ctx.fill();
        // Orbiting runes
        for (let i = 0; i < 5; i++) {
            const ang = tick * 0.015 + i * (Math.PI * 2 / 5);
            const ox = cx + Math.cos(ang) * auraR;
            const oy = cy + Math.sin(ang) * auraR * 0.45;
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = '#FFE899';
            ctx.shadowColor = '#D4A534';
            ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(ox, oy, 2.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#D4A534';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('· SELATH ·', cx, cy + 92);
        ctx.restore();
    } else if (type === 'SICK') {
        // Sickly green haze + occasional sneeze
        ctx.save();
        ctx.globalAlpha = 0.18 + Math.sin(tick * 0.02) * 0.08;
        const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 100);
        g.addColorStop(0, 'rgba(120,180,80,0.4)');
        g.addColorStop(1, 'rgba(60,120,40,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, 100, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // Small sweat drops
        for (let i = 0; i < 2; i++) {
            const phase = (tick * 0.6 + i * 80) % 100;
            const life = 1 - phase / 100;
            if (life <= 0) continue;
            ctx.save();
            ctx.globalAlpha = life;
            ctx.fillStyle = '#9ED080';
            ctx.beginPath();
            ctx.arc(cx - 30 + i * 60, cy - 50 - phase * 0.3, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.save();
        ctx.fillStyle = '#90C070';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('· MALATO ·', cx, cy + 92);
        ctx.restore();
    } else if (type === 'AFRAID') {
        // Shivering darkness + wide pupils already handled in drawCreature via hue;
        // here we draw fear spikes
        for (let i = 0; i < 8; i++) {
            const ang = i * (Math.PI * 2 / 8) + Math.sin(tick * 0.04) * 0.06;
            const r1 = 38, r2 = 46;
            ctx.save();
            ctx.globalAlpha = 0.35 + Math.sin(tick * 0.08 + i) * 0.15;
            ctx.strokeStyle = '#A070C0';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
            ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
            ctx.stroke();
            ctx.restore();
        }
        ctx.save();
        ctx.fillStyle = '#A070C0';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('· IMPAURITO ·', cx, cy + 92);
        ctx.restore();
    } else if (type === 'SULKY') {
        // Tiny cloud over the head
        ctx.save();
        ctx.fillStyle = 'rgba(80,80,100,0.7)';
        ctx.strokeStyle = 'rgba(120,120,150,0.9)';
        ctx.lineWidth = 1.2;
        const headY = cy - 72;
        ctx.beginPath(); ctx.arc(cx - 12, headY,     8, 0, Math.PI * 2);
        ctx.arc(cx + 4,  headY - 4,  9, 0, Math.PI * 2);
        ctx.arc(cx + 18, headY + 2,  7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        // Rain drop
        const drop = (tick * 0.5) % 40;
        ctx.globalAlpha = 1 - drop / 40;
        ctx.fillStyle = '#9AAAC5';
        ctx.beginPath(); ctx.arc(cx, headY + 10 + drop, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.fillStyle = '#8090A8';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('· MUSO LUNGO ·', cx, cy + 92);
        ctx.restore();
    }
}

// Small thought-bubble icon above the pet, with label
function drawDesireBubble(ctx, cx, cy, tick, desire) {
    const bx = cx + 70 + Math.sin(tick * 0.03) * 3;
    const by = cy - 90;
    const pulse = 1 + Math.sin(tick * 0.06) * 0.05;

    ctx.save();
    // Small connecting circles
    ctx.fillStyle = 'rgba(10,25,41,0.88)';
    ctx.strokeStyle = 'rgba(212,165,52,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx + 36, cy - 48, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 48, cy - 62, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // Main bubble
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(10,25,41,0.94)';
    ctx.strokeStyle = '#D4A534';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 36, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Icon
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(desire.icon, 0, 0);
    ctx.restore();

    // Label under bubble
    ctx.fillStyle = '#D4A534';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;
    ctx.fillText(desire.label, bx, by + 40);
    ctx.restore();
}

export const Renderer = {
    setScale(sx, sy) { _scaleX = sx; _scaleY = sy; },

    /** Hit-test environmental elements (fireflies, sun, moon) against a
     *  canvas-space tap. Returns { kind, id?, x, y } or null.
     *  Input coords are in FULL-res canvas space; internally converted
     *  to the low-res bg space where these entities are drawn. */
    hitTestEnvironment(x, y) {
        if (!_canvas || !_bgCanvas) return null;
        const sx = _bgCanvas.width  / _canvas.width;
        const sy = _bgCanvas.height / _canvas.height;
        const bx = x * sx, by = y * sy;
        // Celestial (most prominent) first
        if (_celestial) {
            const dx = bx - _celestial.x, dy = by - _celestial.y;
            if (dx * dx + dy * dy <= _celestial.r * _celestial.r) {
                return { kind: _celestial.kind, x, y };
            }
        }
        // Fireflies — larger hit radius than the visual so they're catchable
        for (const f of _fireflies) {
            if (!f.alive || f.caught > 0) continue;
            const dx = bx - f.x, dy = by - f.y;
            if (dx * dx + dy * dy <= 10 * 10) {
                return { kind: 'firefly', id: f.id, x, y };
            }
        }
        // Crystals on the ground
        for (const c of _crystals) {
            const dx = bx - c.x, dy = by - c.y;
            if (dx * dx + dy * dy <= c.r * c.r) {
                return { kind: 'crystal', id: c.id, hue: c.hue, x, y };
            }
        }
        // Echo-moths — hit on any member of the flock scatters the whole flock
        if (_moths) {
            for (const m of _moths.members) {
                if (m.x == null) continue;
                const dx = bx - m.x, dy = by - m.y;
                if (dx * dx + dy * dy <= 12 * 12) {
                    return { kind: 'moth', id: _moths.id, x, y };
                }
            }
        }
        // Shooting stars — a touch on the trail grants a wish
        for (const ss of _shootingStars) {
            if (ss.life <= 0) continue;
            // Trail passes through (ss.x, ss.y) back along (-len, -len*0.5).
            // Hit-test against the head with a generous radius.
            const dx = bx - ss.x, dy = by - ss.y;
            if (dx * dx + dy * dy <= 18 * 18) {
                return { kind: 'shooting-star', x, y };
            }
        }
        return null;
    },

    /** Mark a firefly as caught (plays its flare-out animation) */
    catchFirefly(id) {
        const f = _fireflies.find(fl => fl.id === id);
        if (f) f.caught = 1;
    },

    /** Scatter the current moth flock — they burst outward then fade. */
    scatterMoths() {
        if (!_moths) return;
        _moths.scattered = Math.max(_moths.scattered, 1);
        _moths.life = Math.min(_moths.life, 0.5);   // die sooner after a scatter
    },

    /** Catch the head shooting star. Plays a burst and consumes the trail. */
    catchShootingStar() {
        const ss = _shootingStars.find(s => s.life > 0.3);
        if (ss) ss.life = 0.1;
    },

    /** Register a sparkle overlay at (x, y) for tap feedback */
    sparkleAt(x, y, hue = 60) {
        _envSparkles.push({ x, y, hue, life: 1 });
    },


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

        // Background is drawn into a low-resolution offscreen buffer and
        // upscaled with nearest-neighbour sampling so the whole environment
        // (sky, nebula, ground, crystals, fireflies, aurora) reads as
        // pixel art — consistent with the pet sprites on top of it.
        const bgW = Math.max(64, Math.floor(w / PIXEL_SCALE));
        const bgH = Math.max(48, Math.floor(h / PIXEL_SCALE));
        if (!_bgCanvas || _bgCanvas.width !== bgW || _bgCanvas.height !== bgH) {
            _bgCanvas = document.createElement('canvas');
            _bgCanvas.width = bgW;
            _bgCanvas.height = bgH;
            _bgCtx = _bgCanvas.getContext('2d');
            _bgCtx.imageSmoothingEnabled = false;
        }
        const groundYLow = drawBackground(_bgCtx, bgW, bgH, _tick, pet);
        _ctx.imageSmoothingEnabled = false;
        _ctx.drawImage(_bgCanvas, 0, 0, bgW, bgH, 0, 0, w, h);
        _ctx.imageSmoothingEnabled = true;
        const groundY = groundYLow * (h / bgH);

        // Keep Items aware of current canvas size (for wander targeting)
        Items.setStage(w, h);
        Shelter.setStage(w, h);

        // Shelter / cave (drawn before pet so pet can walk "in front of" it)
        try { Shelter.draw(_ctx, _tick, pet); } catch (e) { console.warn('[shelter]', e); }

        // Draw items behind the pet (items on the floor)
        Items.draw(_ctx, _tick);

        // Autonomous motion (smooth lerp); applied as offset to the pet position
        Autonomy.updateMotion();
        const mo = pet.motion || { offsetX: 0, offsetY: 0, bob: 0, scaleBoost: 0 };

        // Emotive screen-shake from flinches/scares
        const shake = EmotiveEffects.getShakeOffset();

        // Pet vertical position: sit on the ground (+autonomous motion + shake)
        const baseCy = pet.isEgg() ? h * 0.4 : groundY - 30 - (pet.stage * 5);
        const liveCx = cx + (mo.offsetX || 0) + shake.x;
        const liveCy = baseCy + (mo.offsetY || 0) + (mo.bob || 0) + shake.y;

        // Draw pet (with emergency fallback — a visible circle if everything fails)
        try {
            if (!pet.isAlive()) {
                drawDeathSequence(_ctx, pet, liveCx, liveCy, _tick);
            } else if (pet.isEgg()) {
                drawEgg(_ctx, liveCx, liveCy, _tick, pet);
            } else {
                drawCreature(_ctx, pet, liveCx, liveCy, _tick);
            }
        } catch (renderErr) {
            console.error('[RENDER PET]', renderErr);
            // Emergency: draw a visible gold circle so the user knows something is there
            _ctx.fillStyle = '#D4A534';
            _ctx.beginPath();
            _ctx.arc(liveCx, liveCy, 40, 0, Math.PI * 2);
            _ctx.fill();
            _ctx.fillStyle = '#FFFFFF';
            _ctx.font = '12px sans-serif';
            _ctx.textAlign = 'center';
            _ctx.fillText('render error', liveCx, liveCy + 50);
        }

        // Activity overlays (Zzz while sleeping, food particles while eating, etc.)
        if (pet.isAlive() && !pet.isEgg()) {
            drawActivityOverlay(_ctx, pet, liveCx, liveCy, _tick);
            drawSoloGame(_ctx, pet, liveCx, liveCy, _tick);
        }

        // Desire bubble (autonomous request)
        const desire = Autonomy.getCurrentDesire ? Autonomy.getCurrentDesire() : null;
        if (desire && pet.isAlive() && !pet.isEgg()) {
            drawDesireBubble(_ctx, liveCx, liveCy, _tick, desire);
        }

        // Interaction particles (hearts, ripples)
        Interactions.update(_ctx, _tick);

        // Emotive pixel-art overlays (particles, thinking, flash)
        EmotiveEffects.draw(_ctx, liveCx, liveCy, _tick);

        // Environment-tap sparkles (fireflies caught, sun/moon touched)
        if (_envSparkles.length) {
            _ctx.save();
            _envSparkles = _envSparkles.filter(s => s.life > 0);
            for (const s of _envSparkles) {
                _ctx.globalAlpha = s.life;
                _ctx.fillStyle = `hsl(${s.hue},85%,75%)`;
                // Radial pixel burst
                for (let k = 0; k < 8; k++) {
                    const a = k * Math.PI / 4;
                    const r = (1 - s.life) * 28 + 4;
                    const px = Math.round(s.x + Math.cos(a) * r);
                    const py = Math.round(s.y + Math.sin(a) * r);
                    _ctx.fillRect(px, py, 3, 3);
                }
                _ctx.globalAlpha = s.life * 0.8;
                _ctx.fillRect(Math.round(s.x) - 2, Math.round(s.y) - 2, 4, 4);
                s.life -= 0.04;
            }
            _ctx.restore();
        }

        // Real-world weather (rain/snow/thunder/mist) — masked by the shelter.
        try {
            const sEntry = Shelter.getEntryPoint();
            const shelterRect = { x: sEntry.x - 70, y: sEntry.y - 90, w: 130, h: 110 };
            WeatherOverlay.draw(_ctx, w, h, _tick, shelterRect);
        } catch (e) { /* ignore */ }

        // Evolution animation — radial starburst + soft flash + centered title
        if (Evolution.isEvolving()) {
            // Track progress (0..1 over ~3 seconds @ 60fps)
            Evolution._animTick = (Evolution._animTick || 0) + 1;
            const prog = Math.min(1, Evolution._animTick / 180);
            const flashIntensity = Math.sin(prog * Math.PI);   // 0→1→0

            // Soft gold wash
            const wash = _ctx.createRadialGradient(cx, h / 2, 10, cx, h / 2, Math.max(w, h));
            wash.addColorStop(0, `rgba(255,230,120,${0.55 * flashIntensity})`);
            wash.addColorStop(0.4, `rgba(212,165,52,${0.35 * flashIntensity})`);
            wash.addColorStop(1, `rgba(10,25,41,0)`);
            _ctx.fillStyle = wash;
            _ctx.fillRect(0, 0, w, h);

            // Rotating radial rays from pet centre
            _ctx.save();
            _ctx.globalAlpha = 0.6 * flashIntensity;
            _ctx.strokeStyle = '#FFE899';
            _ctx.lineWidth = 2;
            const rays = 16;
            const raysR = 40 + prog * 300;
            for (let i = 0; i < rays; i++) {
                const ang = (Math.PI * 2 * i / rays) + _tick * 0.02;
                _ctx.beginPath();
                _ctx.moveTo(cx + Math.cos(ang) * 20, h / 2 + Math.sin(ang) * 20);
                _ctx.lineTo(cx + Math.cos(ang) * raysR, h / 2 + Math.sin(ang) * raysR);
                _ctx.stroke();
            }
            _ctx.restore();

            // Sparkle shower (random points with glow)
            for (let i = 0; i < 8; i++) {
                const a = Math.random() * Math.PI * 2;
                const r = 40 + Math.random() * raysR;
                const sx = cx + Math.cos(a) * r;
                const sy = h / 2 + Math.sin(a) * r;
                _ctx.save();
                _ctx.globalAlpha = 0.8 * flashIntensity;
                _ctx.fillStyle = '#FFFFFF';
                _ctx.shadowColor = '#FFE899';
                _ctx.shadowBlur = 10;
                _ctx.beginPath();
                _ctx.arc(sx, sy, 1.6 + Math.random() * 1.8, 0, Math.PI * 2);
                _ctx.fill();
                _ctx.restore();
            }

            // Transition title — fade in, hold, fade out
            const titleAlpha = prog < 0.15 ? prog / 0.15
                             : prog > 0.85 ? (1 - prog) / 0.15 : 1;
            _ctx.save();
            _ctx.globalAlpha = titleAlpha;
            _ctx.fillStyle = '#FFE899';
            _ctx.shadowColor = '#D4A534';
            _ctx.shadowBlur = 14;
            _ctx.font = 'bold 24px sans-serif';
            _ctx.textAlign = 'center';
            _ctx.fillText(pet.getStageNameFor(Evolution.getToStage()), cx, h / 2 - 100);
            _ctx.font = '13px monospace';
            _ctx.shadowBlur = 4;
            _ctx.fillStyle = 'rgba(234,251,251,0.9)';
            _ctx.fillText(
                `${pet.getStageNameFor(Evolution.getFromStage())}  →  ${pet.getStageNameFor(Evolution.getToStage())}`,
                cx, h / 2 - 72
            );
            _ctx.restore();

            if (Evolution._animTick > 180) {
                Evolution._animTick = 0;
                Evolution.clearState();
            }
        } else if (Evolution._animTick) {
            Evolution._animTick = 0;
        }
    }
};
