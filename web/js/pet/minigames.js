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

const GameType = { ECHO_MEMORY: 0, LIGHT_CLEANSING: 1, STAR_JOY: 2, TETRIS_KORA: 3, PACMAN_LALI: 4 };

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

function tetHandleTouch(x, y, dragging, vw, vh) {
    if (tet.over && tet.overTimer > 60) { tetInit(); return; }
    if (y < vh * 0.2) tetRotate();
    else if (x < vw * 0.33) tetMove(-1);
    else if (x > vw * 0.67) tetMove(1);
    else tetDrop();
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
        }
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
        }
    },
};

// ---- Tetris renderer ----
function renderTetris(ctx, w, h) {
    ctx.fillStyle = '#0A1828';
    ctx.fillRect(0, 0, w, h);
    const fieldW = Math.min(w * 0.55, h * 0.6);
    const cell = Math.floor(fieldW / TET_COLS);
    const gridW = cell * TET_COLS, gridH = cell * TET_ROWS;
    const ox = Math.floor((w - gridW) / 2) - Math.floor(w * 0.05);
    const oy = Math.floor((h - gridH) / 2);

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
