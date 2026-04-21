/**
 * shelter.js -- Pixel-art alien bio-pod on the right side of the canvas.
 *
 * The pod is a safe spot: when the pet is AFRAID, it's raining/snowing, or
 * the pet wants to sleep, it autonomously walks toward the entrance. Inside,
 * SECURITY regenerates faster and rain/snow particles are blocked from
 * hitting the pet. Tappable regions: entrance (door-equivalent), crown
 * (window-equivalent), carapace (body).
 */
import { NeedType } from '../pet/needs.js';

let _stageW = 800, _stageH = 480;

// Animation & interaction state
let _tapFlash = null;
let _doorKnockTicks = 0;
let _windowTapTicks = 0;
let _bodySparkleTicks = 0;
let _nextMoteAt = 900;
let _motes = [];

// Pod geometry (relative to canvas). Anchored near the right edge.
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

// Big-pixel block of the pod. Keyed by (column, row) with 1 at the centre of
// the silhouette. Row 0 is the BOTTOM (ground line). Rows grow upward.
//
// The pod is a 15 wide × 14 tall oval/egg silhouette, asymmetric at the top
// (crest crown leans slightly forward), with a glowing portal near the
// bottom-centre. Generated procedurally so it stays integer-aligned.
function isInside(bx, by, bpW, bpH) {
    // Relative to centre
    const cx = (bpW - 1) / 2;
    const cy = (bpH - 1) * 0.62;   // visual centre leans low for pod feel
    const dx = (bx - cx) / (bpW * 0.48);
    const dy = (by - cy) / (bpH * 0.62);
    // Slight asymmetry: top-left gets a little "crown" bulge
    const bulge = (bx < cx && by > bpH * 0.75) ? -0.06 : 0;
    return (dx * dx + dy * dy) <= (1 + bulge);
}

function isCrown(bx, by, bpW, bpH) {
    // Top third + narrower than the full width — the dome of the pod.
    if (by < bpH * 0.62) return false;
    const cx = (bpW - 1) / 2;
    const dx = (bx - cx) / (bpW * 0.36);
    const dy = (by - bpH * 0.9) / (bpH * 0.30);
    return (dx * dx + dy * dy) <= 1;
}

export const Shelter = {
    setStage(w, h) { _stageW = w; _stageH = h; },

    getEntryPoint() {
        const g = geom();
        return { x: g.entranceX, y: g.entranceY };
    },

    getInteriorPoint() {
        const g = geom();
        return { x: g.entranceX + 6, y: g.entranceY - 6 };
    },

    contains(worldX, worldY) {
        const g = geom();
        return (worldX > g.leftX + 14
             && worldX < g.leftX + g.caveW - 4
             && worldY > g.topY + 14
             && worldY < g.groundY + 6);
    },

    isPetInside(pet, petWorldX, petWorldY) {
        if (!pet || !pet.isAlive || !pet.isAlive() || pet.isEgg()) return false;
        return this.contains(petWorldX, petWorldY);
    },

    tick(pet, petWorldX, petWorldY, timeMult = 1) {
        if (!this.isPetInside(pet, petWorldX, petWorldY)) {
            pet._inShelter = false;
            return false;
        }
        pet._inShelter = true;
        const s = pet.needs[NeedType.SECURITY];
        if (s < 100) {
            pet.needs[NeedType.SECURITY] = Math.min(100, s + 0.04 * timeMult);
        }
        return true;
    },

    hitTest(x, y) {
        const g = geom();
        const PX = 9;
        const bpW = 15, bpH = 14;
        const baseX = Math.round((g.entranceX - (bpW * PX) / 2) / PX) * PX;
        const baseY = Math.round(g.groundY / PX) * PX - bpH * PX;
        // Rect spanning the whole pod
        if (x < baseX - PX * 2 || x > baseX + (bpW + 2) * PX
            || y < baseY - PX || y > baseY + bpH * PX + PX) return null;
        // Work out which big-pixel we're on
        const bx = Math.floor((x - baseX) / PX);
        const by = Math.floor((bpH - 1) - (y - baseY) / PX);
        if (bx < 0 || bx >= bpW || by < 0 || by >= bpH) return null;
        if (!isInside(bx, by, bpW, bpH)) return null;
        // Door = portal near bottom-centre
        const doorCenterX = Math.floor(bpW / 2);
        const doorTopRow = 4;
        const doorBotRow = 0;
        if (bx >= doorCenterX - 1 && bx <= doorCenterX + 1
            && by >= doorBotRow && by <= doorTopRow) {
            return 'door';
        }
        // Window = the rune at the crown centre
        if (isCrown(bx, by, bpW, bpH) && Math.abs(bx - (bpW - 1) / 2) <= 1) {
            return 'window';
        }
        return 'body';
    },

    onTap(region) {
        _tapFlash = { region, ticks: 18 };
        if (region === 'door')   _doorKnockTicks = 25;
        if (region === 'window') _windowTapTicks = 40;
        if (region === 'body')   _bodySparkleTicks = 30;
    },

    /**
     * Pixel-art alien bio-pod — a bioluminescent seed-dwelling that the
     * syrma grew into for shelter. Stair-stepped oval silhouette in the
     * same big-pixel grid as the background (PX = 9 screen pixels per
     * big-pixel, matching the PIXEL_SCALE of the renderer's bg buffer).
     */
    draw(ctx, tick, pet) {
        const g = geom();
        const petHue = (pet && pet.dna) ? pet.dna.coreHue : 200;

        // PX = one big pixel. 9 matches the background's chunky resolution.
        const PX = 9;
        const snap = (v) => Math.round(v / PX) * PX;

        // Bioluminescent palette — rhymes with cosmic sky, crystals and the
        // pet's own hue. No wood, no brick. Carapace + dome + life-glow.
        const PAL = {
            shell:      '#2D3A48',                                      // carapace mid
            shellDark:  '#1A2330',                                      // carapace deep
            shellHi:    '#4A5E78',                                      // carapace highlight
            crown:      `hsl(${(petHue + 15) % 360}, 42%, 32%)`,        // crystal dome base
            crownHi:    `hsl(${(petHue + 30) % 360}, 60%, 62%)`,        // dome highlight
            crownShad:  `hsl(${(petHue + 10) % 360}, 45%, 18%)`,        // dome shadow
            vein:       `hsl(${(petHue + 40) % 360}, 70%, 55%)`,        // light veins
            veinBright: `hsl(${(petHue + 40) % 360}, 85%, 75%)`,
            portal:     `hsl(${(petHue + 50) % 360}, 85%, 70%)`,        // inside-glow
            portalCore: '#FFFBE0',                                      // hottest point
            rune:       `hsl(${petHue}, 90%, 75%)`,
            mote:       '#B8C8E0',
        };

        // Pod dimensions in big pixels. 15×14 → 135×126 screen px, roughly
        // pet-sized, matching the same chunky grain as crystals and sky.
        const bpW = 15;
        const bpH = 14;
        const baseX = snap(g.entranceX - (bpW * PX) / 2);
        const baseY = snap(g.groundY) - bpH * PX;

        // Helper — paint a big-pixel at column bx, row by (row 0 = ground).
        const bp = (bx, byRow, w, h, color) => {
            const x = baseX + bx * PX;
            // Convert row-from-bottom (byRow) to row-from-top for drawing
            const y = baseY + ((bpH - 1) - byRow) * PX;
            ctx.fillStyle = color;
            ctx.fillRect(x, y - (h - 1) * PX, w * PX, h * PX);
        };
        const pxBlock = (bx, byRow, color) => {
            const x = baseX + bx * PX;
            const y = baseY + ((bpH - 1) - byRow) * PX;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, PX, PX);
        };

        ctx.save();

        // ---- Ground shadow under the pod (subtle, wider than pod) ----
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#000';
        ctx.fillRect(baseX - PX, baseY + bpH * PX, (bpW + 2) * PX, Math.floor(PX * 0.6));
        ctx.globalAlpha = 1;

        // ---- Main silhouette: oval carapace ----
        for (let by = 0; by < bpH; by++) {
            for (let bx = 0; bx < bpW; bx++) {
                if (!isInside(bx, by, bpW, bpH)) continue;
                // Shading by column: left side lighter (incoming light),
                // right side darker. Upper third is crown palette.
                const inCrown = isCrown(bx, by, bpW, bpH);
                const lightLean = (bx - bpW / 2) / (bpW / 2);   // -1..1
                let color;
                if (inCrown) {
                    color = lightLean < -0.2 ? PAL.crownHi
                          : lightLean >  0.4 ? PAL.crownShad
                          : PAL.crown;
                } else {
                    color = lightLean < -0.3 ? PAL.shellHi
                          : lightLean >  0.4 ? PAL.shellDark
                          : PAL.shell;
                }
                pxBlock(bx, by, color);
            }
        }

        // ---- Light veins — 3 vertical seams glowing with the pet's hue ----
        const veinPulse = 0.55 + Math.sin(tick * 0.04) * 0.35;
        const veinCols = [
            Math.floor(bpW * 0.28),
            Math.floor(bpW * 0.50),
            Math.floor(bpW * 0.72),
        ];
        ctx.globalAlpha = veinPulse;
        for (const vc of veinCols) {
            for (let by = 2; by < bpH - 2; by++) {
                if (!isInside(vc, by, bpW, bpH)) continue;
                pxBlock(vc, by, PAL.vein);
            }
            // Brighter cap near the top of the vein
            if (isInside(vc, bpH - 3, bpW, bpH)) pxBlock(vc, bpH - 3, PAL.veinBright);
        }
        ctx.globalAlpha = 1;

        // ---- Portal: arched doorway of light ----
        const doorCX = Math.floor(bpW / 2);
        const doorTopRow = 4;
        // Portal arch: 3 wide at base narrowing to 1 at top
        const arch = [
            { dx: -1, h: 3 }, { dx: 0, h: 4 }, { dx: 1, h: 3 },
        ];
        // First paint the dark portal interior
        for (const { dx, h } of arch) {
            for (let i = 0; i < h; i++) {
                pxBlock(doorCX + dx, i, PAL.shellDark);
            }
        }
        // Then the glowing portal halo (pulsing inner light)
        const portalPulse = 0.7 + Math.sin(tick * 0.06) * 0.25;
        ctx.globalAlpha = portalPulse;
        for (const { dx, h } of arch) {
            // Inner column: gradient dark→bright toward the centre
            for (let i = 0; i < h - 1; i++) {
                const intensity = 1 - Math.abs(dx) * 0.3 - i * 0.15;
                if (intensity <= 0) continue;
                ctx.fillStyle = intensity > 0.6 ? PAL.portal : PAL.vein;
                ctx.globalAlpha = portalPulse * intensity;
                const x = baseX + (doorCX + dx) * PX;
                const y = baseY + ((bpH - 1) - i) * PX;
                ctx.fillRect(x + PX * 0.25, y + PX * 0.15, PX * 0.5, PX * 0.7);
            }
        }
        // Hottest point at the mouth centre
        ctx.globalAlpha = portalPulse;
        ctx.fillStyle = PAL.portalCore;
        ctx.fillRect(baseX + doorCX * PX + PX * 0.35, baseY + (bpH - 2) * PX + PX * 0.3, PX * 0.3, PX * 0.3);
        ctx.globalAlpha = 1;

        // ---- Crown rune at the top centre — the pet's hue, pulsing ----
        const runePulse = 0.55 + Math.sin(tick * 0.05) * 0.4;
        ctx.globalAlpha = runePulse;
        const runeBx = Math.floor(bpW / 2);
        const runeBy = bpH - 2;
        pxBlock(runeBx, runeBy, PAL.rune);
        // Four tiny arms around the rune
        if (isInside(runeBx - 1, runeBy, bpW, bpH)) {
            ctx.fillStyle = PAL.vein;
            ctx.fillRect(baseX + (runeBx - 1) * PX + PX * 0.4, baseY + ((bpH - 1) - runeBy) * PX + PX * 0.4, PX * 0.3, PX * 0.2);
        }
        ctx.globalAlpha = 1;

        // ---- Small glowing "roots" on the ground around the base ----
        for (let i = 0; i < 4; i++) {
            const rootBx = 1 + i * 4;
            if (rootBx >= bpW) break;
            if (!isInside(rootBx, 0, bpW, bpH)) continue;
            ctx.fillStyle = PAL.vein;
            ctx.globalAlpha = 0.6;
            ctx.fillRect(baseX + rootBx * PX, baseY + bpH * PX - 1, PX, 1);
        }
        ctx.globalAlpha = 1;

        // ---- Light spill on the ground in front of the portal ----
        for (let i = 0; i < 4; i++) {
            ctx.globalAlpha = portalPulse * (0.28 - i * 0.06);
            ctx.fillStyle = PAL.portal;
            const spillCenter = baseX + doorCX * PX + PX / 2;
            const spillY = baseY + bpH * PX + i * PX;
            const spillWidth = (i + 2) * 2 * PX;
            ctx.fillRect(spillCenter - spillWidth / 2, spillY, spillWidth, PX);
        }
        ctx.globalAlpha = 1;

        // ---- Floating cosmic motes around the pod (ambient life) ----
        if (tick > _nextMoteAt && _motes.length < 6) {
            _motes.push({
                x: baseX + (Math.random() * bpW + 0.5) * PX,
                y: baseY + bpH * PX - PX,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -0.4 - Math.random() * 0.4,
                life: 1,
                hue: (petHue + 40 + Math.random() * 40) % 360,
            });
            _nextMoteAt = tick + 40 + Math.random() * 80;
        }
        for (const m of _motes) {
            m.x += m.vx; m.y += m.vy; m.life -= 0.008;
        }
        _motes = _motes.filter(m => m.life > 0);
        for (const m of _motes) {
            ctx.globalAlpha = m.life * 0.8;
            ctx.fillStyle = `hsl(${m.hue}, 80%, 78%)`;
            ctx.fillRect(Math.round(m.x), Math.round(m.y), 2, 2);
        }
        ctx.globalAlpha = 1;

        // ---- Door/portal tap feedback ----
        if (_doorKnockTicks > 0) {
            const amp = _doorKnockTicks / 25;
            ctx.save();
            ctx.strokeStyle = `rgba(255, 240, 160, ${amp * 0.9})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(
                baseX + (doorCX - 1) * PX - 2,
                baseY + (bpH - doorTopRow - 1) * PX - 2,
                3 * PX + 4,
                doorTopRow * PX + 4
            );
            ctx.restore();
            _doorKnockTicks--;
        }
        // Crown window-tap flash
        if (_windowTapTicks > 0) {
            const k = _windowTapTicks / 40;
            ctx.save();
            ctx.globalAlpha = k * 0.9;
            ctx.fillStyle = '#FFFBE0';
            const rx = baseX + Math.floor(bpW / 2) * PX - PX;
            const ry = baseY;
            ctx.fillRect(rx, ry, PX * 3, PX * 3);
            ctx.restore();
            _windowTapTicks--;
        }
        // Body sparkle
        if (_bodySparkleTicks > 0) {
            ctx.save();
            for (let i = 0; i < 6; i++) {
                const ph = (tick * 0.3 + i * 13) % 30;
                const life = Math.max(0, 1 - ph / 30);
                const sx = baseX + (1 + ((i * 3) % (bpW - 2))) * PX;
                const sy = baseY + (3 + (i % 8)) * PX;
                ctx.globalAlpha = life * (_bodySparkleTicks / 30);
                ctx.fillStyle = '#FFE899';
                ctx.fillRect(sx, sy, 3, 3);
            }
            ctx.restore();
            _bodySparkleTicks--;
        }

        ctx.restore();
    },
};
