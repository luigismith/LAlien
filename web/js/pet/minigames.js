/**
 * minigames.js -- Mini-game system
 * Port of firmware/src/pet/minigames.cpp
 * Three bonding rituals with canvas rendering
 */
import { SoundEngine } from '../audio/sound-engine.js';

const ECHO_NODE_COUNT = 6;
const ECHO_MAX_SEQ = 16;
const ECHO_FLASH_TICKS = 12;
const ECHO_GAP_TICKS = 6;
const ECHO_PAUSE_TICKS = 20;
const ECHO_CX = 400;
const ECHO_CY = 200;
const ECHO_RADIUS = 130;
const ECHO_NODE_HIT_R = 38;

const CLEAN_MAX_DUST = 40;
const CLEAN_PET_X = 400 - 160;
const CLEAN_PET_Y = 200 - 160;
const CLEAN_PET_W = 320;
const CLEAN_PET_H = 320;
const CLEAN_HIT_R = 25;

const STAR_MAX_STARS = 8;
const STAR_MAX_CONSTELLATIONS = 5;
const STAR_HIT_R = 30;

const GameType = { ECHO_MEMORY: 0, LIGHT_CLEANSING: 1, STAR_JOY: 2 };

// ---- Echo Memory State ----
let echo = {
    sequence: [], seqLen: 0, playerPos: 0,
    playback: true, pbIndex: 0, pbTimer: 0,
    flashOn: false, litNode: -1, failed: false,
    success: false, score: 0, successTimer: 0,
    nodeX: [], nodeY: []
};

function echoComputeNodes() {
    echo.nodeX = []; echo.nodeY = [];
    for (let i = 0; i < ECHO_NODE_COUNT; i++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / ECHO_NODE_COUNT;
        echo.nodeX.push(ECHO_CX + Math.round(ECHO_RADIUS * Math.cos(angle)));
        echo.nodeY.push(ECHO_CY + Math.round(ECHO_RADIUS * Math.sin(angle)));
    }
}

function echoAddRandom() {
    if (echo.seqLen < ECHO_MAX_SEQ) {
        echo.sequence.push(Math.floor(Math.random() * ECHO_NODE_COUNT));
        echo.seqLen++;
    }
}

function echoStartPlayback() {
    echo.playback = true; echo.pbIndex = 0; echo.pbTimer = 0;
    echo.flashOn = false; echo.litNode = -1; echo.playerPos = 0;
}

function echoInit() {
    echoComputeNodes();
    echo.sequence = []; echo.seqLen = 0; echo.score = 0;
    echo.failed = false; echo.success = false; echo.successTimer = 0;
    for (let i = 0; i < 3; i++) echoAddRandom();
    echoStartPlayback();
}

function echoUpdate() {
    if (echo.failed) return;
    if (echo.success) {
        echo.successTimer++;
        if (echo.successTimer > 30) {
            echo.success = false; echo.successTimer = 0;
            echoAddRandom(); echoStartPlayback();
        }
        return;
    }
    if (!echo.playback) return;

    echo.pbTimer++;
    const stepDur = ECHO_FLASH_TICKS + ECHO_GAP_TICKS;

    if (echo.pbIndex === 0 && echo.pbTimer < ECHO_PAUSE_TICKS) {
        echo.litNode = -1; return;
    }
    const adj = echo.pbTimer - (echo.pbIndex === 0 ? ECHO_PAUSE_TICKS : 0);

    if (echo.pbIndex >= echo.seqLen) {
        echo.playback = false; echo.litNode = -1; return;
    }

    const pos = adj % stepDur;
    if (pos === 0) {
        echo.litNode = echo.sequence[echo.pbIndex]; echo.flashOn = true;
        try { SoundEngine.playEchoNode(echo.sequence[echo.pbIndex], true); } catch (_) {}
    }
    else if (pos === ECHO_FLASH_TICKS) { echo.litNode = -1; echo.flashOn = false; }

    if (pos === stepDur - 1) {
        echo.pbIndex++;
        if (echo.pbIndex >= echo.seqLen) { echo.playback = false; echo.litNode = -1; }
    }
}

function echoHandleTouch(x, y) {
    if (echo.playback || echo.failed || echo.success) return;
    for (let i = 0; i < ECHO_NODE_COUNT; i++) {
        const dx = x - echo.nodeX[i], dy = y - echo.nodeY[i];
        if (dx * dx + dy * dy <= ECHO_NODE_HIT_R * ECHO_NODE_HIT_R) {
            echo.litNode = i;
            if (i === echo.sequence[echo.playerPos]) {
                try { SoundEngine.playEchoNode(i, false); } catch (_) {}
                echo.playerPos++;
                echo.score += echo.seqLen;
                if (echo.playerPos >= echo.seqLen) {
                    echo.success = true; echo.successTimer = 0;
                    try { SoundEngine.playEchoSuccess(); } catch (_) {}
                }
            } else {
                echo.failed = true;
                try { SoundEngine.playEchoFail(); } catch (_) {}
            }
            return;
        }
    }
}

// ---- Light Cleansing State ----
let clean = {
    dust: [], totalDust: 0, removedDust: 0,
    flinching: false, flinchTimer: 0, score: 0, complete: false,
    touchCount: 0, touchTimer: 0
};

function cleanInit() {
    clean.totalDust = 30; clean.removedDust = 0;
    clean.flinching = false; clean.flinchTimer = 0;
    clean.score = 0; clean.complete = false;
    clean.touchCount = 0; clean.touchTimer = 0;
    clean.dust = [];
    for (let i = 0; i < clean.totalDust; i++) {
        clean.dust.push({
            x: CLEAN_PET_X + 20 + Math.random() * (CLEAN_PET_W - 40),
            y: CLEAN_PET_Y + 20 + Math.random() * (CLEAN_PET_H - 40),
            hp: i < 8 ? 3 : (i < 18 ? 2 : 1),
            active: true
        });
    }
}

function cleanUpdate() {
    if (clean.complete) return;
    if (clean.touchTimer > 0) {
        clean.touchTimer--;
        if (clean.touchTimer === 0) clean.touchCount = 0;
    }
    if (clean.flinching) {
        clean.flinchTimer++;
        if (clean.flinchTimer > 20) { clean.flinching = false; clean.flinchTimer = 0; }
    }
    if (clean.removedDust >= clean.totalDust && !clean.complete) {
        clean.complete = true;
        try { SoundEngine.playCleanseComplete(); } catch (_) {}
    }
}

function cleanHandleTouch(x, y, dragging) {
    if (clean.complete) return;
    clean.touchCount++; clean.touchTimer = 15;
    if (clean.touchCount >= 8) {
        clean.flinching = true; clean.flinchTimer = 0; clean.touchCount = 0;
        try { SoundEngine.playCleanseFlinch(); } catch (_) {}
        return;
    }
    if (clean.flinching) return;
    const gentle = dragging;
    for (let i = 0; i < clean.dust.length; i++) {
        const d = clean.dust[i];
        if (!d.active) continue;
        const dx = x - d.x, dy = y - d.y;
        if (dx * dx + dy * dy <= CLEAN_HIT_R * CLEAN_HIT_R) {
            d.hp--;
            if (d.hp <= 0) {
                d.active = false; clean.removedDust++;
                clean.score += gentle ? 10 : 5;
                try { SoundEngine.playCleanseSparkle(); } catch (_) {}
            }
            return;
        }
    }
}

function cleanGetProgress() {
    return clean.totalDust === 0 ? 100 : Math.round((clean.removedDust * 100) / clean.totalDust);
}

// ---- Star Joy State ----
const CONSTELLATIONS = [
    { name: 'Voshi', starCount: 3, stars: [{x:300,y:80},{x:500,y:80},{x:400,y:240}], edgeCount: 3, edges: [{from:0,to:1},{from:1,to:2},{from:2,to:0}] },
    { name: 'Thishi', starCount: 4, stars: [{x:400,y:40},{x:550,y:180},{x:400,y:320},{x:250,y:180}], edgeCount: 4, edges: [{from:0,to:1},{from:1,to:2},{from:2,to:3},{from:3,to:0}] },
    { name: 'Revosh', starCount: 5, stars: [{x:150,y:100},{x:260,y:280},{x:370,y:110},{x:480,y:280},{x:590,y:100}], edgeCount: 4, edges: [{from:0,to:1},{from:1,to:2},{from:2,to:3},{from:3,to:4}] },
    { name: 'Kora', starCount: 6, stars: [{x:400,y:40},{x:540,y:120},{x:540,y:260},{x:400,y:340},{x:260,y:260},{x:260,y:120}], edgeCount: 6, edges: [{from:0,to:1},{from:1,to:2},{from:2,to:3},{from:3,to:4},{from:4,to:5},{from:5,to:0}] },
    { name: 'Lalien', starCount: 5, stars: [{x:400,y:30},{x:480,y:200},{x:620,y:140},{x:520,y:280},{x:280,y:280}], edgeCount: 5, edges: [{from:0,to:1},{from:1,to:2},{from:2,to:3},{from:3,to:4},{from:4,to:0}] },
];

let star = {
    constIdx: 0, totalConst: 3, edgeDone: [],
    completedEdges: 0, selected: -1, constComplete: false,
    sessionComplete: false, score: 0, completeTimer: 0
};

function starResetConst() {
    const c = CONSTELLATIONS[star.constIdx];
    star.edgeDone = new Array(c.edgeCount).fill(false);
    star.completedEdges = 0; star.selected = -1;
    star.constComplete = false; star.completeTimer = 0;
}

function starInit() {
    star.constIdx = 0;
    star.totalConst = 3 + Math.floor(Math.random() * 3);
    if (star.totalConst > STAR_MAX_CONSTELLATIONS) star.totalConst = STAR_MAX_CONSTELLATIONS;
    star.sessionComplete = false; star.score = 0;
    starResetConst();
}

function starUpdate() {
    if (star.sessionComplete) return;
    if (star.constComplete) {
        star.completeTimer++;
        if (star.completeTimer > 60) {
            star.constIdx++;
            if (star.constIdx >= star.totalConst) {
                star.sessionComplete = true;
                try { SoundEngine.playStarSessionComplete(); } catch (_) {}
            }
            else starResetConst();
        }
    }
}

function starHandleTouch(x, y) {
    if (star.constComplete || star.sessionComplete) return;
    const c = CONSTELLATIONS[star.constIdx];
    let tapped = -1;
    for (let i = 0; i < c.starCount; i++) {
        const dx = x - c.stars[i].x, dy = y - c.stars[i].y;
        if (dx * dx + dy * dy <= STAR_HIT_R * STAR_HIT_R) { tapped = i; break; }
    }
    if (tapped < 0) { star.selected = -1; return; }
    if (star.selected < 0) {
        star.selected = tapped;
        try { SoundEngine.playStarSelect(); } catch (_) {}
    }
    else if (tapped === star.selected) { star.selected = -1; }
    else {
        for (let e = 0; e < c.edgeCount; e++) {
            if (star.edgeDone[e]) continue;
            const match = (c.edges[e].from === star.selected && c.edges[e].to === tapped) ||
                          (c.edges[e].to === star.selected && c.edges[e].from === tapped);
            if (match) {
                star.edgeDone[e] = true; star.completedEdges++; star.score += 20;
                try { SoundEngine.playStarEdge(); } catch (_) {}
                if (star.completedEdges >= c.edgeCount) {
                    star.constComplete = true; star.completeTimer = 0; star.score += 50;
                    try { SoundEngine.playStarConstellation(); } catch (_) {}
                }
                break;
            }
        }
        star.selected = -1;
    }
}

// ---- Public API ----
let _playing = false;
let _currentGame = GameType.ECHO_MEMORY;
let _tick = 0;

export const MiniGames = {
    GameType,

    startGame(type) {
        _currentGame = type;
        _playing = true;
        _tick = 0;
        switch (type) {
            case GameType.ECHO_MEMORY: echoInit(); break;
            case GameType.LIGHT_CLEANSING: cleanInit(); break;
            case GameType.STAR_JOY: starInit(); break;
        }
    },

    endGame() {
        if (!_playing) return null;
        _playing = false;

        let result;
        switch (_currentGame) {
            case GameType.ECHO_MEMORY:
                result = {
                    score: echo.score,
                    nashiBonus: Math.min(15, echo.score * 0.5),
                    cognitionBonus: Math.min(12, echo.score * 0.4),
                    curiosityBonus: Math.min(5, echo.score * 0.15),
                    affectionBonus: 5,
                    miskaBonus: 0,
                    cosmicBonus: Math.min(3, echo.score * 0.05),
                    securityBonus: 2,
                    mokoCost: 5,
                    vocabUnlock: Math.min(3, Math.floor(echo.seqLen / 2)),
                    interactionCount: 3,
                    triggersDream: echo.seqLen >= 8,
                };
                break;
            case GameType.LIGHT_CLEANSING:
                result = {
                    score: clean.score,
                    nashiBonus: 10,
                    cognitionBonus: 2,
                    curiosityBonus: 0,
                    affectionBonus: Math.min(12, clean.score * 0.15),
                    miskaBonus: clean.complete ? 35 : cleanGetProgress() * 0.35,
                    cosmicBonus: 0,
                    securityBonus: Math.min(8, clean.score * 0.1),
                    mokoCost: 3,
                    vocabUnlock: clean.complete ? 2 : (cleanGetProgress() > 70 ? 1 : 0),
                    interactionCount: 5,
                    triggersDream: false,
                };
                break;
            case GameType.STAR_JOY:
                result = {
                    score: star.score,
                    nashiBonus: Math.min(8, star.score * 0.08),
                    cognitionBonus: Math.min(8, star.score * 0.08),
                    curiosityBonus: Math.min(15, star.score * 0.15),
                    affectionBonus: 5,
                    miskaBonus: 0,
                    cosmicBonus: Math.min(12, star.score * 0.12),
                    securityBonus: 0,
                    mokoCost: 4,
                    vocabUnlock: Math.min(3, star.constIdx),
                    interactionCount: 2,
                    triggersDream: star.sessionComplete,
                };
                break;
        }
        return result;
    },

    isPlaying() { return _playing; },
    getCurrentGame() { return _currentGame; },

    update() {
        if (!_playing) return;
        _tick++;
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: echoUpdate(); break;
            case GameType.LIGHT_CLEANSING: cleanUpdate(); break;
            case GameType.STAR_JOY: starUpdate(); break;
        }
    },

    handleTouch(x, y, dragging) {
        if (!_playing) return;
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: echoHandleTouch(x, y); break;
            case GameType.LIGHT_CLEANSING: cleanHandleTouch(x, y, dragging); break;
            case GameType.STAR_JOY: starHandleTouch(x, y); break;
        }
    },

    isGameOver() {
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: return echo.failed;
            case GameType.LIGHT_CLEANSING: return clean.complete;
            case GameType.STAR_JOY: return star.sessionComplete;
        }
        return false;
    },

    getScore() {
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: return echo.score;
            case GameType.LIGHT_CLEANSING: return clean.score;
            case GameType.STAR_JOY: return star.score;
        }
        return 0;
    },

    // Render the current minigame onto a canvas context
    renderUpdate() { /* called by game-loop, actual rendering is in render() */ },

    render(ctx, w, h) {
        if (!_playing) return;
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: renderEcho(ctx, w, h); break;
            case GameType.LIGHT_CLEANSING: renderClean(ctx, w, h); break;
            case GameType.STAR_JOY: renderStar(ctx, w, h); break;
        }
    },
};

// ---- Minigame Renderers ----

const NODE_COLORS = ['#E07030', '#40C4C4', '#E0C040', '#A060E0', '#60E060', '#E060A0'];

function renderEcho(ctx, w, h) {
    const sx = w / 800, sy = h / 400;
    ctx.clearRect(0, 0, w, h);

    // Title
    ctx.fillStyle = '#D4A534';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Thishi-Revosh  -  Livello ${echo.seqLen}`, w / 2, 20);

    if (echo.playback) {
        ctx.fillStyle = '#7A8A9A';
        ctx.font = '12px sans-serif';
        ctx.fillText('Osserva la sequenza...', w / 2, h - 20);
    } else if (!echo.failed && !echo.success) {
        ctx.fillStyle = '#3ECFCF';
        ctx.font = '12px sans-serif';
        ctx.fillText('Ripeti la sequenza!', w / 2, h - 20);
    }

    // Nodes
    for (let i = 0; i < ECHO_NODE_COUNT; i++) {
        const nx = echo.nodeX[i] * sx;
        const ny = echo.nodeY[i] * sy;
        const lit = echo.litNode === i;
        const r = (lit ? 32 : 24) * Math.min(sx, sy);

        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fillStyle = lit ? NODE_COLORS[i] : `${NODE_COLORS[i]}44`;
        ctx.fill();
        ctx.strokeStyle = NODE_COLORS[i];
        ctx.lineWidth = 2;
        ctx.stroke();

        if (lit) {
            ctx.beginPath();
            ctx.arc(nx, ny, r + 6, 0, Math.PI * 2);
            ctx.strokeStyle = `${NODE_COLORS[i]}66`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }

    if (echo.failed) {
        ctx.fillStyle = '#C04040';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('Sequenza interrotta!', w / 2, h / 2 + 60);
    }
    if (echo.success) {
        ctx.fillStyle = '#40C470';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText('Ko! Corretto!', w / 2, h / 2 + 60);
    }
}

function renderClean(ctx, w, h) {
    const sx = w / 800, sy = h / 400;
    ctx.clearRect(0, 0, w, h);

    // Pet area (silhouette)
    const px = CLEAN_PET_X * sx, py = CLEAN_PET_Y * sy;
    const pw = CLEAN_PET_W * sx, ph = CLEAN_PET_H * sy;

    ctx.strokeStyle = '#1A7A7A';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);

    // Progress bar
    const progress = cleanGetProgress();
    ctx.fillStyle = '#0F2233';
    ctx.fillRect(w * 0.1, 12, w * 0.8, 10);
    ctx.fillStyle = '#3ECFCF';
    ctx.fillRect(w * 0.1, 12, w * 0.8 * progress / 100, 10);

    ctx.fillStyle = '#D4A534';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Miska-Vythi  -  ${progress}%`, w / 2, 40);

    // Dust particles
    for (const d of clean.dust) {
        if (!d.active) continue;
        const dx = d.x * sx, dy = d.y * sy;
        const r = (6 + d.hp * 3) * Math.min(sx, sy);
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fillStyle = d.hp >= 3 ? '#8B6914' : (d.hp >= 2 ? '#A08030' : '#C0A050');
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    if (clean.flinching) {
        ctx.fillStyle = '#C04040';
        ctx.font = '16px sans-serif';
        ctx.fillText('Troppo forte! Piano...', w / 2, h / 2);
    }

    if (clean.complete) {
        ctx.fillStyle = '#40C470';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('Sevra pulita! Miska-thi!', w / 2, h / 2);
    }
}

function renderStar(ctx, w, h) {
    const sx = w / 800, sy = h / 400;
    ctx.clearRect(0, 0, w, h);

    // Background stars (decorative)
    ctx.fillStyle = '#ffffff11';
    for (let i = 0; i < 50; i++) {
        const bx = (i * 137.5) % w;
        const by = (i * 97.3) % h;
        ctx.fillRect(bx, by, 1, 1);
    }

    const c = CONSTELLATIONS[star.constIdx];

    ctx.fillStyle = '#D4A534';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Selath-Nashi  -  ${c.name}  (${star.constIdx + 1}/${star.totalConst})`, w / 2, 20);

    // Draw completed edges
    for (let e = 0; e < c.edgeCount; e++) {
        if (!star.edgeDone[e]) continue;
        const s1 = c.stars[c.edges[e].from];
        const s2 = c.stars[c.edges[e].to];
        ctx.beginPath();
        ctx.moveTo(s1.x * sx, s1.y * sy);
        ctx.lineTo(s2.x * sx, s2.y * sy);
        ctx.strokeStyle = '#3ECFCF';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Guide edges (faint)
    for (let e = 0; e < c.edgeCount; e++) {
        if (star.edgeDone[e]) continue;
        const s1 = c.stars[c.edges[e].from];
        const s2 = c.stars[c.edges[e].to];
        ctx.beginPath();
        ctx.moveTo(s1.x * sx, s1.y * sy);
        ctx.lineTo(s2.x * sx, s2.y * sy);
        ctx.strokeStyle = '#ffffff0A';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // Stars
    for (let i = 0; i < c.starCount; i++) {
        const sx2 = c.stars[i].x * sx, sy2 = c.stars[i].y * sy;
        const selected = star.selected === i;
        const r = selected ? 12 : 8;

        ctx.beginPath();
        ctx.arc(sx2, sy2, r, 0, Math.PI * 2);
        ctx.fillStyle = selected ? '#D4A534' : '#E0E0E0';
        ctx.fill();

        if (selected) {
            ctx.beginPath();
            ctx.arc(sx2, sy2, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#D4A53466';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    if (star.constComplete) {
        ctx.fillStyle = '#D4A534';
        ctx.font = 'bold 18px sans-serif';
        ctx.fillText(`${c.name} completata!`, w / 2, h - 30);
    }
    if (star.sessionComplete) {
        ctx.fillStyle = '#40C470';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('Selath-vi! Il cielo canta!', w / 2, h / 2 + 40);
    }
}
