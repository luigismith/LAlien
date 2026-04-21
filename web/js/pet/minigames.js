/**
 * minigames.js -- Mini-game system
 * Port of firmware/src/pet/minigames.cpp
 * Three bonding rituals with canvas rendering
 */
import { SoundEngine } from '../audio/sound-engine.js';

const ECHO_NODE_COUNT = 6;
const ECHO_MAX_SEQ = 16;
const ECHO_FLASH_TICKS = 22;       // ~370ms flash (was 200ms, too fast)
const ECHO_GAP_TICKS = 14;         // ~230ms gap between notes
const ECHO_PAUSE_TICKS = 45;       // ~750ms "get ready" silence before first flash
const ECHO_RETRY_DELAY = 90;       // ~1.5s before allowing a retry after fail
const ECHO_START_LEN = 2;          // start at 2 nodes (was 3 — brutal)
const ECHO_CX = 400;
const ECHO_CY = 200;
const ECHO_RADIUS = 130;
const ECHO_NODE_HIT_R = 46;        // larger touch target

const CLEAN_MAX_DUST = 40;
const CLEAN_PET_X = 400 - 160;
const CLEAN_PET_Y = 200 - 160;
const CLEAN_PET_W = 320;
const CLEAN_PET_H = 320;
const CLEAN_HIT_R = 25;

const STAR_MAX_STARS = 8;
const STAR_MAX_CONSTELLATIONS = 5;
const STAR_HIT_R = 30;

const GameType = {
    ECHO_MEMORY:     0,  // deprecated, kept for save compatibility
    LIGHT_CLEANSING: 1,  // deprecated, kept for save compatibility
    STAR_JOY:        2,  // deprecated, kept for save compatibility
    TETRIS_KORA:     3,
    PACMAN_LALI:     4,
    KORIMA_HARP:     5,   // ambient: free-play pentatonic harp
    VITH_BREATH:     6,   // ambient: tap-in-rhythm breathing meditation
    THI_SING:        7,   // synth: theremin / tone-plane improvisation
    SHALIM_KORO:     8,   // synth: chord stacking puzzle
    VYTHI_PULSE:     9,   // synth: step-sequencer rhythm composer
};

// ---------------------------------------------------------------------------
// Shared audio context for the ambient minigames (sustained tones, pads).
// Kept separate from SoundEngine — these games need long releases and custom
// chords that don't fit the short percussive SFX palette.
// ---------------------------------------------------------------------------
let _ambCtx = null;
let _ambMaster = null;
let _ambPad = null;

function ambCtx() {
    if (_ambCtx) return _ambCtx;
    // Reuse the main SoundEngine AudioContext — that one is reliably resumed
    // on user gesture. A separate context can stay 'suspended' on iOS Safari,
    // swallowing the first chord silently.
    try {
        const ctx = SoundEngine.getAudioContext && SoundEngine.getAudioContext();
        const main = SoundEngine.getMasterBus && SoundEngine.getMasterBus();
        if (ctx && main) {
            _ambCtx = ctx;
            _ambMaster = ctx.createGain();
            // Minigame synth foreground. The stage ambient is ducked
            // separately via SoundEngine.duckAmbient() so we don't need an
            // aggressive boost here.
            _ambMaster.gain.value = 0.9;
            _ambMaster.connect(main);
            return _ambCtx;
        }
    } catch (_) {}
    // Fallback: stand-alone context
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        _ambCtx = new AC();
        _ambMaster = _ambCtx.createGain();
        _ambMaster.gain.value = 0.18;
        _ambMaster.connect(_ambCtx.destination);
    } catch (_) { _ambCtx = null; }
    return _ambCtx;
}

// Call this at every synth entry-point that schedules audio. iOS/Safari
// refuse to play if the AudioContext is in 'suspended' state until a user
// gesture kicks it. Cheap and idempotent.
function ensureAmbAwake() {
    const ctx = ambCtx();
    if (!ctx) return null;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
}

function ambPluck(freq, dur = 2.2, type = 'triangle', peak = 0.18) {
    const ctx = ensureAmbAwake();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Two layered oscillators (fifth interval) for richness
    [1, 1.5].forEach((mul, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = i === 0 ? type : 'sine';
        o.frequency.value = freq * mul;
        o.detune.value = (i === 0 ? 0 : 4);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak * (i === 0 ? 1 : 0.35), t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(_ambMaster);
        o.start(t);
        o.stop(t + dur + 0.1);
    });
}

function ambStartPad(rootHz = 65.4) {  // C2
    const ctx = ensureAmbAwake();
    if (!ctx || _ambPad) return;
    const t = ctx.currentTime;
    _ambPad = { osc: [], gain: ctx.createGain() };
    _ambPad.gain.gain.setValueAtTime(0.0001, t);
    _ambPad.gain.gain.exponentialRampToValueAtTime(0.06, t + 3);
    _ambPad.gain.connect(_ambMaster);
    // Three detuned oscillators for a soft pad
    [1, 1.001, 1.5].forEach((mul, i) => {
        const o = ctx.createOscillator();
        o.type = i === 2 ? 'sine' : 'triangle';
        o.frequency.value = rootHz * mul;
        o.detune.value = (i - 1) * 6;
        o.connect(_ambPad.gain);
        o.start(t);
        _ambPad.osc.push(o);
    });
}

function ambStopPad() {
    if (!_ambPad || !_ambCtx) return;
    const t = _ambCtx.currentTime;
    _ambPad.gain.gain.cancelScheduledValues(t);
    _ambPad.gain.gain.setValueAtTime(_ambPad.gain.gain.value, t);
    _ambPad.gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const pad = _ambPad;
    _ambPad = null;
    setTimeout(() => { try { pad.osc.forEach(o => o.stop()); } catch (_) {} }, 1400);
}

// ---- Echo Memory State ----
// Phases: 'pause' → 'flash' → 'gap' → (next step or 'input') → 'success' → 'pause' (next round)
let echo = {
    sequence: [], seqLen: 0, playerPos: 0,
    phase: 'pause', pbIndex: 0, phaseTimer: 0,
    litNode: -1, failed: false, failTimer: 0,
    success: false, successTimer: 0,
    score: 0, rounds: 0,
    nodeX: [], nodeY: [],
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
    echo.phase = 'pause';
    echo.phaseTimer = 0;
    echo.pbIndex = 0;
    echo.litNode = -1;
    echo.playerPos = 0;
}

function echoInit() {
    echoComputeNodes();
    echo.sequence = []; echo.seqLen = 0; echo.score = 0; echo.rounds = 0;
    echo.failed = false; echo.failTimer = 0;
    echo.success = false; echo.successTimer = 0;
    for (let i = 0; i < ECHO_START_LEN; i++) echoAddRandom();
    echoStartPlayback();
}

function echoAdvanceAfterFlash() {
    echo.pbIndex++;
    if (echo.pbIndex >= echo.seqLen) {
        echo.phase = 'input';
        echo.litNode = -1;
    } else {
        echo.phase = 'gap';
        echo.phaseTimer = 0;
    }
}

function echoUpdate() {
    // Failure: after a delay, tap-to-retry becomes available
    if (echo.failed) {
        if (echo.failTimer < 1000) echo.failTimer++;
        return;
    }
    // Success celebration, then next round with +1 node
    if (echo.success) {
        echo.successTimer++;
        if (echo.successTimer > 50) {
            echo.success = false; echo.successTimer = 0;
            echoAddRandom();
            echoStartPlayback();
        }
        return;
    }

    echo.phaseTimer++;
    switch (echo.phase) {
        case 'pause': {
            echo.litNode = -1;
            if (echo.phaseTimer >= ECHO_PAUSE_TICKS) {
                echo.phase = 'flash';
                echo.phaseTimer = 0;
                echo.litNode = echo.sequence[echo.pbIndex];
                try { SoundEngine.playEchoNode(echo.litNode, true); } catch (_) {}
            }
            break;
        }
        case 'flash': {
            // litNode already set; wait for the flash to finish
            if (echo.phaseTimer >= ECHO_FLASH_TICKS) {
                echo.litNode = -1;
                echoAdvanceAfterFlash();
            }
            break;
        }
        case 'gap': {
            echo.litNode = -1;
            if (echo.phaseTimer >= ECHO_GAP_TICKS) {
                echo.phase = 'flash';
                echo.phaseTimer = 0;
                echo.litNode = echo.sequence[echo.pbIndex];
                try { SoundEngine.playEchoNode(echo.litNode, true); } catch (_) {}
            }
            break;
        }
        case 'input': {
            // Clear confirmation flash from a player tap after ~180ms
            if (echo.litNode >= 0 && echo.phaseTimer >= 11) {
                echo.litNode = -1;
            }
            break;
        }
    }
}

function echoHandleTouch(x, y, dragging) {
    // ONLY process initial taps, NOT drag movements — prevents double-fire
    if (dragging) return;
    // Tap-to-retry after a failure
    if (echo.failed && echo.failTimer >= ECHO_RETRY_DELAY) {
        echoInit();
        return;
    }
    if (echo.failed || echo.success) return;
    if (echo.phase !== 'input') return;

    // Use generous hit radius; pick the CLOSEST node under the touch
    let best = -1, bestD = ECHO_NODE_HIT_R * ECHO_NODE_HIT_R * 1.5;
    for (let i = 0; i < ECHO_NODE_COUNT; i++) {
        const dx = x - echo.nodeX[i], dy = y - echo.nodeY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (best < 0) return;

    echo.litNode = best;
    echo.phaseTimer = 0;   // reset so the flash-clear timer above starts fresh
    if (best === echo.sequence[echo.playerPos]) {
        try { SoundEngine.playEchoNode(best, false); } catch (_) {}
        echo.playerPos++;
        echo.score += echo.seqLen;
        if (echo.playerPos >= echo.seqLen) {
            echo.rounds++;
            echo.success = true; echo.successTimer = 0;
            try { SoundEngine.playEchoSuccess(); } catch (_) {}
        }
    } else {
        echo.failed = true;
        echo.failTimer = 0;
        try { SoundEngine.playEchoFail(); } catch (_) {}
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
// ---- Tetris-Lalìen (Kòra-Tris) ----
// 10 cols × 20 rows, each cell ~24px on a 240×480 virtual area centered
const TET_COLS = 10, TET_ROWS = 20;
// Tetromino shapes as 4×4 bitmasks per rotation; color per shape
const TET_SHAPES = [
    { // I
        color: '#3ECFCF', colorDark: '#1C7878',
        rots: [
            [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
            [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
        ],
    },
    { color: '#FFE899', colorDark: '#A87820', // O
        rots: [[[0,1,1,0],[0,1,1,0],[0,0,0,0],[0,0,0,0]]] },
    { color: '#C080E0', colorDark: '#603090', // T
        rots: [
            [[0,0,0,0],[1,1,1,0],[0,1,0,0],[0,0,0,0]],
            [[0,1,0,0],[1,1,0,0],[0,1,0,0],[0,0,0,0]],
            [[0,1,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
            [[0,1,0,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
        ] },
    { color: '#E09050', colorDark: '#803020', // L
        rots: [
            [[0,0,0,0],[1,1,1,0],[1,0,0,0],[0,0,0,0]],
            [[1,1,0,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
            [[0,0,1,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
            [[0,1,0,0],[0,1,0,0],[0,1,1,0],[0,0,0,0]],
        ] },
    { color: '#6AA8FF', colorDark: '#304878', // J
        rots: [
            [[0,0,0,0],[1,1,1,0],[0,0,1,0],[0,0,0,0]],
            [[0,1,0,0],[0,1,0,0],[1,1,0,0],[0,0,0,0]],
            [[1,0,0,0],[1,1,1,0],[0,0,0,0],[0,0,0,0]],
            [[0,1,1,0],[0,1,0,0],[0,1,0,0],[0,0,0,0]],
        ] },
    { color: '#80E080', colorDark: '#206020', // S
        rots: [
            [[0,0,0,0],[0,1,1,0],[1,1,0,0],[0,0,0,0]],
            [[0,1,0,0],[0,1,1,0],[0,0,1,0],[0,0,0,0]],
        ] },
    { color: '#E05080', colorDark: '#801030', // Z
        rots: [
            [[0,0,0,0],[1,1,0,0],[0,1,1,0],[0,0,0,0]],
            [[0,0,1,0],[0,1,1,0],[0,1,0,0],[0,0,0,0]],
        ] },
];

let tet = {
    grid: [], score: 0, lines: 0, piece: null, nextShape: 0,
    rot: 0, px: 0, py: 0, fallTimer: 0, fallEvery: 30, over: false, overTimer: 0,
};

function tetInit() {
    tet.grid = Array.from({ length: TET_ROWS }, () => new Array(TET_COLS).fill(0));
    tet.score = 0; tet.lines = 0; tet.over = false; tet.overTimer = 0;
    tet.fallEvery = 30;
    tetSpawn();
}

function tetSpawn() {
    tet.piece = tet.nextShape != null ? tet.nextShape : Math.floor(Math.random() * TET_SHAPES.length);
    tet.nextShape = Math.floor(Math.random() * TET_SHAPES.length);
    tet.rot = 0;
    tet.px = Math.floor(TET_COLS / 2) - 2;
    tet.py = -1;
    if (tetCollides(tet.piece, tet.rot, tet.px, tet.py + 1)) {
        tet.over = true;
        try { SoundEngine.playTetrisGameOver(); } catch (_) {}
    }
}

function tetShapeCells(shape, rot) {
    const grid = TET_SHAPES[shape].rots[rot % TET_SHAPES[shape].rots.length];
    const cells = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (grid[y][x]) cells.push({ x, y });
    return cells;
}

function tetCollides(shape, rot, px, py) {
    for (const c of tetShapeCells(shape, rot)) {
        const gx = px + c.x, gy = py + c.y;
        if (gx < 0 || gx >= TET_COLS || gy >= TET_ROWS) return true;
        if (gy >= 0 && tet.grid[gy][gx]) return true;
    }
    return false;
}

function tetLock() {
    const color = TET_SHAPES[tet.piece].color;
    for (const c of tetShapeCells(tet.piece, tet.rot)) {
        const gy = tet.py + c.y, gx = tet.px + c.x;
        if (gy >= 0 && gy < TET_ROWS) tet.grid[gy][gx] = color;
    }
    // Clear full rows
    let cleared = 0;
    for (let y = TET_ROWS - 1; y >= 0; y--) {
        if (tet.grid[y].every(v => v)) {
            tet.grid.splice(y, 1);
            tet.grid.unshift(new Array(TET_COLS).fill(0));
            cleared++;
            y++;  // recheck same row
        }
    }
    if (cleared > 0) {
        tet.lines += cleared;
        // Scoring: 1=40, 2=100, 3=300, 4=1200 (classic Tetris)
        const bonusMap = [0, 40, 100, 300, 1200];
        tet.score += bonusMap[cleared] || 0;
        try { SoundEngine.playTetrisLineClear(cleared); } catch (_) {}
        // Speed up every 10 lines
        tet.fallEvery = Math.max(6, 30 - Math.floor(tet.lines / 10) * 4);
    } else {
        try { SoundEngine.playTetrisLock(tet.piece); } catch (_) {}
    }
    tetSpawn();
}

function tetUpdate() {
    if (tet.over) { tet.overTimer++; return; }
    tet.fallTimer++;
    if (tet.fallTimer >= tet.fallEvery) {
        tet.fallTimer = 0;
        if (!tetCollides(tet.piece, tet.rot, tet.px, tet.py + 1)) tet.py++;
        else tetLock();
    }
}

function tetMove(dx) {
    if (tet.over) return;
    if (!tetCollides(tet.piece, tet.rot, tet.px + dx, tet.py)) tet.px += dx;
}
function tetRotate() {
    if (tet.over) return;
    const nrot = tet.rot + 1;
    if (!tetCollides(tet.piece, nrot, tet.px, tet.py)) tet.rot = nrot;
}
function tetDrop() {
    if (tet.over) return;
    while (!tetCollides(tet.piece, tet.rot, tet.px, tet.py + 1)) tet.py++;
    tet.score += 2;
    tetLock();
}

// Gesture state for mobile Tetris: we don't act on touch-down alone so a
// casual tap on the screen doesn't hard-drop the piece.
let tetGest = { x0: 0, y0: 0, lx: 0, ly: 0, t0: 0, moved: false, pending: null };
const TET_SWIPE_PX = 22;   // canvas-coord threshold per cell of motion

function tetHandleTouch(x, y, dragging, vw, vh) {
    if (tet.over && tet.overTimer > 60) { tetInit(); return; }
    if (!dragging) {
        // Touch start — remember origin; do NOT act yet
        tetGest = { x0: x, y0: y, lx: x, ly: y, t0: Date.now(), moved: false };
        return;
    }
    // Drag — emit discrete moves per cell of travel
    const dx = x - tetGest.lx;
    const dy = y - tetGest.ly;
    if (Math.abs(dx) >= TET_SWIPE_PX) {
        tetMove(dx > 0 ? 1 : -1);
        tetGest.lx = x;
        tetGest.moved = true;
    }
    if (dy >= TET_SWIPE_PX) {
        // Soft drop one row
        if (!tetCollides(tet.piece, tet.rot, tet.px, tet.py + 1)) {
            tet.py++;
            tet.score += 1;
        }
        tetGest.ly = y;
        tetGest.moved = true;
    }
}

function tetHandleRelease() {
    if (tet.over) return;
    const dt = Date.now() - tetGest.t0;
    const totalDy = tetGest.ly - tetGest.y0;
    const totalDx = tetGest.lx - tetGest.x0;
    if (!tetGest.moved && dt < 400) {
        // Clean tap = rotate
        tetRotate();
    } else if (totalDy > 90 && Math.abs(totalDx) < 40 && dt < 350) {
        // Fast flick down = hard drop
        tetDrop();
    }
    // Otherwise (slow drag) we already emitted per-cell moves; do nothing here.
}

function tetHandleKey(ev) {
    if (tet.over && tet.overTimer > 60) { tetInit(); return true; }
    const k = ev.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { tetMove(-1); return true; }
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { tetMove(1); return true; }
    if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'x' || k === 'X') { tetRotate(); return true; }
    if (k === 'ArrowDown' || k === 's' || k === 'S') {
        // Soft drop: advance one row
        if (!tet.over && !tetCollides(tet.piece, tet.rot, tet.px, tet.py + 1)) { tet.py++; tet.score += 1; }
        return true;
    }
    if (k === ' ' || k === 'Spacebar') { tetDrop(); return true; }
    return false;
}

function pacHandleKey(ev) {
    if ((pac.over || pac.won) && pac.overTimer > 60) { pacInit(); return true; }
    const k = ev.key;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') { pacSetDir(0); return true; }
    if (k === 'ArrowDown'  || k === 's' || k === 'S') { pacSetDir(1); return true; }
    if (k === 'ArrowLeft'  || k === 'a' || k === 'A') { pacSetDir(2); return true; }
    if (k === 'ArrowUp'    || k === 'w' || k === 'W') { pacSetDir(3); return true; }
    return false;
}

// ---- Pac-Lalì (Pac-Man-style with morak ghosts) ----
// Maze is a small 15×10 grid. 0=path, 1=wall, 2=pellet, 3=power
const PAC_COLS = 15, PAC_ROWS = 11;
const PAC_MAZE_RAW = [
    '111111111111111',
    '122222232222221',
    '121112121112121',
    '122222222222221',
    '121112121112121',
    '122223232322221',
    '121112121112121',
    '122222222222221',
    '121112121112121',
    '122222232222221',
    '111111111111111',
];
let pac = {
    grid: [], pet: { x: 7, y: 5, dir: 0, nextDir: 0 },
    ghosts: [], pelletCount: 0, pelletsLeft: 0, powerTimer: 0, score: 0,
    over: false, won: false, frame: 0, overTimer: 0,
    fruit: null,      // { x, y, kind, hz, expiresAt } — appears twice per run
    fruitSpawnTicks: [],  // frames at which to spawn
};
const PAC_DIRS = [[1,0],[0,1],[-1,0],[0,-1]];

function pacInit() {
    pac.grid = PAC_MAZE_RAW.map(row => row.split('').map(ch => parseInt(ch, 10)));
    pac.pet = { x: 7, y: 5, dir: 0, nextDir: 0, sub: 0 };
    pac.ghosts = [
        { x: 2, y: 1, dir: 0, color: '#E05050', sub: 0 },
        { x: 12, y: 1, dir: 2, color: '#C080E0', sub: 0 },
        { x: 7, y: 9, dir: 3, color: '#6AA8FF', sub: 0 },
    ];
    pac.pelletCount = 0;
    for (const row of pac.grid) for (const c of row) if (c === 2 || c === 3) pac.pelletCount++;
    pac.pelletsLeft = pac.pelletCount;
    pac.powerTimer = 0; pac.score = 0; pac.over = false; pac.won = false; pac.frame = 0; pac.overTimer = 0;
    // Fruit appears after 30% and 70% of the pellets have been collected
    pac.fruit = null;
    pac.fruitSpawnTicks = [];  // trigger by pellet progress, not time
    pac.fruitsSpawned = 0;
}

function pacCellFree(x, y) {
    if (x < 0 || x >= PAC_COLS || y < 0 || y >= PAC_ROWS) return false;
    return pac.grid[y][x] !== 1;
}
function pacSetDir(d) { if (d >= 0 && d < 4) pac.pet.nextDir = d; }

function pacStep(entity, speed = 1) {
    // Move in sub-cell increments; when crossing a cell boundary, commit
    entity.sub = (entity.sub || 0) + speed;
    if (entity.sub < 10) return;
    entity.sub = 0;
    const [dx, dy] = PAC_DIRS[entity.dir];
    const nx = entity.x + dx, ny = entity.y + dy;
    if (!pacCellFree(nx, ny)) return;
    entity.x = nx; entity.y = ny;
}

function pacUpdate() {
    pac.frame++;
    if (pac.over || pac.won) { pac.overTimer++; return; }

    // Pet: try queued direction first
    const pet = pac.pet;
    const tryD = pet.nextDir;
    const td = PAC_DIRS[tryD];
    if (pacCellFree(pet.x + td[0], pet.y + td[1]) && pet.sub < 2) pet.dir = tryD;
    pacStep(pet, 1);  // slower — was 3 (way too fast)

    // Collect pellet
    const cell = pac.grid[pet.y][pet.x];
    if (cell === 2) { pac.grid[pet.y][pet.x] = 0; pac.pelletsLeft--; pac.score += 10;
        try { SoundEngine.playPacPellet(); } catch (_) {} }
    else if (cell === 3) { pac.grid[pet.y][pet.x] = 0; pac.pelletsLeft--; pac.score += 50; pac.powerTimer = 480;
        try { SoundEngine.playPacPower(); } catch (_) {} }

    // Fruit spawn at 30% and 70% pellet progress
    const progress = 1 - pac.pelletsLeft / pac.pelletCount;
    const targets = [0.3, 0.7];
    for (let i = pac.fruitsSpawned; i < targets.length; i++) {
        if (progress >= targets[i]) {
            // pick a random free cell
            const free = [];
            for (let y = 0; y < PAC_ROWS; y++) for (let x = 0; x < PAC_COLS; x++)
                if (pac.grid[y][x] === 0 && !(x === pet.x && y === pet.y)) free.push({ x, y });
            if (free.length) {
                const spot = free[Math.floor(Math.random() * free.length)];
                const kinds = ['kora', 'nashi', 'vythi'];
                pac.fruit = {
                    x: spot.x, y: spot.y,
                    kind: kinds[i % kinds.length],
                    value: 300 + i * 150,
                    expiresAt: pac.frame + 60 * 8,   // 8 seconds
                };
                pac.fruitsSpawned++;
            }
        }
    }
    // Fruit collision
    if (pac.fruit && pac.fruit.x === pet.x && pac.fruit.y === pet.y) {
        pac.score += pac.fruit.value;
        try { SoundEngine.playPacPower(); } catch (_) {}
        pac.fruit = null;
    }
    if (pac.fruit && pac.frame > pac.fruit.expiresAt) pac.fruit = null;

    if (pac.pelletsLeft <= 0) { pac.won = true; pac.overTimer = 0; pac.score += 200;
        try { SoundEngine.playPacWin(); } catch (_) {}
        return; }

    // Ghosts
    if (pac.powerTimer > 0) pac.powerTimer--;
    for (const g of pac.ghosts) {
        if (g.sub === 0) {
            // Randomize direction at intersections; bias toward player
            const opts = [];
            for (let d = 0; d < 4; d++) {
                if (d === (g.dir + 2) % 4) continue;  // no reversing
                const [dx, dy] = PAC_DIRS[d];
                if (pacCellFree(g.x + dx, g.y + dy)) opts.push(d);
            }
            if (!opts.length) { g.dir = (g.dir + 2) % 4; }
            else {
                if (pac.powerTimer > 0) {
                    // Flee: pick farthest from pet
                    opts.sort((a, b) => distAfter(g, b) - distAfter(g, a));
                } else {
                    // Chase: pick nearest to pet
                    opts.sort((a, b) => distAfter(g, a) - distAfter(g, b));
                }
                g.dir = opts[Math.random() < 0.7 ? 0 : Math.floor(Math.random() * opts.length)];
            }
        }
        pacStep(g, 0.75);  // ghosts slightly slower than pet
        // Collision
        if (g.x === pet.x && g.y === pet.y) {
            if (pac.powerTimer > 0) {
                // Eat the morak
                pac.score += 200;
                g.x = 7; g.y = 5; g.dir = (Math.floor(Math.random() * 4));
                try { SoundEngine.playPacGhostEat(); } catch (_) {}
            } else {
                pac.over = true; pac.overTimer = 0;
                try { SoundEngine.playPacDeath(); } catch (_) {}
            }
        }
    }
}

function distAfter(g, dir) {
    const [dx, dy] = PAC_DIRS[dir];
    const nx = g.x + dx, ny = g.y + dy;
    return Math.abs(nx - pac.pet.x) + Math.abs(ny - pac.pet.y);
}

let pacDragStart = null;
function pacHandleTouch(x, y, dragging, vw, vh) {
    if ((pac.over || pac.won) && pac.overTimer > 60) { pacInit(); return; }
    if (!dragging) { pacDragStart = { x, y }; return; }
    if (!pacDragStart) return;
    const dx = x - pacDragStart.x;
    const dy = y - pacDragStart.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) pacSetDir(dx > 0 ? 0 : 2);
    else pacSetDir(dy > 0 ? 1 : 3);
    pacDragStart = { x, y };
}

let _playing = false;
let _currentGame = GameType.ECHO_MEMORY;
let _tick = 0;

// ---------------------------------------------------------------------------
// KORIMA-CELESTE — ambient pentatonic harp, free play, no fail.
// ---------------------------------------------------------------------------
const HARP_DURATION_TICKS = 90 * 60;   // ~90 seconds at 60 fps
const HARP_STRINGS = [
    // C major pentatonic across two octaves (C4 → D5)
    { name: 'C4', hz: 261.63 },
    { name: 'D4', hz: 293.66 },
    { name: 'E4', hz: 329.63 },
    { name: 'G4', hz: 392.00 },
    { name: 'A4', hz: 440.00 },
    { name: 'C5', hz: 523.25 },
    { name: 'D5', hz: 587.33 },
];
let harp = {
    t: 0,
    notes: 0,
    lastStringAt: [],   // tick of last pluck per string (for glow decay)
    particles: [],      // rising motes from plucked strings
    lastDragString: -1,
};

function harpInit() {
    harp.t = 0;
    harp.notes = 0;
    harp.lastStringAt = new Array(HARP_STRINGS.length).fill(-9999);
    harp.particles = [];
    harp.lastDragString = -1;
    ambStartPad(65.4);   // C2 drone
}

function harpUpdate() {
    harp.t++;
    // Drift particles upward, fade
    harp.particles = harp.particles.filter(p => p.life > 0);
    for (const p of harp.particles) {
        p.y += p.vy;
        p.x += p.vx;
        p.life -= 0.012;
    }
}

function harpHitString(x, y, vw, vh) {
    const margin = Math.min(60, vw * 0.08);
    const span = vw - margin * 2;
    const step = span / (HARP_STRINGS.length - 1);
    for (let i = 0; i < HARP_STRINGS.length; i++) {
        const sx = margin + i * step;
        if (Math.abs(x - sx) < step * 0.45 && y > vh * 0.15 && y < vh * 0.92) {
            return i;
        }
    }
    return -1;
}

function harpPluck(i) {
    if (i < 0 || i >= HARP_STRINGS.length) return;
    harp.lastStringAt[i] = harp.t;
    harp.notes++;
    ambPluck(HARP_STRINGS[i].hz, 2.6, 'triangle', 0.22);
    // Add particles at the top of this string
    const vw = 800, vh = 400;
    const margin = Math.min(60, vw * 0.08);
    const span = vw - margin * 2;
    const step = span / (HARP_STRINGS.length - 1);
    const sx = margin + i * step;
    const hue = 180 + i * 22;
    for (let k = 0; k < 6; k++) {
        harp.particles.push({
            x: sx + (Math.random() - 0.5) * 14,
            y: vh * 0.5 + (Math.random() - 0.5) * 40,
            vx: (Math.random() - 0.5) * 0.6,
            vy: -0.8 - Math.random() * 0.8,
            r: 2 + Math.random() * 2,
            hue,
            life: 1,
        });
    }
}

function harpHandleTouch(x, y, dragging, vw, vh) {
    vw = vw || 800; vh = vh || 400;
    const i = harpHitString(x, y, vw, vh);
    if (i < 0) { harp.lastDragString = -1; return; }
    if (dragging) {
        // While dragging, only trigger when crossing into a different string
        if (i !== harp.lastDragString) {
            harpPluck(i);
            harp.lastDragString = i;
        }
    } else {
        harpPluck(i);
        harp.lastDragString = i;
    }
}

function renderHarp(ctx, w, h) {
    // Soft twilight background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0A0F1E');
    bg.addColorStop(0.6, '#14203A');
    bg.addColorStop(1, '#1E2A4A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Background stars
    for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % w;
        const sy = (i * 53) % (h * 0.55);
        const a = 0.2 + 0.5 * Math.abs(Math.sin(harp.t * 0.02 + i));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#D8E8FF';
        ctx.fillRect(sx, sy, 1, 1);
    }
    ctx.globalAlpha = 1;

    // Strings
    const margin = Math.min(60, w * 0.08);
    const span = w - margin * 2;
    const step = span / (HARP_STRINGS.length - 1);
    for (let i = 0; i < HARP_STRINGS.length; i++) {
        const sx = margin + i * step;
        const age = harp.t - harp.lastStringAt[i];
        const glow = age < 120 ? (1 - age / 120) : 0;
        const hue = 180 + i * 22;

        // Base string (thin, faint)
        ctx.strokeStyle = `hsla(${hue},60%,70%,0.35)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx, h * 0.12);
        ctx.lineTo(sx, h * 0.92);
        ctx.stroke();

        // Glow overlay when plucked
        if (glow > 0) {
            ctx.strokeStyle = `hsla(${hue},80%,72%,${0.85 * glow})`;
            ctx.lineWidth = 3 + glow * 4;
            // Wobble: amplitude decays with age
            ctx.beginPath();
            const amp = 8 * glow;
            for (let y = h * 0.12; y <= h * 0.92; y += 4) {
                const dx = Math.sin((y + harp.t * 3) * 0.05) * amp;
                if (y === h * 0.12) ctx.moveTo(sx + dx, y);
                else ctx.lineTo(sx + dx, y);
            }
            ctx.stroke();
        }

        // String label at top
        ctx.fillStyle = glow > 0 ? `hsl(${hue},80%,80%)` : 'rgba(200,220,255,0.45)';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(HARP_STRINGS[i].name, sx, h * 0.08);
    }

    // Particles
    for (const p of harp.particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = `hsl(${p.hue},80%,75%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Progress ring at top-right
    const remain = Math.max(0, 1 - harp.t / HARP_DURATION_TICKS);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(remain * 90)}s · ${harp.notes} note`, w - 16, 22);

    // Hint
    if (harp.notes < 3 && harp.t < 180) {
        ctx.fillStyle = 'rgba(212,165,52,0.85)';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Tocca o trascina sulle corde — ascolta il canto', w / 2, h * 0.97);
    }
}

// ---------------------------------------------------------------------------
// VITH-ONDI — guided breathing. A target ring pulses slowly (5s inhale, 5s
// exhale). The player's ring expands while they HOLD a finger on the canvas
// and shrinks when they release. Goal: keep the two rings overlapped. A
// sustained drone tracks the user's radius — pitch and brightness rise as
// you hold, fall as you release — so syncing feels physically audible.
// Score is accumulated every tick the two rings overlap within a tolerance.
// ---------------------------------------------------------------------------
const BREATH_DURATION_TICKS = 90 * 60;      // 90s
const BREATH_CYCLE_SEC = 10;                 // 5s inhale + 5s exhale
const BREATH_TARGET_IN_S = 5;
const BREATH_TARGET_OUT_S = 5;
let breath = {
    t: 0,
    score: 0,
    cycles: 0,
    holding: false,
    userLevel: 0,         // 0..1, what the user is currently "breathing in"
    targetLevel: 0,       // 0..1 script
    syncFrames: 0,
    lastPhase: 0,         // tracks target ring phase for cycle count
    voice: null,          // sustained osc for the breath drone
};

function breathStartVoice() {
    const ctx = ensureAmbAwake();
    if (!ctx) return;
    if (breath.voice) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.connect(_ambMaster);
    // Two-voice drone: fundamental + fifth
    const o1 = ctx.createOscillator();
    o1.type = 'sine'; o1.frequency.value = 130.81;   // C3
    const o2 = ctx.createOscillator();
    o2.type = 'triangle'; o2.frequency.value = 196.00; // G3
    o1.connect(gain); o2.connect(gain);
    o1.start(t); o2.start(t);
    breath.voice = { o1, o2, gain };
}

function breathUpdateVoice() {
    if (!breath.voice || !_ambCtx) return;
    const t = _ambCtx.currentTime;
    // Gain and pitch follow user's held level
    const gainTarget = 0.03 + breath.userLevel * 0.18;
    breath.voice.gain.gain.cancelScheduledValues(t);
    breath.voice.gain.gain.setValueAtTime(breath.voice.gain.gain.value, t);
    breath.voice.gain.gain.linearRampToValueAtTime(gainTarget, t + 0.12);
    // Detune slightly upward as breath rises
    const detune = breath.userLevel * 120;
    breath.voice.o1.detune.linearRampToValueAtTime(detune, t + 0.12);
    breath.voice.o2.detune.linearRampToValueAtTime(detune * 1.3, t + 0.12);
}

function breathStopVoice() {
    if (!breath.voice || !_ambCtx) return;
    const t = _ambCtx.currentTime;
    const v = breath.voice;
    breath.voice = null;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    setTimeout(() => { try { v.o1.stop(); v.o2.stop(); } catch (_) {} }, 1000);
}

function breathInit() {
    breath.t = 0; breath.score = 0; breath.cycles = 0;
    breath.holding = false; breath.userLevel = 0; breath.targetLevel = 0;
    breath.syncFrames = 0; breath.lastPhase = 0;
    breathStartVoice();
}

function breathTargetAt(tSec) {
    // Triangle-like curve smoothed via cosine: 0 at start, 1 at BREATH_TARGET_IN_S,
    // 0 at BREATH_TARGET_IN_S + BREATH_TARGET_OUT_S, loops.
    const cyc = BREATH_TARGET_IN_S + BREATH_TARGET_OUT_S;
    const phase = (tSec % cyc) / cyc;
    return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

function breathUpdate() {
    breath.t++;
    const tSec = breath.t / 60;
    breath.targetLevel = breathTargetAt(tSec);

    // User level: rise when holding (slowly, ~5s to full), fall when released
    const RISE = 1 / (5 * 60);     // full in 5s
    const FALL = 1 / (5 * 60);
    if (breath.holding) breath.userLevel = Math.min(1, breath.userLevel + RISE);
    else                breath.userLevel = Math.max(0, breath.userLevel - FALL);

    // Cycle counter — when target phase wraps past 1 (trough) count a cycle
    const phase = (tSec % (BREATH_TARGET_IN_S + BREATH_TARGET_OUT_S)) / (BREATH_TARGET_IN_S + BREATH_TARGET_OUT_S);
    if (phase < breath.lastPhase) breath.cycles++;   // wrap
    breath.lastPhase = phase;

    // Sync scoring: reward every frame the two levels are within 12%
    const diff = Math.abs(breath.userLevel - breath.targetLevel);
    if (diff < 0.12) {
        breath.score += Math.round((1 - diff / 0.12) * 3);
        breath.syncFrames++;
    }

    breathUpdateVoice();
}

function breathHandleTouch(x, y, dragging, vw, vh) {
    // Pressing anywhere = holding breath in. Move = still holding.
    breath.holding = true;
}

function breathHandleRelease() {
    breath.holding = false;
}

function renderBreath(ctx, w, h) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#08102A');
    bg.addColorStop(0.5, '#0E2848');
    bg.addColorStop(1, '#103054');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    const rMin = Math.min(w, h) * 0.10;
    const rMax = Math.min(w, h) * 0.42;
    const rUser   = rMin + (rMax - rMin) * breath.userLevel;
    const rTarget = rMin + (rMax - rMin) * breath.targetLevel;
    const inSync  = Math.abs(breath.userLevel - breath.targetLevel) < 0.12;

    // Target ring (dotted outline)
    ctx.save();
    ctx.strokeStyle = inSync ? '#9FE6B4' : '#7FAEDC';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(cx, cy, rTarget, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // User ring (solid, filled soft)
    const fill = inSync ? 'rgba(180,240,200,0.45)' : 'rgba(160,210,245,0.35)';
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(cx, cy, rUser, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = breath.holding ? '#FFFFFF' : 'rgba(230,245,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, rUser, 0, Math.PI * 2); ctx.stroke();

    // Center guide
    ctx.fillStyle = 'rgba(240,248,255,0.9)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    const phase = (breath.t / 60) % (BREATH_TARGET_IN_S + BREATH_TARGET_OUT_S);
    const inhale = phase < BREATH_TARGET_IN_S;
    const secLeft = Math.ceil(inhale ? (BREATH_TARGET_IN_S - phase) : (BREATH_TARGET_IN_S + BREATH_TARGET_OUT_S - phase));
    ctx.fillText(inhale ? `inspira · ${secLeft}s` : `espira · ${secLeft}s`, cx, cy - 4);

    // Sub-instruction
    ctx.fillStyle = 'rgba(200,220,245,0.75)';
    ctx.font = '12px sans-serif';
    ctx.fillText(inhale ? 'tieni premuto per espandere' : 'rilascia per contrarre', cx, cy + 16);

    // Bottom hint
    ctx.fillStyle = 'rgba(200,220,245,0.55)';
    ctx.font = '11px sans-serif';
    ctx.fillText('segui il cerchio tratteggiato · respira con lui', cx, h - 18);

    // Progress + sync meter
    const remain = Math.max(0, 1 - breath.t / BREATH_DURATION_TICKS);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(remain * 90)}s · ${breath.cycles} cicli · sync ${Math.round(breath.syncFrames / Math.max(1, breath.t) * 100)}%`, w - 16, 22);

    // Sync pulse in corner
    if (inSync) {
        ctx.fillStyle = '#9FE6B4';
        ctx.fillRect(w - 16, 28, 6, 6);
    }
}

// ---------------------------------------------------------------------------
// THI-SING — two-axis theremin. X = pitch bucket (7 pentatonic notes),
// Y = tone brightness (filter/osc mix). Finger drag shapes a continuous
// melody over a slow chord pad. Pure improvisation, no fail.
// ---------------------------------------------------------------------------
const THI_DURATION_TICKS = 80 * 60;
const THI_SCALE = [261.63, 311.13, 349.23, 392.00, 466.16, 523.25, 622.25];  // C minor blues-ish for pads
const THI_CHORDS = [
    [130.81, 155.56, 196.00],   // C minor
    [138.59, 164.81, 207.65],   // C# dim / pad
    [155.56, 185.00, 233.08],   // Eb min
    [146.83, 174.61, 220.00],   // D min
];
let thi = {
    t: 0,
    notes: 0,
    trail: [],          // recent touch points for a comet trail
    lastBucket: -1,
    currentChord: 0,
    voice: null,        // sustained osc while finger held
};

function thiInit() {
    thi.t = 0; thi.notes = 0; thi.trail = []; thi.lastBucket = -1; thi.currentChord = 0;
    thi.voice = null;
    // Slow chord pad: changes every 16s
    _thiPad = null;
    thiPadCycle();
}

let _thiPad = null;
function thiPadCycle() {
    const ctx = ambCtx();
    if (!ctx) return;
    const chord = THI_CHORDS[thi.currentChord];
    const t = ctx.currentTime;
    // Fade out previous
    if (_thiPad) {
        const old = _thiPad;
        _thiPad.gain.gain.cancelScheduledValues(t);
        _thiPad.gain.gain.setValueAtTime(_thiPad.gain.gain.value, t);
        _thiPad.gain.gain.exponentialRampToValueAtTime(0.0001, t + 4);
        setTimeout(() => { try { old.osc.forEach(o => o.stop()); } catch (_) {} }, 4500);
    }
    _thiPad = { osc: [], gain: ctx.createGain() };
    _thiPad.gain.gain.setValueAtTime(0.0001, t);
    _thiPad.gain.gain.exponentialRampToValueAtTime(0.07, t + 3);
    _thiPad.gain.connect(_ambMaster);
    for (const hz of chord) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz;
        o.detune.value = (Math.random() - 0.5) * 8;
        o.connect(_thiPad.gain);
        o.start(t);
        _thiPad.osc.push(o);
    }
}

function thiUpdate() {
    thi.t++;
    // Cycle chord every 16s
    if (thi.t % (16 * 60) === 0) {
        thi.currentChord = (thi.currentChord + 1) % THI_CHORDS.length;
        thiPadCycle();
    }
    // Decay trail
    thi.trail = thi.trail.filter(p => p.life > 0);
    for (const p of thi.trail) p.life -= 0.02;
}

function thiStartVoice() {
    const ctx = ensureAmbAwake();
    if (!ctx || thi.voice) return;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    gain.connect(_ambMaster);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = THI_SCALE[3];
    osc.connect(gain);
    osc.start(t);
    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.frequency.value = 5;
    vibG.gain.value = 2;
    vib.connect(vibG).connect(osc.frequency);
    vib.start(t);
    thi.voice = { osc, gain, vib };
}

function thiStopVoice() {
    if (!thi.voice || !_ambCtx) return;
    const t = _ambCtx.currentTime;
    const v = thi.voice;
    thi.voice = null;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    setTimeout(() => { try { v.osc.stop(); v.vib.stop(); } catch (_) {} }, 600);
}

function thiHandleTouch(x, y, dragging, vw, vh) {
    vw = vw || 800; vh = vh || 400;
    const bucket = Math.max(0, Math.min(THI_SCALE.length - 1, Math.floor(x / vw * THI_SCALE.length)));
    const brightness = Math.max(0, Math.min(1, 1 - y / vh));

    if (!dragging) {
        // New touch → start voice, count a note
        thiStartVoice();
        thi.notes++;
    }
    if (!thi.voice) return;

    const ctx = ambCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    const hz = THI_SCALE[bucket];
    thi.voice.osc.frequency.linearRampToValueAtTime(hz, t + 0.04);
    const target = 0.06 + brightness * 0.14;
    thi.voice.gain.gain.cancelScheduledValues(t);
    thi.voice.gain.gain.setValueAtTime(thi.voice.gain.gain.value, t);
    thi.voice.gain.gain.linearRampToValueAtTime(target, t + 0.06);
    // Change oscillator type based on brightness: sine → triangle → sawtooth
    thi.voice.osc.type = brightness < 0.33 ? 'sine' : brightness < 0.66 ? 'triangle' : 'sawtooth';

    // Trail
    thi.trail.push({ x, y, hue: 180 + bucket * 25, life: 1 });
    if (thi.trail.length > 40) thi.trail.shift();
    if (bucket !== thi.lastBucket && dragging) thi.notes++;
    thi.lastBucket = bucket;
}

function thiHandleRelease() {
    thiStopVoice();
    thi.lastBucket = -1;
}

function renderThi(ctx, w, h) {
    // Starry twilight
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0A0F20');
    bg.addColorStop(1, '#182840');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Pentatonic pitch lanes (subtle vertical bands)
    for (let i = 0; i < THI_SCALE.length; i++) {
        const x = (i + 0.5) * w / THI_SCALE.length;
        ctx.strokeStyle = `hsla(${180 + i * 25},50%,60%,0.15)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 30);
        ctx.lineTo(x, h - 20);
        ctx.stroke();
        // Note label at bottom
        ctx.fillStyle = `hsla(${180 + i * 25},70%,75%,0.4)`;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        const names = ['C','Eb','F','G','Bb','C2','Eb2'];
        ctx.fillText(names[i], x, h - 6);
    }

    // Brightness-Y reference (top = bright, bottom = soft)
    ctx.fillStyle = 'rgba(200,220,245,0.45)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('↑ luminoso · sotto morbido →', 12, 18);

    // Trail
    for (const p of thi.trail) {
        ctx.globalAlpha = p.life * 0.75;
        ctx.fillStyle = `hsl(${p.hue},80%,70%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * p.life, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Chord name top-right
    const chordNames = ['Do minore', 'Do# dim', 'Mi♭ min', 'Re min'];
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`pad: ${chordNames[thi.currentChord]}`, w - 16, 18);

    // Progress
    const remain = Math.max(0, 1 - thi.t / THI_DURATION_TICKS);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${Math.ceil(remain * 80)}s · ${thi.notes} note`, w - 16, 34);

    // Hint when idle
    if (!thi.voice && thi.t < 180) {
        ctx.fillStyle = 'rgba(212,165,52,0.85)';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Trascina il dito: orizzontale = tono, verticale = timbro', w / 2, h / 2);
    }
}

// ---------------------------------------------------------------------------
// SHALIM-KORO — chord synth inspired by the Telepathic Instruments Orchid.
// 7 diatonic chord pads in a horizontal row (I ii iii IV V vi vii°) in the
// current mode. HOLD a pad → a lush voiced chord sustains with soft attack
// and long release. Slide to the neighbour → smooth crossfade. Release your
// finger → the chord fades out. Three toggles at the top switch mode
// (maggiore / minore / dorian), harmonic extension (triade / 7 / 7+9), and
// voice timbre (morbido / brillante). No target, no fail — improvisation.
// ---------------------------------------------------------------------------
const SHALIM_DURATION_TICKS = 90 * 60;
const SHALIM_ROOT_HZ = 130.81;   // C3 tonic
// Semitone offsets for the seven diatonic triads, per mode. Each triad is
// [root, third, fifth] relative to the tonic.
const SHALIM_MODES = {
    maggiore: [[0, 4, 7], [2, 5, 9],  [4, 7, 11], [5, 9, 12], [7, 11, 14], [9, 12, 16], [11, 14, 17]],
    minore:   [[0, 3, 7], [2, 5, 8],  [3, 7, 10], [5, 8, 12], [7, 10, 14], [8, 12, 15], [10, 13, 17]],
    dorian:   [[0, 3, 7], [2, 5, 9],  [3, 7, 10], [5, 9, 12], [7, 10, 14], [9, 12, 15], [10, 14, 17]],
};
const SHALIM_MODE_NAMES = Object.keys(SHALIM_MODES);
const SHALIM_LABELS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

let shalim = {
    t: 0,
    held: -1,            // index of currently held pad, -1 none
    heldFrames: 0,       // cumulative frames of any hold
    uniqueChords: new Set(),
    modeIdx: 0,
    extension: 0,        // 0=triade, 1=+7, 2=+7+9
    brightness: 0,       // 0=morbido, 1=brillante
    octave: 0,           // -1, 0, +1 (semitone shift = *12)
    hold: false,         // when true, released pads keep ringing
    arpMode: false,      // when true, chord plays as arpeggio loop instead of sustained
    arpStepTimer: 0,
    arpStep: 0,
    arpPad: -1,          // which pad the arp is cycling
    arpNotes: [],        // cached frequency sequence for the current arp
    glow: new Array(7).fill(0),
    voice: null,         // { oscs, gain, padIdx }
    padRects: [],        // recomputed on touch/render
    toggleRects: [],
};

function shalimInit() {
    shalim.t = 0;
    shalim.held = -1;
    shalim.heldFrames = 0;
    shalim.uniqueChords = new Set();
    shalim.modeIdx = 0;
    shalim.extension = 0;
    shalim.brightness = 0;
    shalim.octave = 0;
    shalim.hold = false;
    shalim.arpMode = false;
    shalim.arpStepTimer = 0;
    shalim.arpStep = 0;
    shalim.arpPad = -1;
    shalim.arpNotes = [];
    shalim.glow.fill(0);
    shalim.voice = null;
    shalim.padRects = [];
    shalim.toggleRects = [];
}

function shalimChordFreqs(degree) {
    const modeName = SHALIM_MODE_NAMES[shalim.modeIdx];
    const triad = SHALIM_MODES[modeName][degree];
    const semis = triad.slice();
    if (shalim.extension >= 1) semis.push(triad[0] + 10);
    if (shalim.extension >= 2) semis.push(triad[0] + 14);
    const oct = (shalim.octave || 0) * 12;
    return {
        bass: SHALIM_ROOT_HZ * Math.pow(2, (triad[0] - 12 + oct) / 12),
        notes: semis.map(s => SHALIM_ROOT_HZ * Math.pow(2, (s + oct) / 12)),
    };
}

function shalimStartChord(padIdx) {
    const ctx = ensureAmbAwake();
    if (!ctx) return;
    // Crossfade previous chord if any
    shalimReleaseChord(0.35);

    const { bass, notes } = shalimChordFreqs(padIdx);
    const t = ctx.currentTime;
    const peakGain = 0.20;
    const attack = 0.45;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peakGain, t + attack);
    gain.connect(_ambMaster);

    // Warm low-pass for the whole chord
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800 + shalim.brightness * 2600;
    lp.Q.value = 0.7;
    lp.connect(gain);

    const oscs = [];
    const bright = shalim.brightness > 0.5;

    // Bass — sine + sub
    [bass, bass / 2].forEach((hz, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = hz;
        g.gain.value = i === 0 ? 0.55 : 0.25;
        o.connect(g).connect(lp);
        o.start(t);
        oscs.push(o);
    });

    // Chord voices — triad + optional extensions, each note with 2 layered
    // oscillators slightly detuned for thickness (like an analog poly-synth).
    notes.forEach((hz, i) => {
        [[0, bright ? 'sawtooth' : 'triangle', 0.18],
         [6, 'sine', 0.10],
         [-5, 'sine', 0.08]].forEach(([detune, type, vol]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = type;
            o.frequency.value = hz;
            o.detune.value = detune;
            // Stagger attack per voice for a soft "strum"
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(vol, t + attack + i * 0.04);
            o.connect(g).connect(lp);
            o.start(t);
            oscs.push(o);
        });
    });

    // Tremolo on gain for life
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 3.8;
    lfoG.gain.value = 0.025;
    lfo.connect(lfoG).connect(gain.gain);
    lfo.start(t);
    oscs.push(lfo);

    shalim.voice = { oscs, gain, padIdx };
    shalim.uniqueChords.add(padIdx);
}

function shalimReleaseChord(releaseSec = 1.8) {
    if (!shalim.voice || !_ambCtx) return;
    const t = _ambCtx.currentTime;
    const v = shalim.voice;
    shalim.voice = null;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + releaseSec);
    setTimeout(() => { try { v.oscs.forEach(o => o.stop()); } catch (_) {} }, releaseSec * 1000 + 80);
}

function shalimUpdate() {
    shalim.t++;
    const ringing = shalim.held >= 0 || (shalim.hold && shalim.voice) ||
                    (shalim.arpMode && shalim.arpPad >= 0);
    if (ringing) shalim.heldFrames++;

    // Glow: ringing pad stays bright, others dim
    const activePad = (shalim.arpMode && shalim.arpPad >= 0) ? shalim.arpPad : shalim.held;
    for (let i = 0; i < shalim.glow.length; i++) {
        if (i === activePad && ringing) {
            shalim.glow[i] = Math.min(1, shalim.glow[i] + 0.1);
        } else {
            shalim.glow[i] = Math.max(0, shalim.glow[i] - 0.03);
        }
    }

    // Arpeggiator tick (8th notes at 100 BPM = 150ms)
    if (shalim.arpMode && shalim.arpPad >= 0 && shalim.arpNotes.length) {
        shalim.arpStepTimer += 1 / 60;
        if (shalim.arpStepTimer >= 0.15) {
            shalim.arpStepTimer = 0;
            const hz = shalim.arpNotes[shalim.arpStep % shalim.arpNotes.length];
            shalim.arpStep++;
            shalimArpNote(hz);
        }
    }
}

function shalimArpNote(hz) {
    const ctx = ensureAmbAwake();
    if (!ctx) return;
    const t = ctx.currentTime;
    const bright = shalim.brightness > 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.17, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    g.connect(_ambMaster);
    const o = ctx.createOscillator();
    o.type = bright ? 'sawtooth' : 'triangle';
    o.frequency.value = hz;
    o.connect(g);
    o.start(t); o.stop(t + 0.5);
    // Shimmer harmonic
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine'; o2.frequency.value = hz * 2;
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o2.connect(g2).connect(_ambMaster);
    o2.start(t); o2.stop(t + 0.4);
}

function shalimComputeGeometry(w, h) {
    // Pads row
    const rowTop = 128;
    const rowBottom = h - 26;
    const rowH = rowBottom - rowTop;
    const padMarginX = 18;
    const gap = 8;
    const padCount = 7;
    const padW = Math.floor((w - padMarginX * 2 - gap * (padCount - 1)) / padCount);
    shalim.padRects = [];
    for (let i = 0; i < padCount; i++) {
        shalim.padRects.push({
            x: padMarginX + i * (padW + gap),
            y: rowTop, w: padW, h: rowH,
        });
    }
    // Two rows of toggles: the three "flavour" switches (mode/ext/bri) up
    // top, then three performance switches (octave/hold/arpeggio) below.
    const topRow = ['mode', 'ext', 'bri'];
    const botRow = ['oct',  'hold', 'arp'];
    const tW = Math.min(108, w * 0.18);
    const tGap = 8;
    const tH = 22;
    const tTotalW = tW * 3 + tGap * 2;
    shalim.toggleRects = [];
    const makeRow = (kinds, yy) => {
        let xx = (w - tTotalW) / 2;
        for (const kind of kinds) {
            shalim.toggleRects.push({ kind, x: xx, y: yy, w: tW, h: tH });
            xx += tW + tGap;
        }
    };
    makeRow(topRow, 56);
    makeRow(botRow, 56 + tH + 6);
}

function shalimPadAt(x, y) {
    for (let i = 0; i < shalim.padRects.length; i++) {
        const r = shalim.padRects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
}

function shalimHandleTouch(x, y, dragging, vw, vh) {
    shalimComputeGeometry(vw, vh);
    // Toggles — only on fresh taps
    if (!dragging) {
        for (const tg of shalim.toggleRects) {
            if (x >= tg.x && x <= tg.x + tg.w && y >= tg.y && y <= tg.y + tg.h) {
                if (tg.kind === 'mode')  shalim.modeIdx   = (shalim.modeIdx + 1) % SHALIM_MODE_NAMES.length;
                if (tg.kind === 'ext')   shalim.extension = (shalim.extension + 1) % 3;
                if (tg.kind === 'bri')   shalim.brightness = shalim.brightness > 0.5 ? 0 : 1;
                if (tg.kind === 'oct')   shalim.octave    = shalim.octave === 1 ? -1 : shalim.octave + 1;
                if (tg.kind === 'hold')  {
                    shalim.hold = !shalim.hold;
                    if (!shalim.hold && shalim.held < 0) {
                        // Hold turned off and nothing held → release sustain
                        shalimReleaseChord(1.2);
                    }
                }
                if (tg.kind === 'arp')   {
                    shalim.arpMode = !shalim.arpMode;
                    if (shalim.arpMode) {
                        // If there was a sustained chord, transition into arpeggio
                        if (shalim.voice || shalim.held >= 0 || shalim.hold) {
                            const seed = shalim.held >= 0 ? shalim.held : (shalim.voice ? shalim.voice.padIdx : 0);
                            shalimStartArp(seed);
                            shalimReleaseChord(0.4);
                        }
                    } else {
                        // Exit arp → release
                        shalim.arpPad = -1;
                        shalim.arpNotes = [];
                    }
                }
                if (shalim.held >= 0 && !shalim.arpMode) shalimStartChord(shalim.held);
                return;
            }
        }
    }
    const pad = shalimPadAt(x, y);
    if (pad < 0) {
        // Slid off the pad row while dragging
        if (shalim.held >= 0 && dragging && !shalim.hold) {
            shalim.held = -1;
            shalimReleaseChord(1.4);
        }
        return;
    }
    // In Hold mode, tapping the same pad releases; else switches
    if (shalim.hold && !dragging && pad === shalim.voice?.padIdx && !shalim.arpMode) {
        shalim.held = -1;
        shalimReleaseChord(1.6);
        return;
    }
    if (pad !== shalim.held) {
        shalim.held = pad;
        shalim.uniqueChords.add(pad);
        if (shalim.arpMode) shalimStartArp(pad);
        else                 shalimStartChord(pad);
    }
}

function shalimStartArp(padIdx) {
    const { bass, notes } = shalimChordFreqs(padIdx);
    // Build an arpeggio pattern: bass, notes ascending, top note, descending
    const asc = [bass, ...notes];
    shalim.arpNotes = asc.concat(notes.slice(0, -1).reverse());
    shalim.arpStep = 0;
    shalim.arpStepTimer = 0;
    shalim.arpPad = padIdx;
}

function shalimHandleRelease() {
    if (shalim.arpMode) {
        // Arp keeps playing until another pad is tapped or arp is turned off
        return;
    }
    if (shalim.held >= 0) {
        shalim.held = -1;
        if (!shalim.hold) shalimReleaseChord(2.0);
    }
}

function renderShalim(ctx, w, h) {
    // Warm deep-lavender background with a subtle top glow
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#120824');
    bg.addColorStop(0.55, '#1A0C30');
    bg.addColorStop(1, '#0A0418');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // --- Top bar (title + minimal readout) ---
    ctx.fillStyle = '#D4A534';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('SHALIM-KORO', 18, 26);
    ctx.fillStyle = 'rgba(220,200,240,0.55)';
    ctx.font = '11px sans-serif';
    ctx.fillText('canto armonico', 18, 42);

    // Countdown + held seconds on the right
    const remain = Math.max(0, 1 - shalim.t / SHALIM_DURATION_TICKS);
    const seconds = Math.floor(shalim.heldFrames / 60);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(remain * 90)}s · ${seconds}s · ${shalim.uniqueChords.size}/7`, w - 18, 26);

    // Use geometry computed in shalimComputeGeometry (called from touch too)
    shalimComputeGeometry(w, h);
    // Label lookups — kinds are in the same order as computeGeometry
    const labelFor = (kind) => {
        switch (kind) {
            case 'mode': return SHALIM_MODE_NAMES[shalim.modeIdx];
            case 'ext':  return ['triade', '+ 7', '+ 7 · 9'][shalim.extension];
            case 'bri':  return shalim.brightness > 0.5 ? 'brillante' : 'morbido';
            case 'oct':  return shalim.octave === 0 ? 'oct · 0' : (shalim.octave > 0 ? 'oct · +' + shalim.octave : 'oct · ' + shalim.octave);
            case 'hold': return shalim.hold ? '● hold' : '○ hold';
            case 'arp':  return shalim.arpMode ? '▶ arp' : '  arp';
        }
        return kind;
    };
    const activeFor = (kind) => {
        if (kind === 'hold') return shalim.hold;
        if (kind === 'arp')  return shalim.arpMode;
        if (kind === 'oct')  return shalim.octave !== 0;
        if (kind === 'bri')  return shalim.brightness > 0.5;
        if (kind === 'ext')  return shalim.extension > 0;
        return false;
    };
    for (const t of shalim.toggleRects) {
        const isActive = activeFor(t.kind);
        ctx.fillStyle = isActive ? 'rgba(212,165,52,0.20)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(t.x, t.y, t.w, t.h);
        ctx.strokeStyle = isActive ? 'rgba(255,232,153,0.9)' : 'rgba(212,165,52,0.35)';
        ctx.lineWidth = isActive ? 1.5 : 1;
        ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
        ctx.fillStyle = isActive ? '#FFE899' : 'rgba(255,232,176,0.85)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelFor(t.kind), t.x + t.w / 2, t.y + t.h / 2 + 1);
    }
    ctx.textBaseline = 'alphabetic';

    // --- Chord pads row (Orchid-style) --- (geometry already computed above)
    const padCount = shalim.padRects.length;
    for (let i = 0; i < padCount; i++) {
        const { x: rx, y: ry, w: padW, h: padH } = shalim.padRects[i];

        const glow = shalim.glow[i];
        const held = shalim.held === i;
        // Hue scales across the row like a colour spectrum
        const hue = (230 + i * 20) % 360;

        // Halo — larger & softer when held
        if (glow > 0.05) {
            ctx.save();
            ctx.globalAlpha = glow * 0.6;
            const g2 = ctx.createRadialGradient(rx + padW / 2, ry + padH / 2, 4,
                                                rx + padW / 2, ry + padH / 2, padW * (1 + glow));
            g2.addColorStop(0, `hsla(${hue},80%,70%,0.9)`);
            g2.addColorStop(1, 'transparent');
            ctx.fillStyle = g2;
            ctx.fillRect(rx - padW, ry - padW, padW * 3, padH + padW * 2);
            ctx.restore();
        }

        // Pad body — soft rounded rectangle via layered rects
        const bodyColor = held
            ? `hsl(${hue}, 55%, ${36 + glow * 25}%)`
            : `hsl(${hue}, 30%, ${16 + glow * 8}%)`;
        ctx.fillStyle = bodyColor;
        ctx.fillRect(rx, ry, padW, padH);

        // Inner face
        ctx.fillStyle = held
            ? `hsl(${hue}, 60%, ${48 + glow * 20}%)`
            : `hsl(${hue}, 35%, ${24 + glow * 6}%)`;
        ctx.fillRect(rx + 2, ry + 2, padW - 4, padH - 4);

        // Top highlight line (one pixel)
        ctx.fillStyle = `hsla(${hue},80%,${held ? 85 : 55}%,${0.45 + glow * 0.45})`;
        ctx.fillRect(rx + 2, ry + 2, padW - 4, 1);
        // Bottom shadow line
        ctx.fillStyle = `rgba(0,0,0,${held ? 0.15 : 0.35})`;
        ctx.fillRect(rx + 2, ry + padH - 3, padW - 4, 1);

        // Roman numeral — big and centred
        const label = SHALIM_LABELS[i];
        ctx.fillStyle = held ? '#FFFDF2' : `hsla(${hue},50%,${72 + glow * 15}%,${0.55 + glow * 0.4})`;
        const fontSize = Math.min(48, padW * 0.5);
        ctx.font = `bold ${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, rx + padW / 2, ry + padH * 0.42);
        ctx.textBaseline = 'alphabetic';

        // Held outline
        if (held || glow > 0.1) {
            ctx.strokeStyle = `hsla(${hue},85%,80%,${glow})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(rx + 1, ry + 1, padW - 2, padH - 2);
        }

        // Ascending motes when held (visible "voice")
        if (held) {
            for (let k = 0; k < 3; k++) {
                const phase = (shalim.t * 0.8 + k * 60) % 200;
                const life = 1 - phase / 200;
                if (life <= 0) continue;
                const mx = rx + padW / 2 + Math.sin((shalim.t + k * 10) * 0.06) * padW * 0.25;
                const my = ry + padH - 8 - phase * 0.9;
                ctx.globalAlpha = life * 0.8;
                ctx.fillStyle = `hsl(${hue},85%,85%)`;
                ctx.fillRect(Math.round(mx), Math.round(my), 3, 3);
            }
            ctx.globalAlpha = 1;
        }
    }

    // Hint line on first use
    if (shalim.uniqueChords.size === 0 && shalim.t < 300) {
        ctx.fillStyle = 'rgba(212,165,52,0.75)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('tieni premuto un pad — scorri per cambiare accordo', w / 2, h - 8);
    }
}

// ---------------------------------------------------------------------------
// VYTHI-PULSE — step sequencer. 8 steps × 3 tracks (kick, chime, bell).
// Tap a cell to toggle it; the grid plays in a loop at 90 BPM. 75s total.
// Score = unique cells activated (encourages composition).
// ---------------------------------------------------------------------------
const VYTHI_STEPS = 8;
const VYTHI_TRACKS = 3;
const VYTHI_BPM = 90;
const VYTHI_STEP_SEC = 60 / VYTHI_BPM / 2;   // 8th notes
const VYTHI_DURATION_TICKS = 75 * 60;
let vythi = {
    t: 0,
    grid: null,
    step: 0,
    stepTimer: 0,
    uniqueToggles: 0,
};

function vythiInit() {
    vythi.t = 0; vythi.step = 0; vythi.stepTimer = 0; vythi.uniqueToggles = 0;
    vythi.grid = Array.from({ length: VYTHI_TRACKS }, () => new Array(VYTHI_STEPS).fill(false));
    ambStartPad(98);  // G2 pad
}

function vythiPlayStep() {
    const ctx = ensureAmbAwake();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let tr = 0; tr < VYTHI_TRACKS; tr++) {
        if (!vythi.grid[tr][vythi.step]) continue;
        if (tr === 0) {
            // Kick — sine thump with pitch drop
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.setValueAtTime(120, t);
            o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.3, t + 0.005);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
            o.connect(g).connect(_ambMaster);
            o.start(t); o.stop(t + 0.25);
        } else if (tr === 1) {
            // Chime — FM blip in pentatonic C
            const hz = [523.25, 587.33, 659.25, 784.00][vythi.step % 4];
            ambPluck(hz, 0.8, 'triangle', 0.14);
        } else {
            // Bell — high crystalline sine
            const hz = [1046.5, 1318.5, 1567.98, 1760.0][vythi.step % 4];
            ambPluck(hz, 1.2, 'sine', 0.10);
        }
    }
}

function vythiUpdate() {
    vythi.t++;
    vythi.stepTimer += 1 / 60;
    if (vythi.stepTimer >= VYTHI_STEP_SEC) {
        vythi.stepTimer = 0;
        vythi.step = (vythi.step + 1) % VYTHI_STEPS;
        vythiPlayStep();
    }
}

function vythiHandleTouch(x, y, dragging, vw, vh) {
    if (dragging) return;
    vw = vw || 800; vh = vh || 400;
    const marginX = 30;
    const gridW = vw - marginX * 2;
    const marginY = 80;
    const gridH = vh * 0.55;
    if (y < marginY || y > marginY + gridH) return;
    if (x < marginX || x > marginX + gridW) return;
    const col = Math.min(VYTHI_STEPS - 1, Math.floor((x - marginX) / (gridW / VYTHI_STEPS)));
    const row = Math.min(VYTHI_TRACKS - 1, Math.floor((y - marginY) / (gridH / VYTHI_TRACKS)));
    const was = vythi.grid[row][col];
    vythi.grid[row][col] = !was;
    if (!was) vythi.uniqueToggles++;
    // Audition the cell immediately
    const saved = vythi.step;
    vythi.step = col;
    if (vythi.grid[row][col]) vythiPlayStep();
    vythi.step = saved;
}

function renderVythi(ctx, w, h) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#081420');
    bg.addColorStop(1, '#183050');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Title
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pulsi di Luce — 90 BPM', w / 2, 30);

    // Track labels
    const labels = ['kick', 'chime', 'bell'];
    const marginX = 30;
    const gridW = w - marginX * 2;
    const marginY = 80;
    const gridH = h * 0.55;
    const stepW = gridW / VYTHI_STEPS;
    const trackH = gridH / VYTHI_TRACKS;

    for (let tr = 0; tr < VYTHI_TRACKS; tr++) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(labels[tr], marginX - 6, marginY + tr * trackH + trackH / 2 + 4);
    }

    // Cells
    for (let tr = 0; tr < VYTHI_TRACKS; tr++) {
        for (let st = 0; st < VYTHI_STEPS; st++) {
            const x = marginX + st * stepW + 2;
            const y = marginY + tr * trackH + 2;
            const cellW = stepW - 4;
            const cellH = trackH - 4;
            const on = vythi.grid[tr][st];
            const active = vythi.step === st;
            const hue = [0, 200, 60][tr] + (active ? 0 : 0);
            const sat = on ? 70 : 12;
            const light = on ? (active ? 72 : 55) : (active ? 25 : 12);
            ctx.fillStyle = `hsl(${hue},${sat}%,${light}%)`;
            ctx.fillRect(x, y, cellW, cellH);
            ctx.strokeStyle = active ? '#FFFFFF' : 'rgba(255,255,255,0.08)';
            ctx.lineWidth = active ? 2 : 1;
            ctx.strokeRect(x, y, cellW, cellH);
            if (on) {
                // inner glow pixel
                ctx.fillStyle = 'rgba(255,255,255,0.6)';
                ctx.fillRect(x + cellW * 0.4, y + cellH * 0.4, cellW * 0.2, cellH * 0.2);
            }
        }
    }

    // Step indicator (bottom)
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(marginX + vythi.step * stepW, marginY + gridH + 6, stepW - 4, 3);

    // Progress
    const remain = Math.max(0, 1 - vythi.t / VYTHI_DURATION_TICKS);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.ceil(remain * 75)}s · ${vythi.uniqueToggles} celle`, w - 16, 54);
}

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
            case GameType.TETRIS_KORA: tetInit(); break;
            case GameType.PACMAN_LALI: pacInit(); break;
            case GameType.KORIMA_HARP: harpInit(); break;
            case GameType.VITH_BREATH: breathInit(); break;
            case GameType.THI_SING: thiInit(); break;
            case GameType.SHALIM_KORO: shalimInit(); break;
            case GameType.VYTHI_PULSE: vythiInit(); break;
        }
        // Duck the stage ambient while a synth/music minigame is running so
        // the keeper's instrument takes the foreground. Classics (Tetris /
        // Pac-Lalì) keep the full ambient bed.
        const synthGames = new Set([
            GameType.KORIMA_HARP, GameType.VITH_BREATH, GameType.THI_SING,
            GameType.SHALIM_KORO, GameType.VYTHI_PULSE,
        ]);
        if (synthGames.has(type)) {
            try { SoundEngine.duckAmbient && SoundEngine.duckAmbient(0.08, 700); } catch (_) {}
        }
    },

    endGame() {
        if (!_playing) return null;
        _playing = false;
        // Restore the stage ambient bed whenever a minigame ends (harmless
        // if we weren't ducked — linearRamp back to 1.0 is a no-op).
        try { SoundEngine.unduckAmbient && SoundEngine.unduckAmbient(1500); } catch (_) {}

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
            case GameType.TETRIS_KORA:
                result = {
                    score: tet.score,
                    nashiBonus: Math.min(10, tet.lines * 1.2),
                    cognitionBonus: Math.min(18, tet.score * 0.008),
                    curiosityBonus: Math.min(8, tet.lines * 0.8),
                    affectionBonus: 0,
                    miskaBonus: 0,
                    cosmicBonus: 0,
                    securityBonus: Math.min(6, tet.lines * 0.6),
                    mokoCost: 6,
                    vocabUnlock: Math.min(3, Math.floor(tet.lines / 4)),
                    interactionCount: 2,
                    triggersDream: tet.lines >= 10,
                };
                break;
            case GameType.PACMAN_LALI:
                result = {
                    score: pac.score,
                    nashiBonus: Math.min(15, pac.score * 0.025),
                    cognitionBonus: Math.min(8, pac.score * 0.012),
                    curiosityBonus: Math.min(12, pac.score * 0.018),
                    affectionBonus: 0,
                    miskaBonus: 0,
                    cosmicBonus: 0,
                    securityBonus: pac.won ? 8 : Math.min(4, pac.score * 0.008),
                    mokoCost: 5,
                    vocabUnlock: pac.won ? 2 : (pac.score > 300 ? 1 : 0),
                    interactionCount: 3,
                    triggersDream: pac.won,
                };
                break;
            case GameType.KORIMA_HARP:
                ambStopPad();
                result = {
                    score: harp.notes,
                    nashiBonus: Math.min(14, harp.notes * 0.25),
                    cognitionBonus: Math.min(6, harp.notes * 0.1),
                    curiosityBonus: Math.min(6, harp.notes * 0.1),
                    affectionBonus: 6,
                    miskaBonus: 0,
                    cosmicBonus: Math.min(14, harp.notes * 0.22),
                    securityBonus: Math.min(12, harp.notes * 0.18),
                    mokoCost: -6,                            // restful: restores energy
                    vocabUnlock: Math.min(2, Math.floor(harp.notes / 12)),
                    interactionCount: 2,
                    triggersDream: harp.notes >= 20,
                };
                break;
            case GameType.VITH_BREATH:
                breathStopVoice();
                result = {
                    score: breath.score,
                    nashiBonus: Math.min(8, breath.score * 0.02),
                    cognitionBonus: 0,
                    curiosityBonus: 0,
                    affectionBonus: Math.min(8, breath.score * 0.015),
                    miskaBonus: 0,
                    cosmicBonus: Math.min(14, breath.score * 0.03),
                    securityBonus: Math.min(20, breath.score * 0.04),
                    mokoCost: -10,
                    vocabUnlock: Math.min(2, Math.floor(breath.score / 150)),
                    interactionCount: 2,
                    triggersDream: breath.score >= 400,
                };
                break;
            case GameType.THI_SING:
                thiStopVoice();
                ambStopPad();
                result = {
                    score: thi.notes,
                    nashiBonus: Math.min(14, thi.notes * 0.15),
                    cognitionBonus: Math.min(8, thi.notes * 0.08),
                    curiosityBonus: Math.min(10, thi.notes * 0.1),
                    affectionBonus: 4,
                    miskaBonus: 0,
                    cosmicBonus: Math.min(12, thi.notes * 0.12),
                    securityBonus: Math.min(6, thi.notes * 0.06),
                    mokoCost: -4,
                    vocabUnlock: Math.min(2, Math.floor(thi.notes / 20)),
                    interactionCount: 2,
                    triggersDream: thi.notes >= 30,
                };
                break;
            case GameType.SHALIM_KORO: {
                shalimReleaseChord(0.3);
                const heldSec = Math.floor(shalim.heldFrames / 60);
                result = {
                    score: heldSec,
                    nashiBonus: Math.min(14, heldSec * 0.25),
                    cognitionBonus: Math.min(10, heldSec * 0.2),
                    curiosityBonus: Math.min(6, shalim.uniqueChords.size * 0.8),
                    affectionBonus: 4,
                    miskaBonus: 0,
                    cosmicBonus: Math.min(14, heldSec * 0.22),
                    securityBonus: Math.min(10, heldSec * 0.15),
                    mokoCost: -5,
                    vocabUnlock: Math.min(2, Math.floor(shalim.uniqueChords.size / 3)),
                    interactionCount: 2,
                    triggersDream: heldSec >= 40,
                };
                break;
            }
            case GameType.VYTHI_PULSE:
                ambStopPad();
                result = {
                    score: vythi.uniqueToggles,
                    nashiBonus: Math.min(10, vythi.uniqueToggles * 0.4),
                    cognitionBonus: Math.min(10, vythi.uniqueToggles * 0.4),
                    curiosityBonus: Math.min(12, vythi.uniqueToggles * 0.5),
                    affectionBonus: 2,
                    miskaBonus: 0,
                    cosmicBonus: Math.min(5, vythi.uniqueToggles * 0.2),
                    securityBonus: 0,
                    mokoCost: -2,
                    vocabUnlock: Math.min(2, Math.floor(vythi.uniqueToggles / 8)),
                    interactionCount: 2,
                    triggersDream: vythi.uniqueToggles >= 16,
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
            case GameType.TETRIS_KORA: tetUpdate(); break;
            case GameType.PACMAN_LALI: pacUpdate(); break;
            case GameType.KORIMA_HARP: harpUpdate(); break;
            case GameType.VITH_BREATH: breathUpdate(); break;
            case GameType.THI_SING: thiUpdate(); break;
            case GameType.SHALIM_KORO: shalimUpdate(); break;
            case GameType.VYTHI_PULSE: vythiUpdate(); break;
        }
    },

    handleTouch(x, y, dragging, vw, vh) {
        if (!_playing) return;
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: echoHandleTouch(x, y, dragging); break;
            case GameType.LIGHT_CLEANSING: cleanHandleTouch(x, y, dragging); break;
            case GameType.STAR_JOY: starHandleTouch(x, y); break;
            case GameType.TETRIS_KORA: tetHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
            case GameType.PACMAN_LALI: pacHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
            case GameType.KORIMA_HARP: harpHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
            case GameType.VITH_BREATH: breathHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
            case GameType.THI_SING: thiHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
            case GameType.SHALIM_KORO: shalimHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
            case GameType.VYTHI_PULSE: vythiHandleTouch(x, y, dragging, vw || 800, vh || 400); break;
        }
    },

    handleRelease() {
        if (!_playing) return;
        if (_currentGame === GameType.THI_SING) thiHandleRelease();
        if (_currentGame === GameType.VITH_BREATH) breathHandleRelease && breathHandleRelease();
        if (_currentGame === GameType.TETRIS_KORA) tetHandleRelease();
        if (_currentGame === GameType.SHALIM_KORO) shalimHandleRelease();
    },

    /** Keyboard handler — returns true if key consumed. Call from screens.js */
    handleKey(ev) {
        if (!_playing) return false;
        switch (_currentGame) {
            case GameType.TETRIS_KORA: return tetHandleKey(ev);
            case GameType.PACMAN_LALI: return pacHandleKey(ev);
        }
        return false;
    },

    isGameOver() {
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: return echo.failed && echo.failTimer > 360;
            case GameType.LIGHT_CLEANSING: return clean.complete;
            case GameType.STAR_JOY: return star.sessionComplete;
            case GameType.TETRIS_KORA: return tet.over && tet.overTimer > 360;
            case GameType.PACMAN_LALI: return (pac.over || pac.won) && pac.overTimer > 360;
            case GameType.KORIMA_HARP: return harp.t >= HARP_DURATION_TICKS;
            case GameType.VITH_BREATH: return breath.t >= BREATH_DURATION_TICKS;
            case GameType.THI_SING: return thi.t >= THI_DURATION_TICKS;
            case GameType.SHALIM_KORO: return shalim.t >= SHALIM_DURATION_TICKS;
            case GameType.VYTHI_PULSE: return vythi.t >= VYTHI_DURATION_TICKS;
        }
        return false;
    },

    getScore() {
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: return echo.score;
            case GameType.LIGHT_CLEANSING: return clean.score;
            case GameType.STAR_JOY: return star.score;
            case GameType.TETRIS_KORA: return tet.score;
            case GameType.PACMAN_LALI: return pac.score;
            case GameType.KORIMA_HARP: return harp.notes;
            case GameType.VITH_BREATH: return breath.score;
            case GameType.THI_SING: return thi.notes;
            case GameType.SHALIM_KORO: return Math.floor(shalim.heldFrames / 60);
            case GameType.VYTHI_PULSE: return vythi.uniqueToggles;
        }
        return 0;
    },

    renderUpdate() { /* called by game-loop, actual rendering is in render() */ },

    render(ctx, w, h) {
        if (!_playing) return;
        switch (_currentGame) {
            case GameType.ECHO_MEMORY: renderEcho(ctx, w, h); break;
            case GameType.LIGHT_CLEANSING: renderClean(ctx, w, h); break;
            case GameType.STAR_JOY: renderStar(ctx, w, h); break;
            case GameType.TETRIS_KORA: renderTetris(ctx, w, h); break;
            case GameType.PACMAN_LALI: renderPacman(ctx, w, h); break;
            case GameType.KORIMA_HARP: renderHarp(ctx, w, h); break;
            case GameType.VITH_BREATH: renderBreath(ctx, w, h); break;
            case GameType.THI_SING: renderThi(ctx, w, h); break;
            case GameType.SHALIM_KORO: renderShalim(ctx, w, h); break;
            case GameType.VYTHI_PULSE: renderVythi(ctx, w, h); break;
        }
    },
};

// ---- Tetris renderer ----
function renderTetris(ctx, w, h) {
    ctx.fillStyle = '#0A1828';
    ctx.fillRect(0, 0, w, h);
    // Cell size must make the whole 10×20 grid fit inside the canvas with
    // room for the HUD. Constraints: cell * TET_COLS ≤ w * 0.55 (leave HUD on
    // the right) AND cell * TET_ROWS ≤ h * 0.92.
    const cell = Math.max(8, Math.floor(Math.min(w * 0.55 / TET_COLS, h * 0.92 / TET_ROWS)));
    const gridW = cell * TET_COLS, gridH = cell * TET_ROWS;
    const hudW = Math.min(140, w - gridW - 40);
    const ox = Math.max(12, Math.floor((w - gridW - hudW) / 2));
    const oy = Math.max(8, Math.floor((h - gridH) / 2));

    // Frame
    ctx.strokeStyle = '#3ECFCF';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox - 2, oy - 2, gridW + 4, gridH + 4);

    // Filled cells
    for (let y = 0; y < TET_ROWS; y++) {
        for (let x = 0; x < TET_COLS; x++) {
            const v = tet.grid[y][x];
            if (v) {
                ctx.fillStyle = v;
                ctx.fillRect(ox + x * cell, oy + y * cell, cell - 1, cell - 1);
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.fillRect(ox + x * cell, oy + y * cell, cell - 1, 2);
            } else if ((x + y) % 2 === 0) {
                ctx.fillStyle = 'rgba(62,207,207,0.03)';
                ctx.fillRect(ox + x * cell, oy + y * cell, cell - 1, cell - 1);
            }
        }
    }
    // Ghost piece — where the current piece will land if hard-dropped
    if (tet.piece != null && !tet.over) {
        let gy = tet.py;
        while (!tetCollides(tet.piece, tet.rot, tet.px, gy + 1)) gy++;
        const sh = TET_SHAPES[tet.piece];
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = sh.color;
        ctx.lineWidth = 1.5;
        for (const c of tetShapeCells(tet.piece, tet.rot)) {
            const gx = tet.px + c.x, gyy = gy + c.y;
            if (gyy < 0) continue;
            ctx.strokeRect(ox + gx * cell + 1.5, oy + gyy * cell + 1.5, cell - 4, cell - 4);
        }
        ctx.restore();
    }
    // Current piece
    if (tet.piece != null) {
        const sh = TET_SHAPES[tet.piece];
        for (const c of tetShapeCells(tet.piece, tet.rot)) {
            const gx = tet.px + c.x, gy = tet.py + c.y;
            if (gy < 0) continue;
            ctx.fillStyle = sh.color;
            ctx.fillRect(ox + gx * cell, oy + gy * cell, cell - 1, cell - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(ox + gx * cell, oy + gy * cell, cell - 1, 2);
            ctx.fillStyle = sh.colorDark;
            ctx.fillRect(ox + gx * cell, oy + gy * cell + cell - 3, cell - 1, 2);
        }
    }
    // HUD right side
    const hudX = ox + gridW + 18;
    ctx.fillStyle = '#D4A534';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Kòra-Tris', hudX, oy + 14);
    ctx.fillStyle = '#EAFBFB';
    ctx.font = '12px monospace';
    ctx.fillText(`Punteggio:`, hudX, oy + 40);
    ctx.fillText(`${tet.score}`, hudX, oy + 56);
    ctx.fillText(`Righe: ${tet.lines}`, hudX, oy + 80);
    // Next preview
    ctx.fillText('Prossimo:', hudX, oy + 110);
    const nsh = TET_SHAPES[tet.nextShape];
    if (nsh) {
        const prevCell = Math.floor(cell * 0.6);
        for (const c of tetShapeCells(tet.nextShape, 0)) {
            ctx.fillStyle = nsh.color;
            ctx.fillRect(hudX + c.x * prevCell, oy + 120 + c.y * prevCell, prevCell - 1, prevCell - 1);
        }
    }
    // Touch hints
    ctx.fillStyle = '#6AA8AC';
    ctx.font = '10px monospace';
    ctx.fillText('↑ ruota', hudX, oy + 200);
    ctx.fillText('← sinistra', hudX, oy + 215);
    ctx.fillText('→ destra', hudX, oy + 230);
    ctx.fillText('▼ giù veloce', hudX, oy + 245);

    if (tet.over) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(ox - 2, oy - 2, gridW + 4, gridH + 4);
        ctx.fillStyle = '#E05050';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', ox + gridW / 2, oy + gridH / 2 - 10);
        ctx.fillStyle = '#EAFBFB';
        ctx.font = '14px monospace';
        ctx.fillText(`${tet.score} punti — ${tet.lines} righe`, ox + gridW / 2, oy + gridH / 2 + 16);
        if (tet.overTimer > 60) {
            ctx.fillStyle = '#FFE899';
            ctx.fillText('Tocca per riprovare', ox + gridW / 2, oy + gridH / 2 + 44);
        }
    }
}

// ---- Pac-Lalì renderer ----
function renderPacman(ctx, w, h) {
    ctx.fillStyle = '#050A18';
    ctx.fillRect(0, 0, w, h);
    const cell = Math.min(Math.floor(w / PAC_COLS), Math.floor((h - 50) / PAC_ROWS));
    const gridW = cell * PAC_COLS, gridH = cell * PAC_ROWS;
    const ox = Math.floor((w - gridW) / 2);
    const oy = 36;

    for (let y = 0; y < PAC_ROWS; y++) {
        for (let x = 0; x < PAC_COLS; x++) {
            const v = pac.grid[y][x];
            const px = ox + x * cell, py = oy + y * cell;
            if (v === 1) {
                ctx.fillStyle = '#3060A8';
                ctx.fillRect(px, py, cell, cell);
                ctx.fillStyle = '#1A3070';
                ctx.fillRect(px, py + cell - 3, cell, 3);
                ctx.fillStyle = '#4080C8';
                ctx.fillRect(px, py, cell, 3);
            } else if (v === 2) {
                ctx.fillStyle = '#FFE899';
                const s = Math.max(2, cell / 8);
                ctx.fillRect(px + cell / 2 - s / 2, py + cell / 2 - s / 2, s, s);
            } else if (v === 3) {
                const blink = Math.sin(pac.frame * 0.2) > 0 ? '#FFFFFF' : '#FFE899';
                ctx.fillStyle = blink;
                ctx.beginPath();
                ctx.arc(px + cell / 2, py + cell / 2, cell / 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    // Fruit bonus (blinks, pulses)
    if (pac.fruit) {
        const fx = ox + pac.fruit.x * cell + cell / 2;
        const fy = oy + pac.fruit.y * cell + cell / 2;
        const pulse = Math.sin(pac.frame * 0.3) * 0.15 + 1;
        const expiring = pac.fruit.expiresAt - pac.frame < 120;
        if (!expiring || Math.sin(pac.frame * 0.8) > 0) {
            const colors = { kora: '#E05050', nashi: '#FFD86A', vythi: '#80E8C0' };
            ctx.fillStyle = colors[pac.fruit.kind] || '#FFD86A';
            ctx.beginPath();
            ctx.arc(fx, fy, (cell * 0.35) * pulse, 0, Math.PI * 2);
            ctx.fill();
            // Stem
            ctx.fillStyle = '#3A5A2E';
            ctx.fillRect(fx - 1, fy - cell * 0.4, 2, 3);
            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillRect(fx - cell * 0.2, fy - cell * 0.2, 2, 2);
            // Value text above
            ctx.fillStyle = '#FFE899';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('+' + pac.fruit.value, fx, fy - cell * 0.55);
        }
    }

    // Pet
    const pxx = ox + pac.pet.x * cell + cell / 2;
    const pyy = oy + pac.pet.y * cell + cell / 2;
    const mouthOpen = Math.abs(Math.sin(pac.frame * 0.15)) * 0.5 + 0.1;
    const angStart = mouthOpen * Math.PI + (pac.pet.dir * Math.PI / 2);
    const angEnd   = (2 * Math.PI - mouthOpen * Math.PI) + (pac.pet.dir * Math.PI / 2);
    ctx.fillStyle = pac.powerTimer > 0 ? '#FFE899' : '#EAFBFB';
    ctx.beginPath();
    ctx.moveTo(pxx, pyy);
    ctx.arc(pxx, pyy, cell / 2 - 2, angStart, angEnd);
    ctx.closePath();
    ctx.fill();

    // Ghosts
    for (const g of pac.ghosts) {
        const gxx = ox + g.x * cell + cell / 2;
        const gyy = oy + g.y * cell + cell / 2;
        const afraid = pac.powerTimer > 0;
        ctx.fillStyle = afraid ? '#6080FF' : g.color;
        ctx.beginPath();
        ctx.arc(gxx, gyy, cell / 2 - 2, Math.PI, 0);
        ctx.lineTo(gxx + cell / 2 - 2, gyy + cell / 2 - 2);
        // Wavy bottom
        const waveW = (cell - 4) / 4;
        for (let i = 0; i < 4; i++) {
            ctx.lineTo(gxx + cell / 2 - 2 - (i * 2 + 1) * waveW / 2, gyy + cell / 2 - 4 + (i % 2 ? 4 : 0));
        }
        ctx.lineTo(gxx - cell / 2 + 2, gyy + cell / 2 - 2);
        ctx.closePath();
        ctx.fill();
        // Eyes
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(gxx - cell * 0.18, gyy - 2, cell * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gxx + cell * 0.18, gyy - 2, cell * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = afraid ? '#E05050' : '#1A1A2E';
        ctx.beginPath(); ctx.arc(gxx - cell * 0.18, gyy - 2, cell * 0.06, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(gxx + cell * 0.18, gyy - 2, cell * 0.06, 0, Math.PI * 2); ctx.fill();
    }

    // HUD
    ctx.fillStyle = '#D4A534';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Pac-Lalì', 12, 22);
    ctx.fillStyle = '#EAFBFB';
    ctx.font = '12px monospace';
    ctx.fillText(`Punti: ${pac.score}`, 100, 22);
    ctx.fillText(`Restanti: ${pac.pelletsLeft}`, 200, 22);
    if (pac.powerTimer > 0) {
        ctx.fillStyle = '#FFE899';
        ctx.fillText(`Power: ${Math.ceil(pac.powerTimer / 60)}s`, 330, 22);
    }
    ctx.fillStyle = '#6AA8AC';
    ctx.font = '10px monospace';
    ctx.fillText('Trascina per cambiare direzione', w - 230, h - 12);

    if (pac.over || pac.won) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(0, oy, w, gridH);
        ctx.fillStyle = pac.won ? '#40C470' : '#E05050';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(pac.won ? 'HAI VINTO!' : 'MORAK TI HA PRESO', w / 2, oy + gridH / 2);
        ctx.fillStyle = '#EAFBFB';
        ctx.font = '14px monospace';
        ctx.fillText(`${pac.score} punti`, w / 2, oy + gridH / 2 + 24);
        if (pac.overTimer > 60) {
            ctx.fillStyle = '#FFE899';
            ctx.fillText('Tocca per riprovare', w / 2, oy + gridH / 2 + 48);
        }
    }
}

// ---- Minigame Renderers ----

const NODE_COLORS = ['#E07030', '#40C4C4', '#E0C040', '#A060E0', '#60E060', '#E060A0'];

function renderEcho(ctx, w, h) {
    const sx = w / 800, sy = h / 400;
    const s = Math.min(sx, sy);
    ctx.clearRect(0, 0, w, h);

    // Title + round
    ctx.fillStyle = '#D4A534';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Thishi-Revosh  ·  Round ${echo.rounds + 1}  ·  ${echo.seqLen} note`, w / 2, 22);

    // Bottom prompt text
    let prompt = '';
    let promptColor = '#7A8A9A';
    if (echo.failed) {
        if (echo.failTimer >= ECHO_RETRY_DELAY) {
            prompt = 'Tocca in qualsiasi punto per riprovare';
            promptColor = '#E0C070';
        } else {
            prompt = 'Sequenza interrotta...';
            promptColor = '#C04040';
        }
    } else if (echo.success) {
        prompt = 'Ko! Corretto!  Prossimo round...';
        promptColor = '#40C470';
    } else if (echo.phase === 'pause') {
        prompt = 'Guarda bene...';
    } else if (echo.phase === 'flash' || echo.phase === 'gap') {
        prompt = `Osserva la sequenza  (${echo.pbIndex + 1}/${echo.seqLen})`;
    } else if (echo.phase === 'input') {
        prompt = `Ripeti la sequenza  (${echo.playerPos}/${echo.seqLen})`;
        promptColor = '#3ECFCF';
    }
    if (prompt) {
        ctx.fillStyle = promptColor;
        ctx.font = '13px sans-serif';
        ctx.fillText(prompt, w / 2, h - 18);
    }

    // Progress dots row (one per node in sequence)
    const dotY = 42;
    const dotSize = 6;
    const gap = 14;
    const rowW = echo.seqLen * gap;
    for (let i = 0; i < echo.seqLen; i++) {
        const dx = w / 2 - rowW / 2 + i * gap + gap / 2;
        let fill = '#2A3A4A';
        if (echo.failed) fill = '#402020';
        else if (echo.success || echo.phase === 'input') {
            if (i < echo.playerPos) fill = '#40C470';
        } else if ((echo.phase === 'flash' || echo.phase === 'gap')) {
            if (i < echo.pbIndex) fill = 'rgba(212,165,52,0.6)';
            if (i === echo.pbIndex && echo.phase === 'flash') fill = '#D4A534';
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(dx, dotY, dotSize, 0, Math.PI * 2);
        ctx.fill();
    }

    // Nodes (6 around a circle)
    for (let i = 0; i < ECHO_NODE_COUNT; i++) {
        const nx = echo.nodeX[i] * sx;
        const ny = echo.nodeY[i] * sy;
        const lit = echo.litNode === i;
        const r = (lit ? 38 : 30) * s;

        // Soft outer halo when lit
        if (lit) {
            const halo = ctx.createRadialGradient(nx, ny, r * 0.6, nx, ny, r * 2.4);
            halo.addColorStop(0, NODE_COLORS[i] + 'AA');
            halo.addColorStop(1, NODE_COLORS[i] + '00');
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(nx, ny, r * 2.4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Main disk
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, Math.PI * 2);
        ctx.fillStyle = lit
            ? NODE_COLORS[i]
            : (echo.phase === 'input' ? `${NODE_COLORS[i]}66` : `${NODE_COLORS[i]}33`);
        ctx.fill();
        ctx.strokeStyle = lit ? '#FFFFFF' : NODE_COLORS[i];
        ctx.lineWidth = lit ? 3 : 2;
        ctx.stroke();

        // Inner highlight
        if (lit) {
            ctx.beginPath();
            ctx.arc(nx - r * 0.25, ny - r * 0.3, r * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fill();
        }
    }

    // Score badge (top-right, subtle)
    ctx.fillStyle = '#7A8A9A';
    ctx.textAlign = 'right';
    ctx.font = '11px monospace';
    ctx.fillText(`score ${echo.score}`, w - 10, 20);

    // Big success/fail text overlay
    if (echo.failed && echo.failTimer < ECHO_RETRY_DELAY) {
        ctx.fillStyle = '#C04040';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Sequenza interrotta', w / 2, h / 2 + 80);
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
