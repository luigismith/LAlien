/**
 * shelter.js -- Pixel-art cave on the right side of the canvas.
 *
 * The cave is a safe spot: when the pet is AFRAID, it's raining/snowing, or
 * the pet wants to sleep, it autonomously walks toward the entrance. Inside,
 * SECURITY regenerates faster and rain/snow particles are blocked from
 * hitting the pet. The keeper can leave an item near the entrance to decorate
 * it (handled by the Items module drawing — we don't need extra code for that).
 */
import { NeedType } from '../pet/needs.js';

let _stageW = 800, _stageH = 480;

// Animation & interaction state
let _tapFlash = null;             // { region, ticks } for pulse after tap
let _doorKnockTicks = 0;          // door shakes when knocked
let _windowTapTicks = 0;          // window flashes brighter when tapped
let _bodySparkleTicks = 0;        // sparkle over the whole cottage
// Ambient critters on/around the cottage
let _bird = null;                 // { phase: 'arriving'|'perched'|'leaving', t, x, y }
let _nextBirdAt = 900;            // first bird after ~15s

// Shelter geometry (relative to canvas). Anchored near the right edge so the
// pet can roam most of the ground and walk "in" by heading to the right.
function geom() {
    const w = _stageW, h = _stageH;
    const groundY = h * 0.82;
    const entranceX = w * 0.89;
    const entranceY = groundY - 6;
    const caveW = Math.min(300, w * 0.40);
    const caveH = Math.min(230, h * 0.60);
    return {
        w, h, groundY, entranceX, entranceY, caveW, caveH,
        leftX: entranceX - caveW * 0.55,
        topY:  entranceY - caveH * 0.95,
    };
}

export const Shelter = {
    setStage(w, h) { _stageW = w; _stageH = h; },

    getEntryPoint() {
        const g = geom();
        return { x: g.entranceX, y: g.entranceY };
    },

    getInteriorPoint() {
        const g = geom();
        // "Deep inside" position — pet centers here when tucked in
        return { x: g.entranceX + 6, y: g.entranceY - 6 };
    },

    /** Is the pet world-position currently inside the shelter footprint? */
    contains(worldX, worldY) {
        const g = geom();
        return (worldX > g.leftX + 14
             && worldX < g.leftX + g.caveW - 4
             && worldY > g.topY + 14
             && worldY < g.groundY + 6);
    },

    /** Returns true if pet's current world position is inside shelter */
    isPetInside(pet, petWorldX, petWorldY) {
        if (!pet || !pet.isAlive || !pet.isAlive() || pet.isEgg()) return false;
        return this.contains(petWorldX, petWorldY);
    },

    /** Hit-test a point on the canvas against the cottage regions.
     *  Returns 'door' | 'window' | 'body' | null.
     */
    hitTest(x, y) {
        const g = geom();
        // Bounding box of the walls (matches the render math).
        const PX = 3;
        const wallBp = 36, wallBpH = 22, roofBpH = 12;
        const doorBpW = 9, doorBpH = 14;
        const snap = (v) => Math.round(v / PX) * PX;
        const baseX = snap(g.entranceX - (wallBp * PX) / 2);
        const baseY = snap(g.groundY) - wallBpH * PX;
        const wLeft = baseX, wTop = baseY - roofBpH * PX;
        const wRight = baseX + wallBp * PX, wBot = baseY + wallBpH * PX;
        if (x < wLeft - 12 || x > wRight + 12 || y < wTop - 6 || y > wBot + 4) return null;
        // Door area
        const doorBpX = Math.floor((wallBp - doorBpW) / 2) - 2;
        const doorBpY = wallBpH - doorBpH;
        const dX = baseX + doorBpX * PX;
        const dY = baseY + doorBpY * PX;
        const dW = doorBpW * PX;
        const dH = doorBpH * PX;
        if (x >= dX && x <= dX + dW && y >= dY && y <= dY + dH) return 'door';
        // Window region
        const winBpX = wallBp - 8;
        const winBpY = 5;
        const winBp = 5;
        const wX = baseX + winBpX * PX, wY = baseY + winBpY * PX;
        const wW = winBp * PX, wH = winBp * PX;
        if (x >= wX && x <= wX + wW && y >= wY && y <= wY + wH) return 'window';
        return 'body';
    },

    /** Fire a tap interaction with a sparkle effect. Called by Interactions. */
    onTap(region) {
        _tapFlash = { region, ticks: 18 };
        if (region === 'door')   _doorKnockTicks = 25;
        if (region === 'window') _windowTapTicks = 40;
        if (region === 'body')   _bodySparkleTicks = 30;
    },

    /** Per-logic-tick: boost SECURITY while inside, return true if sheltered */
    tick(pet, petWorldX, petWorldY, timeMult = 1) {
        if (!this.isPetInside(pet, petWorldX, petWorldY)) {
            pet._inShelter = false;
            return false;
        }
        pet._inShelter = true;
        // Extra SECURITY regen (on top of base recovery)
        const s = pet.needs[NeedType.SECURITY];
        if (s < 100) {
            pet.needs[NeedType.SECURITY] = Math.min(100, s + 0.04 * timeMult);
        }
        // Miska doesn't decay in shelter (sheltered from the dust outside)
        return true;
    },

    /**
     * Pixel-art cottage drawn with a single "big pixel" size matching the
     * background's PIXEL_SCALE. Everything is integer-aligned rectangles —
     * no curves, no gradients — so the shelter reads as the same chunky
     * art as the sky, terrain, and pet sprite.
     */
    draw(ctx, tick, pet) {
        const g = geom();
        const petHue = (pet && pet.dna) ? pet.dna.coreHue : 200;

        // PX = one "big pixel" on screen. Matches PIXEL_SCALE used by the
        // renderer's background buffer so cottage, terrain and sky all share
        // the same pixel grid.
        const PX = 3;
        const snap = (v) => Math.round(v / PX) * PX;

        // Unified palette — 6 colours total for the whole cottage so nothing
        // clashes. Wood/timber tones pair with stone; roof stays in its own
        // warm terracotta ramp; only the window glow breaks into yellow.
        const PAL = {
            stone:       '#B5A886',
            stoneDark:   '#8E8166',
            timber:      '#3C2616',
            timberHi:    '#5A3A22',
            roof:        '#7A3628',
            roofHi:      '#9E4634',
            roofShadow:  '#52231A',
            glow:        '#FFD06A',
            glowDim:     '#C89650',
            smoke:       '#D6CEC0',
            runeHue:     petHue,
        };

        // Cottage measured in BIG-PIXELS (bp). 1 bp = PX screen pixels.
        // Scaled up another ~40% on v3 so it reads as full architecture.
        const wallBp  = 36;
        const wallBpH = 22;
        const roofBpH = 12;
        const doorBpW = 9;
        const doorBpH = 14;
        const winBp   = 5;

        // Base coordinates (screen pixels), snapped to PX grid.
        const baseX = snap(g.entranceX - (wallBp * PX) / 2);
        const baseY = snap(g.groundY) - wallBpH * PX;   // top-left of walls

        // Helper: paint a rectangle of NxM big pixels from (bx,by) big-coords
        const bp = (bx, by, bw, bh, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(baseX + bx * PX, baseY + by * PX, bw * PX, bh * PX);
        };
        const pxAt = (x, y, w, h, color) => {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, w, h);
        };

        ctx.save();

        // ---- Walls: stone ashlar with horizontal timber beam at mid-height ----
        for (let r = 0; r < wallBpH; r++) {
            for (let c = 0; c < wallBp; c++) {
                // Offset courses for a brick-like pattern.
                const shift = (r % 2) ? 1 : 0;
                const parity = ((c + shift) >> 0) & 1;
                bp(c, r, 1, 1, parity ? PAL.stone : PAL.stoneDark);
            }
        }
        // Horizontal timber at 40% height (binds composition horizontally)
        const beamRow = Math.floor(wallBpH * 0.4);
        bp(0, beamRow, wallBp, 1, PAL.timber);
        pxAt(baseX, baseY + beamRow * PX, wallBp * PX, 1, PAL.timberHi);
        // Vertical corner timbers (frame the walls)
        bp(0,          0, 1, wallBpH, PAL.timber);
        bp(wallBp - 1, 0, 1, wallBpH, PAL.timber);
        // Single pixel highlight on the left corner timber
        pxAt(baseX, baseY, 1, wallBpH * PX, PAL.timberHi);

        // ---- Roof: symmetric stair-stepped pitched roof ----
        // Each row narrower by 2bp. Eaves extend 1bp past the wall.
        for (let r = 0; r < roofBpH; r++) {
            const rowBpW = (wallBp + 2) - r * 2;
            if (rowBpW <= 0) break;
            const rowBpX = Math.floor((wallBp - rowBpW) / 2);
            // Alternate rows for tile pattern within a single hue ramp
            const color = (r === 0) ? PAL.roofShadow
                         : (r === roofBpH - 1) ? PAL.roofHi
                         : (r % 2 ? PAL.roof : PAL.roofHi);
            bp(rowBpX, -(r + 1), rowBpW, 1, color);
        }
        // Under-eave shadow line (1 screen pixel, not a whole big-pixel row)
        pxAt(baseX - PX, baseY - 1, (wallBp + 2) * PX, 1, PAL.roofShadow);

        // ---- Chimney (2bp wide, single colour family) ----
        const chimBpX = wallBp - 4;
        const chimTop = -(roofBpH - 2);
        const chimBpH = roofBpH - 1;
        bp(chimBpX,     chimTop, 2, chimBpH,  PAL.roof);
        bp(chimBpX,     chimTop, 2, 1,        PAL.roofShadow);
        bp(chimBpX + 1, chimTop + 1, 1, 1,    PAL.roofHi);
        // Smoke puffs (square big-pixels rising and fading)
        for (let i = 0; i < 3; i++) {
            const phase = (tick * 0.4 + i * 48) % 140;
            const life = 1 - phase / 140;
            if (life <= 0) continue;
            const drift = Math.round(Math.sin(phase * 0.08) * PX);
            const puffX = baseX + (chimBpX + 1) * PX - PX + drift;
            const puffY = baseY + (chimTop - 1) * PX - phase * 0.5;
            ctx.globalAlpha = life * 0.65;
            const size = PX + Math.floor(phase / 55) * PX;
            pxAt(Math.round(puffX), Math.round(puffY), size, PX, PAL.smoke);
        }
        ctx.globalAlpha = 1;

        // ---- Window (3x3bp, warm glow, timber frame) ----
        const glowPulse = 0.72 + Math.sin(tick * 0.05) * 0.15;
        const winBpX = wallBp - 6;
        const winBpY = Math.max(1, beamRow - winBp - 1);
        // Frame
        bp(winBpX - 1, winBpY - 1, winBp + 2, winBp + 2, PAL.timber);
        // Glass
        const glass = (glowPulse > 0.75) ? PAL.glow : PAL.glowDim;
        bp(winBpX, winBpY, winBp, winBp, glass);
        // Simple cross (1 big pixel wide bars — no subpixel trickery)
        const cross = Math.floor(winBp / 2);
        bp(winBpX + cross, winBpY, 1, winBp, PAL.timber);
        bp(winBpX, winBpY + cross, winBp, 1, PAL.timber);
        // Highlight (single big pixel) + shadow pane
        bp(winBpX, winBpY, 1, 1, '#FFFBDC');
        bp(winBpX + winBp - 1, winBpY + winBp - 1, 1, 1, PAL.glowDim);

        // ---- Door (5x8bp), timber frame + stepped arch at the top ----
        const doorBpX = Math.floor((wallBp - doorBpW) / 2) - 2;  // left of centre
        const doorBpY = wallBpH - doorBpH;
        // Timber frame (one big-pixel thick all around)
        bp(doorBpX - 1, doorBpY - 1, doorBpW + 2, 1, PAL.timber);
        bp(doorBpX - 1, doorBpY,     1, doorBpH,   PAL.timber);
        bp(doorBpX + doorBpW, doorBpY, 1, doorBpH, PAL.timber);
        // Stepped arch top (knock off the corners to suggest an arch)
        bp(doorBpX,             doorBpY, 1, 1, PAL.timber);
        bp(doorBpX + doorBpW - 1, doorBpY, 1, 1, PAL.timber);
        // Door panel (solid wood tone + mid-shade for depth)
        bp(doorBpX + 1, doorBpY + 1, doorBpW - 2, doorBpH - 1, PAL.timberHi);
        bp(doorBpX,     doorBpY + 1, 1, doorBpH - 1, PAL.timber);
        bp(doorBpX + doorBpW - 1, doorBpY + 1, 1, doorBpH - 1, PAL.timber);
        // Plank seams (2 vertical lines through the door)
        pxAt(baseX + (doorBpX + 2) * PX, baseY + (doorBpY + 1) * PX, 1, (doorBpH - 1) * PX, PAL.timber);
        pxAt(baseX + (doorBpX + 3) * PX, baseY + (doorBpY + 1) * PX, 1, (doorBpH - 1) * PX, PAL.timber);
        // Handle — 1bp, warm brass tone picked from the window glow family
        bp(doorBpX + doorBpW - 2, doorBpY + Math.floor(doorBpH / 2) + 1, 1, 1, PAL.glow);
        // Pet inside → a sliver of warm light from the door crack
        if (pet && pet._inShelter) {
            bp(doorBpX + 2, doorBpY + 2, 1, doorBpH - 3, PAL.glow);
        }

        // ---- Foundation: one row of darker stone matching the wall palette ----
        bp(-1, wallBpH, wallBp + 2, 1, PAL.timber);

        // ---- Rune above the door (ties the cottage to the pet) ----
        const runePulse = 0.55 + Math.sin(tick * 0.06) * 0.35;
        ctx.globalAlpha = runePulse;
        bp(doorBpX + Math.floor(doorBpW / 2), doorBpY - 2, 1, 1, `hsl(${PAL.runeHue},70%,70%)`);
        ctx.globalAlpha = 1;

        // ---- Ground shadow ----
        ctx.globalAlpha = 0.4;
        pxAt(baseX - PX, baseY + (wallBpH + 1) * PX, (wallBp + 2) * PX, PX, '#000000');
        ctx.globalAlpha = 1;

        // ---- Warm light spill onto the ground under the window ----
        const spillX = baseX + (winBpX + cross) * PX;
        for (let i = 0; i < 3; i++) {
            ctx.globalAlpha = glowPulse * (0.2 - i * 0.05);
            pxAt(spillX - (i + 2) * PX, baseY + (wallBpH + 2 + i) * PX, (i + 2) * 2 * PX, PX, PAL.glow);
        }
        ctx.globalAlpha = 1;

        // ===================================================================
        // ANIMATED OVERLAYS (drawn on top of the static cottage)
        // ===================================================================

        // ---- Weathervane: a 4-arm silhouette on the roof ridge that spins
        // with a slow natural rhythm (real wind would be nicer but noisy).
        const vaneCx = baseX + Math.floor(wallBp * PX / 2);
        const vaneCy = baseY - roofBpH * PX - 10;
        const spinAngle = tick * 0.015;
        // Post
        pxAt(vaneCx - 1, vaneCy - 2, 2, 10, PAL.timber);
        // Rotating pointer (drawn as 4 arms)
        for (let i = 0; i < 4; i++) {
            const a = spinAngle + (i * Math.PI / 2);
            const len = (i % 2 === 0) ? 6 : 3;
            const tx = Math.round(vaneCx + Math.cos(a) * len);
            const ty = Math.round(vaneCy - 4 + Math.sin(a) * len * 0.6);
            pxAt(tx, ty, 2, 2, i === 0 ? PAL.glow : PAL.roof);
        }
        // Center dot
        pxAt(vaneCx - 1, vaneCy - 5, 2, 2, PAL.timberHi);

        // ---- Door opens when the pet is inside (animated 3-frame crack)
        if (pet && pet._inShelter) {
            const openPx = 4 + Math.sin(tick * 0.03) * 1.5;
            // Re-paint the right half of the door slightly opened — draw a warm
            // glow strip beneath where the door opens inward.
            const doorWpx = doorBpW * PX;
            const doorHpx = doorBpH * PX;
            const doorLeftX = baseX + doorBpX * PX;
            const doorY = baseY + doorBpY * PX;
            // Warm interior glow leaking out
            ctx.save();
            ctx.globalAlpha = 0.85;
            const g = ctx.createLinearGradient(doorLeftX + doorWpx - openPx, 0, doorLeftX + doorWpx, 0);
            g.addColorStop(0, 'rgba(255, 210, 120, 0.0)');
            g.addColorStop(1, 'rgba(255, 230, 150, 0.9)');
            ctx.fillStyle = g;
            ctx.fillRect(doorLeftX + doorWpx - openPx - 2, doorY + 4, openPx + 2, doorHpx - 6);
            ctx.restore();
        }

        // ---- Door knock: quick shake when the keeper tapped the door
        if (_doorKnockTicks > 0) {
            const amp = _doorKnockTicks / 25;
            const shake = Math.sin(_doorKnockTicks * 1.8) * amp * 2;
            const doorLeftX = baseX + doorBpX * PX + shake;
            const doorY = baseY + doorBpY * PX;
            ctx.save();
            ctx.strokeStyle = `rgba(255,240,200,${amp * 0.8})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(doorLeftX - 1, doorY - 1, doorBpW * PX + 2, doorBpH * PX + 2);
            ctx.restore();
            _doorKnockTicks--;
        }

        // ---- Window tap: flash brighter
        if (_windowTapTicks > 0) {
            const winLeftX = baseX + winBpX * PX;
            const winTopY  = baseY + winBpY * PX;
            const wPx = winBp * PX, hPx = winBp * PX;
            ctx.save();
            ctx.globalAlpha = (_windowTapTicks / 40) * 0.85;
            ctx.fillStyle = '#FFF1C0';
            ctx.fillRect(winLeftX, winTopY, wPx, hPx);
            ctx.restore();
            _windowTapTicks--;
        }

        // ---- Body sparkle: small sparks pop around the walls
        if (_bodySparkleTicks > 0) {
            ctx.save();
            for (let i = 0; i < 6; i++) {
                const ph = (tick * 0.3 + i * 13) % 30;
                const life = Math.max(0, 1 - ph / 30);
                const sx = baseX + Math.floor(((i * 97) % (wallBp * PX)));
                const sy = baseY + Math.floor(((i * 53) % (wallBpH * PX))) - 2;
                ctx.globalAlpha = life * (_bodySparkleTicks / 30);
                ctx.fillStyle = '#FFE899';
                ctx.fillRect(sx, sy, 2, 2);
            }
            ctx.restore();
            _bodySparkleTicks--;
        }

        // ---- Bird: occasionally arrives, perches on the roof, flies off
        if (!_bird && tick > _nextBirdAt) {
            _bird = { phase: 'arriving', t: 0, x: baseX - 40, y: baseY - roofBpH * PX - 14, dir: 1 };
            _nextBirdAt = tick + 1500 + Math.floor(Math.random() * 1800);
        }
        if (_bird) {
            _bird.t++;
            const perchX = baseX + Math.floor(wallBp * PX * 0.25);
            const perchY = baseY - roofBpH * PX + 6;
            if (_bird.phase === 'arriving') {
                // Glide toward perch
                _bird.x += (perchX - _bird.x) * 0.06;
                _bird.y += (perchY - _bird.y) * 0.06;
                if (Math.abs(_bird.x - perchX) < 1 && Math.abs(_bird.y - perchY) < 1) {
                    _bird.phase = 'perched';
                    _bird.t = 0;
                }
            } else if (_bird.phase === 'perched') {
                if (_bird.t > 360) {   // 6 seconds perched
                    _bird.phase = 'leaving';
                    _bird.t = 0;
                    _bird.dir = Math.random() > 0.5 ? 1 : -1;
                }
            } else {
                // leaving
                _bird.x += _bird.dir * 2;
                _bird.y -= 1.2;
                if (_bird.y < 0 || _bird.x < -20 || _bird.x > _stageW + 20) _bird = null;
            }
            if (_bird) {
                const bx = Math.round(_bird.x), by = Math.round(_bird.y);
                ctx.save();
                // Body
                ctx.fillStyle = '#2A2030';
                ctx.fillRect(bx, by, 5, 3);
                // Head
                ctx.fillRect(bx + 4, by - 1, 2, 2);
                // Beak
                ctx.fillStyle = '#F5A642';
                ctx.fillRect(bx + 6, by, 1, 1);
                // Wings flap when flying
                if (_bird.phase !== 'perched') {
                    const flap = Math.sin(_bird.t * 0.4) > 0 ? -1 : 1;
                    ctx.fillStyle = '#1A1020';
                    ctx.fillRect(bx + 1, by + flap, 3, 1);
                }
                // Eye sparkle
                ctx.fillStyle = '#FFE899';
                ctx.fillRect(bx + 5, by - 1, 1, 1);
                ctx.restore();
            }
        }

        ctx.restore();
    },
};
