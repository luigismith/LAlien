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

// Shelter geometry (relative to canvas). Anchored near the right edge so the
// pet can roam most of the ground and walk "in" by heading to the right.
function geom() {
    const w = _stageW, h = _stageH;
    const groundY = h * 0.82;
    const entranceX = w * 0.89;
    const entranceY = groundY - 6;
    const caveW = Math.min(160, w * 0.22);
    const caveH = Math.min(120, h * 0.35);
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

    /** Pixel-art draw of the cave. Called before the pet so pet can appear inside. */
    draw(ctx, tick, pet) {
        const g = geom();
        const petHue = (pet && pet.dna) ? pet.dna.coreHue : 200;

        ctx.save();

        // ---- Rock backdrop (mountain silhouette) ----
        const rockGrad = ctx.createLinearGradient(g.leftX, g.topY, g.leftX, g.groundY);
        rockGrad.addColorStop(0, '#1F2633');
        rockGrad.addColorStop(0.6, '#141A26');
        rockGrad.addColorStop(1, '#0A1018');
        ctx.fillStyle = rockGrad;
        ctx.beginPath();
        // Jagged mountain outline (pixelated look via coarse steps)
        const steps = 10;
        const left = g.leftX;
        const right = g.leftX + g.caveW;
        ctx.moveTo(left, g.groundY + 4);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = left + t * g.caveW;
            const baseY = g.topY + Math.sin(t * Math.PI) * -6;  // arc top
            const jag = ((i * 131) % 9 - 4);
            ctx.lineTo(x, baseY + jag);
        }
        ctx.lineTo(right, g.groundY + 4);
        ctx.closePath();
        ctx.fill();

        // Outline / rim
        ctx.strokeStyle = `hsla(${petHue},30%,40%,0.35)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Pixel-art texture specks on the rock
        for (let i = 0; i < 28; i++) {
            const sx = left + ((i * 47) % g.caveW);
            const sy = g.topY + ((i * 91) % (g.groundY - g.topY - 4));
            const shade = (i % 3 === 0) ? '#2A3346' : '#0F1420';
            ctx.fillStyle = shade;
            ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, 2);
        }

        // ---- Cave mouth (dark arch) ----
        const mouthW = g.caveW * 0.50;
        const mouthH = g.caveH * 0.65;
        const mouthX = g.entranceX - mouthW * 0.55;
        const mouthTop = g.entranceY - mouthH;

        // Inner darkness gradient
        const mouthGrad = ctx.createRadialGradient(
            g.entranceX - 4, g.entranceY - mouthH * 0.4, 4,
            g.entranceX - 4, g.entranceY - mouthH * 0.3, mouthW * 0.9
        );
        mouthGrad.addColorStop(0, '#000000');
        mouthGrad.addColorStop(0.6, '#05080F');
        mouthGrad.addColorStop(1, '#0F1624');
        ctx.fillStyle = mouthGrad;
        ctx.beginPath();
        // Arched opening: flat bottom, rounded top
        ctx.moveTo(mouthX, g.entranceY + 2);
        ctx.lineTo(mouthX, mouthTop + 16);
        ctx.quadraticCurveTo(mouthX, mouthTop, mouthX + 14, mouthTop);
        ctx.lineTo(mouthX + mouthW - 14, mouthTop);
        ctx.quadraticCurveTo(mouthX + mouthW, mouthTop, mouthX + mouthW, mouthTop + 16);
        ctx.lineTo(mouthX + mouthW, g.entranceY + 2);
        ctx.closePath();
        ctx.fill();

        // ---- Glowing runes inside (breathing) ----
        const pulse = 0.45 + Math.sin(tick * 0.04) * 0.25;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = `hsl(${petHue},80%,65%)`;
        ctx.shadowColor = `hsl(${petHue},90%,70%)`;
        ctx.shadowBlur = 8;
        // Three rune pixels in an arc
        const runeY = g.entranceY - mouthH * 0.55;
        ctx.fillRect(Math.floor(g.entranceX - 18), Math.floor(runeY),      2, 2);
        ctx.fillRect(Math.floor(g.entranceX - 2),  Math.floor(runeY - 6),  2, 2);
        ctx.fillRect(Math.floor(g.entranceX + 14), Math.floor(runeY),      2, 2);
        ctx.restore();

        // Tiny straw/nest at the bottom of the cave (hint of domesticity)
        ctx.fillStyle = '#3A2C18';
        for (let i = 0; i < 8; i++) {
            const nx = mouthX + 14 + i * 6 + ((i * 17) % 4);
            ctx.fillRect(Math.floor(nx), Math.floor(g.entranceY - 2), 3, 2);
        }
        ctx.fillStyle = '#5A4420';
        for (let i = 0; i < 4; i++) {
            const nx = mouthX + 20 + i * 10;
            ctx.fillRect(Math.floor(nx), Math.floor(g.entranceY - 4), 2, 1);
        }

        // Ground shadow at the entrance
        const shadG = ctx.createRadialGradient(g.entranceX, g.entranceY + 2, 2, g.entranceX, g.entranceY + 2, mouthW * 0.6);
        shadG.addColorStop(0, 'rgba(0,0,0,0.5)');
        shadG.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = shadG;
        ctx.fillRect(g.entranceX - mouthW * 0.7, g.entranceY - 2, mouthW * 1.4, 14);

        ctx.restore();
    },
};
