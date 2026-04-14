/**
 * sound-engine.js -- Procedural Web Audio sound engine for Lalien Companion.
 *
 * Design philosophy: in Echoa, everything is sound. We never load samples;
 * every SFX is synthesized on demand from sine/triangle oscillators, filtered
 * noise, FM/AM and short ADSR envelopes. Output routes through a master bus
 * (gain -> limiter -> destination) with a small convolution reverb send.
 *
 * Aesthetic: Studio-Ghibli-meets-ambient-drone. Organic. Cosmic. Alien.
 * Never arcade/8-bit. Favor sine, triangle, filtered noise, detune and LFOs.
 *
 * Module is mobile-safe: AudioContext is created lazily on first user gesture,
 * nodes are GC'd after each one-shot, ambient drone runs on a tiny graph.
 *
 * LocalStorage keys:
 *   lalien_sfx_enabled   '1'|'0'
 *   lalien_sfx_volume    '0'..'1' (string)
 */

const LS_ENABLED = 'lalien_sfx_enabled';
const LS_VOLUME  = 'lalien_sfx_volume';

let ctx = null;
let master = null;      // master GainNode (user volume)
let limiter = null;     // DynamicsCompressor acting as limiter
let revBus = null;      // GainNode sending into reverb
let reverb = null;      // ConvolverNode
let revOut = null;      // reverb output gain
let ambient = null;     // current ambient graph { stop(stage), nodes... }
let _enabled = true;
let _volume = 0.55;
let _reducedMotion = false;

// Critical need warning loop
let _critTimer = null;

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
function now() { return ctx ? ctx.currentTime : 0; }

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function loadPrefs() {
    const e = localStorage.getItem(LS_ENABLED);
    if (e !== null) _enabled = e === '1';
    const v = parseFloat(localStorage.getItem(LS_VOLUME));
    if (!isNaN(v)) _volume = clamp(v, 0, 1);
    try {
        _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { _reducedMotion = false; }
}
loadPrefs();

// Procedural impulse-response: exponentially-decaying noise, very slight low-pass
// texture via two summed octaves of noise for a warmer, more "cave-like" tail.
function buildImpulseResponse(seconds = 2.4, decay = 2.6) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        // simple low-pass on noise: running average of 3 samples
        let prev1 = 0, prev2 = 0;
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const raw = (Math.random() * 2 - 1);
            const filt = (raw + prev1 + prev2) / 3;
            prev2 = prev1; prev1 = filt;
            data[i] = filt * Math.pow(1 - t, decay);
        }
    }
    return ir;
}

// Envelope helper: schedules ADSR on a gain node.
function env(gain, t0, { a = 0.005, d = 0.08, s = 0.0, r = 0.15, peak = 1.0 } = {}) {
    const g = gain.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    const sustainLevel = Math.max(0.0001, peak * s);
    g.exponentialRampToValueAtTime(sustainLevel > 0.0001 ? sustainLevel : 0.0001, t0 + a + d);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d + r);
    return t0 + a + d + r;
}

// Create an oscillator with optional detune and frequency ramp.
function osc(type, freq, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    return o;
}

// Filtered noise source.
function noise(duration = 0.3) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
}

// Route a node to master (optionally with reverb send amount 0..1)
function connectOut(node, wetAmount = 0.15) {
    node.connect(master);
    if (wetAmount > 0 && revBus) {
        const send = ctx.createGain();
        send.gain.value = wetAmount;
        node.connect(send);
        send.connect(revBus);
    }
}

// Stop + disconnect a list of oscillators at time t.
function stopAll(nodes, t) {
    for (const n of nodes) {
        try { n.stop(t); } catch (_) {}
        setTimeout(() => { try { n.disconnect(); } catch (_) {} }, (t - now()) * 1000 + 200);
    }
}

// -----------------------------------------------------------------------------
// Core: init / resume / volume
// -----------------------------------------------------------------------------
function buildGraph() {
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = _enabled ? _volume : 0;

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    reverb = ctx.createConvolver();
    reverb.buffer = buildImpulseResponse(2.4, 2.6);
    revBus = ctx.createGain();
    revBus.gain.value = 1.0;
    revOut = ctx.createGain();
    revOut.gain.value = 0.38;
    revBus.connect(reverb);
    reverb.connect(revOut);
    revOut.connect(limiter);

    master.connect(limiter);
    limiter.connect(ctx.destination);
}

function ensureCtx() {
    if (ctx) return true;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC({ latencyHint: 'interactive' });
        buildGraph();
        return true;
    } catch (e) {
        console.warn('[SFX] AudioContext init failed', e);
        return false;
    }
}

function applyGain() {
    if (!master) return;
    const target = _enabled ? _volume : 0;
    master.gain.cancelScheduledValues(now());
    master.gain.linearRampToValueAtTime(target, now() + 0.08);
}

// -----------------------------------------------------------------------------
// Primitives for musical textures
// -----------------------------------------------------------------------------

// A single crystalline chime (bell-like, FM-flavored).
function chime(freq, { dur = 0.6, peak = 0.35, wet = 0.3, type = 'sine', modRatio = 3.01, modDepth = 0 } = {}) {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc(type, freq);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, wet);
    o.start(t0);
    if (modDepth > 0) {
        const mod = osc('sine', freq * modRatio);
        const modG = ctx.createGain();
        modG.gain.value = modDepth;
        mod.connect(modG).connect(o.frequency);
        mod.start(t0);
        mod.stop(t0 + dur + 0.2);
    }
    env(g, t0, { a: 0.005, d: dur * 0.3, s: 0.2, r: dur * 0.7, peak });
    o.stop(t0 + dur + 0.2);
}

// Quick tick (UI click), barely audible — sine pop with HPF.
function tick(freq = 2200, peak = 0.08) {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', freq);
    const g = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    o.connect(g).connect(hp);
    connectOut(hp, 0.05);
    env(g, t0, { a: 0.001, d: 0.02, s: 0.0, r: 0.04, peak });
    o.start(t0);
    o.stop(t0 + 0.08);
}

// Swept noise (wind, bubble, wash).
function whoosh({ dur = 0.4, freqStart = 2000, freqEnd = 500, q = 6, peak = 0.22, wet = 0.2 } = {}) {
    if (!ensureCtx()) return;
    const t0 = now();
    const n = noise(dur + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freqStart, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + dur);
    bp.Q.value = q;
    const g = ctx.createGain();
    n.connect(bp).connect(g);
    connectOut(g, wet);
    env(g, t0, { a: 0.01, d: dur * 0.3, s: 0.4, r: dur * 0.7, peak });
    n.start(t0);
    n.stop(t0 + dur + 0.1);
}

// Play a cluster of chimes forming a chord.
function chord(freqs, { dur = 1.0, peak = 0.25, wet = 0.4, type = 'sine', modDepth = 0 } = {}) {
    freqs.forEach((f, i) => {
        setTimeout(() => chime(f, { dur, peak: peak / Math.sqrt(freqs.length), wet, type, modDepth }), i * 18);
    });
}

// Sparkle: tiny random high-pitched chimes (fairy-dust).
function sparkle({ count = 5, lo = 1500, hi = 3200, peak = 0.12, wet = 0.5, spread = 400 } = {}) {
    if (!ensureCtx()) return;
    for (let i = 0; i < count; i++) {
        const f = lo + Math.random() * (hi - lo);
        setTimeout(() => chime(f, { dur: 0.45, peak, wet, modRatio: 2.01, modDepth: 1 }), i * spread * Math.random() / count + i * 30);
    }
}

// Formant pair: two bandpassed noise/osc blended to mimic a vowel.
// F1/F2 pairs approximate different alien vowels.
function formantBlip(f1, f2, { dur = 0.22, peak = 0.18, wet = 0.22, breathy = 0 } = {}) {
    if (!ensureCtx()) return;
    const t0 = now();
    const carrier = osc('sawtooth', f1 * 0.5);
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass'; bp1.frequency.value = f1; bp1.Q.value = 10;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = f2; bp2.Q.value = 12;
    const mix = ctx.createGain();
    const g = ctx.createGain();
    carrier.connect(bp1).connect(mix);
    carrier.connect(bp2).connect(mix);
    mix.connect(g);
    connectOut(g, wet);
    env(g, t0, { a: 0.01, d: dur * 0.3, s: 0.5, r: dur * 0.6, peak });
    carrier.start(t0); carrier.stop(t0 + dur + 0.1);

    if (breathy > 0) {
        const n = noise(dur + 0.1);
        const bpN = ctx.createBiquadFilter();
        bpN.type = 'bandpass'; bpN.frequency.value = (f1 + f2) / 2; bpN.Q.value = 2.5;
        const gN = ctx.createGain();
        n.connect(bpN).connect(gN);
        connectOut(gN, wet);
        env(gN, t0, { a: 0.005, d: dur * 0.2, s: 0.4, r: dur * 0.6, peak: peak * breathy });
        n.start(t0); n.stop(t0 + dur + 0.1);
    }
}

// -----------------------------------------------------------------------------
// Sound catalogue
// -----------------------------------------------------------------------------

// UI
function playClick()      { tick(2400, 0.06); }
function playToggle(on = true) {
    // Soft pitched tick - higher if turning on
    tick(on ? 1800 : 1200, 0.08);
    setTimeout(() => chime(on ? 1320 : 880, { dur: 0.18, peak: 0.12, wet: 0.25 }), 20);
}
function playToast() {
    // Gentle notification: two-note appoggiatura
    chime(1175, { dur: 0.35, peak: 0.16, wet: 0.4 });
    setTimeout(() => chime(1568, { dur: 0.45, peak: 0.14, wet: 0.45 }), 80);
}
function playSuccess() {
    // Quick, warm rising 3rd
    chord([784, 988, 1319], { dur: 0.6, peak: 0.22, wet: 0.4, modDepth: 1.5 });
}
function playScreenIn() {
    // Airy upward whoosh
    whoosh({ dur: 0.35, freqStart: 400, freqEnd: 2200, q: 3, peak: 0.15, wet: 0.3 });
}
function playScreenOut() {
    // Downward wash
    whoosh({ dur: 0.3, freqStart: 2000, freqEnd: 500, q: 3, peak: 0.13, wet: 0.3 });
}
function playTutorialTip(){ chime(1046, { dur: 0.35, peak: 0.22, wet: 0.25, type: 'sine' }); }
function playError() {
    if (!ensureCtx()) return;
    const t0 = now();
    // Minor dissonance: small 2nd interval
    const o1 = osc('triangle', 311); const o2 = osc('triangle', 329);
    const g = ctx.createGain();
    o1.connect(g); o2.connect(g);
    connectOut(g, 0.15);
    env(g, t0, { a: 0.003, d: 0.1, s: 0.2, r: 0.18, peak: 0.22 });
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + 0.35); o2.stop(t0 + 0.35);
}

// Login / cloud
function playLogin() {
    chord([523, 659, 784, 1046], { dur: 1.2, peak: 0.22, wet: 0.45, modDepth: 2 });
    setTimeout(() => sparkle({ count: 4, lo: 1800, hi: 3200, peak: 0.1, wet: 0.6 }), 400);
}
function playCloudSync() {
    tick(2600, 0.08);
    setTimeout(() => tick(3200, 0.07), 90);
}

// Pet actions
function playPoke() {
    chime(880, { dur: 0.32, peak: 0.28, wet: 0.3, modRatio: 2.01, modDepth: 6 });
}
function playCaress(combo = 1) {
    if (!ensureCtx()) return;
    const t0 = now();
    // Warm sine + vibrato + filtered purr noise
    const o = osc('sine', 440);
    const lfo = osc('sine', 5.5);
    const lfoG = ctx.createGain(); lfoG.gain.value = 4.0;
    lfo.connect(lfoG).connect(o.frequency);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.25);
    env(g, t0, { a: 0.04, d: 0.2, s: 0.6, r: 0.45, peak: 0.22 });
    o.start(t0); lfo.start(t0);
    o.stop(t0 + 0.9); lfo.stop(t0 + 0.9);

    // Soft noise "purr"
    const n = noise(0.7);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 1.2;
    const ng = ctx.createGain();
    n.connect(lp).connect(ng);
    connectOut(ng, 0.1);
    env(ng, t0, { a: 0.06, d: 0.2, s: 0.3, r: 0.35, peak: 0.12 });
    n.start(t0); n.stop(t0 + 0.8);

    if (combo >= 4) {
        // Floritura: small major chord on top
        setTimeout(() => chord([659, 784, 988, 1319], { dur: 1.1, peak: 0.18, wet: 0.5 }), 120);
    }
}
function playFeed() {
    if (!ensureCtx()) return;
    // ascending warm bleep 523 -> 784 + small liquid "drop"
    const t0 = now();
    const o = osc('triangle', 523);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.2);
    o.frequency.setValueAtTime(523, t0);
    o.frequency.exponentialRampToValueAtTime(784, t0 + 0.22);
    env(g, t0, { a: 0.005, d: 0.08, s: 0.3, r: 0.2, peak: 0.25 });
    o.start(t0); o.stop(t0 + 0.45);
    // liquid drop
    setTimeout(() => whoosh({ dur: 0.2, freqStart: 1400, freqEnd: 500, q: 9, peak: 0.12, wet: 0.25 }), 180);
}
function playSleep() {
    // Lullaby: 3 descending notes with long reverb + soft breath wash
    const notes = [880, 698, 523];
    notes.forEach((f, i) => setTimeout(() => chime(f, { dur: 0.9, peak: 0.2, wet: 0.6 }), i * 260));
    setTimeout(() => whoosh({ dur: 1.2, freqStart: 300, freqEnd: 120, q: 1.2, peak: 0.09, wet: 0.5 }), 100);
}
function playClean() {
    // Bubble: bandpass noise sweep, two quick bursts + tiny sparkle
    whoosh({ dur: 0.28, freqStart: 2600, freqEnd: 900, q: 8, peak: 0.2, wet: 0.15 });
    setTimeout(() => whoosh({ dur: 0.22, freqStart: 3000, freqEnd: 1200, q: 10, peak: 0.17, wet: 0.15 }), 160);
    setTimeout(() => sparkle({ count: 3, lo: 2400, hi: 4000, peak: 0.08, wet: 0.55, spread: 80 }), 280);
}
function playTalk() {
    // Short FM voice fragment + formant vowel
    if (!ensureCtx()) return;
    const t0 = now();
    const carrier = osc('triangle', 300);
    const mod = osc('sine', 600);
    const modG = ctx.createGain(); modG.gain.value = 80;
    mod.connect(modG).connect(carrier.frequency);
    const g = ctx.createGain();
    carrier.connect(g);
    connectOut(g, 0.25);
    carrier.frequency.setValueAtTime(300, t0);
    carrier.frequency.linearRampToValueAtTime(420, t0 + 0.12);
    carrier.frequency.linearRampToValueAtTime(260, t0 + 0.28);
    env(g, t0, { a: 0.01, d: 0.08, s: 0.5, r: 0.2, peak: 0.22 });
    carrier.start(t0); mod.start(t0);
    carrier.stop(t0 + 0.55); mod.stop(t0 + 0.55);
    setTimeout(() => formantBlip(700, 1300, { dur: 0.18, peak: 0.14, wet: 0.3, breathy: 0.4 }), 140);
}
function playMeditate() {
    if (!ensureCtx()) return;
    // Low drone + remote bell + slow-moving shimmer
    const t0 = now();
    const o1 = osc('sine', 110);
    const o2 = osc('sine', 164);
    const g = ctx.createGain();
    o1.connect(g); o2.connect(g);
    connectOut(g, 0.5);
    env(g, t0, { a: 0.4, d: 0.2, s: 0.5, r: 1.2, peak: 0.22 });
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + 2.0); o2.stop(t0 + 2.0);
    setTimeout(() => chime(1318, { dur: 1.4, peak: 0.18, wet: 0.7, modDepth: 3 }), 350);
    setTimeout(() => sparkle({ count: 3, lo: 2200, hi: 3800, peak: 0.08, wet: 0.7, spread: 350 }), 900);
}

// Play (minigame start)
function playGameWin() {
    chord([523, 659, 784, 1046, 1319], { dur: 1.1, peak: 0.24, wet: 0.45 });
    setTimeout(() => sparkle({ count: 6, lo: 1500, hi: 3600, peak: 0.12, wet: 0.6 }), 300);
}
function playGameLose() {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('triangle', 440);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.2);
    o.frequency.setValueAtTime(440, t0);
    o.frequency.exponentialRampToValueAtTime(196, t0 + 0.7);
    env(g, t0, { a: 0.005, d: 0.15, s: 0.4, r: 0.5, peak: 0.22 });
    o.start(t0); o.stop(t0 + 1.0);
}

// Level-up / generic small achievement
function playLevelUp() {
    const notes = [784, 988, 1175, 1568];
    notes.forEach((f, i) => setTimeout(() => chime(f, { dur: 0.4, peak: 0.22, wet: 0.3 }), i * 70));
}

// Heartbeat (for critical needs warning)
function playHeartbeat() {
    if (!ensureCtx()) return;
    const t0 = now();
    const beat = (at) => {
        const o = osc('sine', 60);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.05);
        env(g, at, { a: 0.005, d: 0.08, s: 0.0, r: 0.12, peak: 0.35 });
        o.start(at); o.stop(at + 0.25);
    };
    beat(t0);
    beat(t0 + 0.22);
}

// Subtle recurring warning when a need is critical. Two soft descending
// sines at low level with a touch of reverb — noticeable but not annoying.
function playNeedCritical() {
    if (!ensureCtx()) return;
    const t0 = now();
    const freqs = [392, 311]; // G4 -> Eb4 (minor third down: slightly anxious)
    freqs.forEach((f, i) => {
        const o = osc('sine', f);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.35);
        const at = t0 + i * 0.26;
        env(g, at, { a: 0.04, d: 0.08, s: 0.3, r: 0.4, peak: 0.11 });
        o.start(at); o.stop(at + 0.6);
    });
}

// Start/stop critical-need ambient alert loop (called by game loop).
function startCriticalAlert(intervalSec = 12) {
    if (!_enabled) return;
    stopCriticalAlert();
    _critTimer = setInterval(() => {
        if (_enabled && !_reducedMotion) playNeedCritical();
    }, intervalSec * 1000);
}
function stopCriticalAlert() {
    if (_critTimer) { clearInterval(_critTimer); _critTimer = null; }
}

// Hatch: crack + sweep + chord in C lydian (C E G B F#)
function playHatch() {
    if (!ensureCtx()) return;
    // Crack: short noise with bandpass high
    whoosh({ dur: 0.12, freqStart: 800, freqEnd: 3000, q: 4, peak: 0.3, wet: 0.2 });
    // Sweep ascending
    setTimeout(() => {
        const t0 = now();
        const o = osc('sawtooth', 120);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 2;
        const g = ctx.createGain();
        o.connect(lp).connect(g);
        connectOut(g, 0.4);
        o.frequency.setValueAtTime(120, t0);
        o.frequency.exponentialRampToValueAtTime(880, t0 + 0.9);
        env(g, t0, { a: 0.05, d: 0.3, s: 0.5, r: 0.5, peak: 0.18 });
        o.start(t0); o.stop(t0 + 1.3);
    }, 120);
    // Epiphanic chord C E G B F# (lydian)
    setTimeout(() => chord([523, 659, 784, 988, 1480], { dur: 1.8, peak: 0.28, wet: 0.6, modDepth: 2 }), 900);
    // First cry (little breathy formant blip)
    setTimeout(() => formantBlip(900, 2100, { dur: 0.35, peak: 0.18, wet: 0.5, breathy: 0.8 }), 1400);
    setTimeout(() => sparkle({ count: 6, lo: 2000, hi: 4000, peak: 0.12, wet: 0.7 }), 1100);
}

// Evolution: denser, pitched by destination stage.
function playEvolution(fromStage, toStage) {
    if (!ensureCtx()) return;
    const base = 261.63; // C4
    const ratio = Math.pow(2, (toStage || 1) / 7); // climb up with each stage
    const freqs = [1, 1.25, 1.5, 1.875, 2.25].map(r => base * ratio * r);
    chord(freqs, { dur: 1.8, peak: 0.26, wet: 0.6, modDepth: 3 });
    // Low swell
    const t0 = now();
    const o = osc('sine', base * ratio * 0.5);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.4);
    env(g, t0, { a: 0.25, d: 0.5, s: 0.5, r: 1.5, peak: 0.2 });
    o.start(t0); o.stop(t0 + 2.4);
    // Upward sweep + sparkle tail
    setTimeout(() => whoosh({ dur: 0.9, freqStart: 400, freqEnd: 3200, q: 2, peak: 0.14, wet: 0.55 }), 150);
    setTimeout(() => sparkle({ count: 7, lo: 1800, hi: 3800, peak: 0.12, wet: 0.7, spread: 220 }), 700);
}

// Death: slow descent, LPF closing.
function playDeath(deathType) {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', 330);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 3.5);
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.7);
    o.frequency.setValueAtTime(330, t0);
    o.frequency.exponentialRampToValueAtTime(82, t0 + 3.5);
    env(g, t0, { a: 0.2, d: 0.5, s: 0.6, r: 3.0, peak: 0.3 });
    o.start(t0); o.stop(t0 + 4.0);
    // Dissonant lower voice a semitone off for grief
    const o2 = osc('sine', 311);
    const g2 = ctx.createGain();
    o2.connect(g2);
    connectOut(g2, 0.6);
    o2.frequency.setValueAtTime(311, t0);
    o2.frequency.exponentialRampToValueAtTime(78, t0 + 3.5);
    env(g2, t0, { a: 0.3, d: 0.5, s: 0.5, r: 3.0, peak: 0.22 });
    o2.start(t0); o2.stop(t0 + 4.0);
}

// Rebirth: gentle rising pad — opposite curve of death.
function playRebirth() {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', 110);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t0);
    lp.frequency.exponentialRampToValueAtTime(3200, t0 + 3.0);
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.7);
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(523, t0 + 3.0);
    env(g, t0, { a: 0.8, d: 0.4, s: 0.7, r: 1.8, peak: 0.22 });
    o.start(t0); o.stop(t0 + 3.5);
    setTimeout(() => chord([523, 659, 784, 988], { dur: 2.2, peak: 0.18, wet: 0.75, modDepth: 1.5 }), 1400);
    setTimeout(() => sparkle({ count: 5, lo: 1600, hi: 3000, peak: 0.1, wet: 0.7, spread: 280 }), 2000);
}

// Transcendence: suspended ethereal chord, long fade.
function playTranscendence() {
    if (!ensureCtx()) return;
    chord([523, 659, 784, 988, 1175, 1568], { dur: 3.5, peak: 0.22, wet: 0.85, modDepth: 1.5 });
    setTimeout(() => chord([2093, 2637], { dur: 3.0, peak: 0.12, wet: 0.9 }), 600);
    setTimeout(() => sparkle({ count: 12, lo: 2400, hi: 5200, peak: 0.08, wet: 0.9, spread: 400 }), 1000);
}

// Chirp: short vocal-like blip played before TTS. Character evolves with stage.
// 0 Syrma: breathy whisper    1-2 Lali-na/shi: high FM squeak
// 3-4 Lali-ko/ren: formant blip (child vowel) 5 Lali-vox: formant adult
// 6 Lali-mere: lower formant + sparse          7 Lali-thishi: bell + harmonic shimmer
function playChirp(stage = 2) {
    if (!ensureCtx()) return;
    const t0 = now();
    stage = clamp(stage | 0, 0, 7);

    if (stage === 0) {
        // Breathy whisper: filtered noise + very faint sine
        const n = noise(0.28);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3.5;
        const gN = ctx.createGain();
        n.connect(bp).connect(gN);
        connectOut(gN, 0.3);
        env(gN, t0, { a: 0.01, d: 0.06, s: 0.4, r: 0.18, peak: 0.14 });
        n.start(t0); n.stop(t0 + 0.3);
        const o = osc('sine', 1100);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.2);
        env(g, t0, { a: 0.015, d: 0.05, s: 0.3, r: 0.12, peak: 0.05 });
        o.start(t0); o.stop(t0 + 0.22);
        return;
    }

    if (stage >= 3 && stage <= 6) {
        // Formant-pair vowel, lower for older stages
        // (formants approximate /i/ /e/ /a/ /o/ depending on stage parity)
        const formantTable = [
            null, null, null,
            [400, 2400],  // 3 - child /i/
            [550, 2100],  // 4 - adolescent /e/
            [700, 1800],  // 5 - adult /a/
            [600, 1400],  // 6 - elder /o/
        ];
        const [f1, f2] = formantTable[stage];
        formantBlip(f1, f2, { dur: 0.22, peak: 0.2, wet: 0.28, breathy: stage === 6 ? 0.5 : 0.2 });
        return;
    }

    if (stage === 7) {
        // Reverberant bell cluster
        chord([1568, 2093, 2637], { dur: 0.6, peak: 0.14, wet: 0.85, modDepth: 1.2 });
        return;
    }

    // Default (1..2): FM squeak, baby cub
    const base = clamp(1400 - stage * 140, 600, 1600);
    const carrier = osc('triangle', base);
    const mod = osc('sine', base * 2.01);
    const modG = ctx.createGain(); modG.gain.value = base * 0.25;
    mod.connect(modG).connect(carrier.frequency);
    const g = ctx.createGain();
    carrier.connect(g);
    connectOut(g, 0.2);
    carrier.frequency.setValueAtTime(base, t0);
    carrier.frequency.linearRampToValueAtTime(base * 1.15, t0 + 0.07);
    carrier.frequency.linearRampToValueAtTime(base * 0.95, t0 + 0.14);
    env(g, t0, { a: 0.005, d: 0.05, s: 0.4, r: 0.1, peak: 0.2 });
    carrier.start(t0); mod.start(t0);
    carrier.stop(t0 + 0.22); mod.stop(t0 + 0.22);
}

// Need-chip tap: timbre differs per need index so each feels distinct.
// 0 KORA hunger = low thud | 1 MOKO rest = soft lullaby note
// 2 MISKA hygiene = bubbly chime | 3 NASHI happy = major third
// 4 HEALTH = warm sine | 5 COGNITION = FM ping
// 6 AFFECTION = warm hum | 7 CURIOSITY = question-mark chirp
// 8 COSMIC = shimmering bell | 9 SECURITY = grounded low hum
function playNeedTap(level = 50, needIndex = -1) {
    if (!ensureCtx()) return;
    const bright = clamp(0.5 + level / 200, 0.5, 1.0); // 0.5..1.0
    if (needIndex < 0) {
        // Generic fallback
        chime(440 + level * 6, { dur: 0.25, peak: 0.18, wet: 0.22 });
        return;
    }
    switch (needIndex) {
        case 0: // KORA - hunger: low thud
            chime(165 * bright, { dur: 0.32, peak: 0.22, wet: 0.2, type: 'triangle', modDepth: 2 });
            break;
        case 1: // MOKO - rest: soft muted note
            chime(330 * bright, { dur: 0.45, peak: 0.16, wet: 0.5, type: 'sine' });
            break;
        case 2: // MISKA - hygiene: bubbly chime
            whoosh({ dur: 0.22, freqStart: 2200, freqEnd: 1400, q: 8, peak: 0.15, wet: 0.35 });
            setTimeout(() => chime(1760 * bright, { dur: 0.18, peak: 0.12, wet: 0.4 }), 40);
            break;
        case 3: // NASHI - happiness: minor->major appoggiatura
            chime(659 * bright, { dur: 0.28, peak: 0.18, wet: 0.3, modRatio: 3.01, modDepth: 1.5 });
            setTimeout(() => chime(784 * bright, { dur: 0.28, peak: 0.16, wet: 0.3 }), 60);
            break;
        case 4: // HEALTH: warm centered sine
            chime(523 * bright, { dur: 0.4, peak: 0.18, wet: 0.35, type: 'sine' });
            break;
        case 5: // COGNITION: FM ping
            chime(880 * bright, { dur: 0.26, peak: 0.2, wet: 0.25, type: 'sine', modRatio: 4.01, modDepth: 4 });
            break;
        case 6: // AFFECTION: warm hum (two close sines)
            chime(392 * bright, { dur: 0.5, peak: 0.14, wet: 0.4, type: 'sine' });
            setTimeout(() => chime(494 * bright, { dur: 0.45, peak: 0.12, wet: 0.4, type: 'sine' }), 40);
            break;
        case 7: // CURIOSITY: rising question
            chime(698 * bright, { dur: 0.22, peak: 0.18, wet: 0.25 });
            setTimeout(() => chime(988 * bright, { dur: 0.25, peak: 0.18, wet: 0.3 }), 70);
            break;
        case 8: // COSMIC: shimmering bell with sparkle
            chime(1319, { dur: 0.5, peak: 0.16, wet: 0.7, modRatio: 2.41, modDepth: 2.5 });
            setTimeout(() => sparkle({ count: 2, lo: 2400, hi: 3600, peak: 0.06, wet: 0.7, spread: 80 }), 40);
            break;
        case 9: // SECURITY: grounded low hum
            chime(110, { dur: 0.6, peak: 0.18, wet: 0.35, type: 'sine' });
            setTimeout(() => chime(220, { dur: 0.5, peak: 0.14, wet: 0.35, type: 'sine' }), 30);
            break;
        default:
            chime(440 + level * 6, { dur: 0.25, peak: 0.18, wet: 0.22 });
    }
}

// -----------------------------------------------------------------------------
// Minigame sounds
// -----------------------------------------------------------------------------

// Echo Memory: 6 nodes mapped to a hexatonic scale. Each node has its
// own tone (node-index 0..5 -> scale degree).
const ECHO_FREQS = [
    392.00,  // G4
    466.16,  // A#4
    554.37,  // C#5
    659.26,  // E5
    783.99,  // G5
    932.33,  // A#5
];
function playEchoNode(nodeIdx = 0, asPlayback = true) {
    const f = ECHO_FREQS[nodeIdx % ECHO_FREQS.length];
    // Playback tones slightly softer; player taps brighter with modDepth
    chime(f, {
        dur: asPlayback ? 0.45 : 0.32,
        peak: asPlayback ? 0.2 : 0.24,
        wet: 0.55,
        modRatio: 3.01,
        modDepth: asPlayback ? 1.5 : 2.5,
    });
}
function playEchoSuccess() {
    chord([659, 784, 988, 1319], { dur: 0.7, peak: 0.22, wet: 0.5, modDepth: 1.5 });
    setTimeout(() => sparkle({ count: 4, lo: 2000, hi: 3600, peak: 0.1, wet: 0.7 }), 180);
}
function playEchoFail() {
    if (!ensureCtx()) return;
    // Clustered dissonance — like a broken glass chime
    const t0 = now();
    [311, 330, 349].forEach(f => {
        const o = osc('triangle', f);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.4);
        env(g, t0, { a: 0.003, d: 0.12, s: 0.3, r: 0.35, peak: 0.16 });
        o.start(t0); o.stop(t0 + 0.55);
    });
}

// Light Cleansing: sparkle on each dust removed, a "flinch" on too-rough touch,
// and a joyous swell on completion.
function playCleanseSparkle() {
    const f = 1800 + Math.random() * 1400;
    chime(f, { dur: 0.18, peak: 0.1, wet: 0.6, modRatio: 2.01, modDepth: 1 });
}
function playCleanseFlinch() {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('triangle', 180);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.15);
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 0.25);
    env(g, t0, { a: 0.003, d: 0.08, s: 0.3, r: 0.2, peak: 0.22 });
    o.start(t0); o.stop(t0 + 0.35);
}
function playCleanseComplete() {
    chord([523, 659, 784, 1046], { dur: 1.2, peak: 0.22, wet: 0.55, modDepth: 1.5 });
    setTimeout(() => sparkle({ count: 6, lo: 2200, hi: 3800, peak: 0.1, wet: 0.75, spread: 200 }), 250);
}

// Star Joy (constellations): whoosh-trace when an edge completes,
// warm chord when a constellation is done, grand chord at session end.
function playStarEdge() {
    whoosh({ dur: 0.28, freqStart: 600, freqEnd: 2200, q: 3, peak: 0.13, wet: 0.5 });
    setTimeout(() => chime(1175 + Math.random() * 400, { dur: 0.25, peak: 0.14, wet: 0.6 }), 120);
}
function playStarSelect() {
    chime(1568, { dur: 0.18, peak: 0.12, wet: 0.4, modRatio: 2.01, modDepth: 1 });
}
function playStarConstellation() {
    chord([523, 659, 784, 988, 1175], { dur: 1.4, peak: 0.22, wet: 0.7, modDepth: 2 });
    setTimeout(() => sparkle({ count: 6, lo: 2200, hi: 4000, peak: 0.1, wet: 0.8, spread: 220 }), 300);
}
function playStarSessionComplete() {
    playTranscendence();
}

// STT feedback
function playMicOpen() {
    // Gentle upward arpeggio
    chime(587, { dur: 0.22, peak: 0.14, wet: 0.35 });
    setTimeout(() => chime(880, { dur: 0.28, peak: 0.14, wet: 0.4 }), 70);
}
function playMicClose() {
    chime(880, { dur: 0.2, peak: 0.12, wet: 0.35 });
    setTimeout(() => chime(587, { dur: 0.24, peak: 0.12, wet: 0.4 }), 70);
}
function playMicSuccess() {
    // Subtle ping
    chime(2093, { dur: 0.3, peak: 0.12, wet: 0.55, modRatio: 2.01, modDepth: 1 });
}

// LLM thinking: brief shimmer (cosmic thought bubble).
function playThinking() {
    sparkle({ count: 3, lo: 2400, hi: 3600, peak: 0.07, wet: 0.75, spread: 160 });
}

// -----------------------------------------------------------------------------
// Ambient drone per stage
// -----------------------------------------------------------------------------
// Per-stage ambient character. Stage 0 = womb / slow heartbeat pulse.
// Stage 7 = ethereal choir-like shimmer.
function stageAmbientSpec(stage) {
    const s = clamp(stage | 0, 0, 7);
    // Base frequency climbs a little per stage (55..90 Hz)
    const base = 55 * Math.pow(2, s / 14);
    // Each stage gets a chord (3 low sines) and filter color.
    return {
        freqs: [base, base * 1.5, base * 2.02],
        cutoff: 280 + s * 130,
        detune: 4 + s * 2,
        peak: 0.08,
        lfoRate: 0.04 + s * 0.012,   // subtle increase in motion
        filterLfo: 0.05 + s * 0.01,
        wombPulse: s === 0,          // slow heartbeat layer
        choir: s === 7,              // top shimmer layer
        stage: s,
    };
}

function startAmbient(stage = 0) {
    if (!_enabled || _reducedMotion) return;
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const spec = stageAmbientSpec(stage);

    // Fade out previous if present
    if (ambient) stopAmbient(0.8);

    const nodes = [];
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = spec.cutoff;
    lp.Q.value = 0.7;
    out.connect(lp);
    connectOut(lp, 0.55);

    // Slow filter LFO — makes the bed "breathe"
    const filtLfo = osc('sine', spec.filterLfo);
    const filtLfoG = ctx.createGain();
    filtLfoG.gain.value = Math.max(40, spec.cutoff * 0.25);
    filtLfo.connect(filtLfoG).connect(lp.frequency);
    filtLfo.start();
    nodes.push(filtLfo);

    spec.freqs.forEach((f, i) => {
        // Two detuned oscillators per voice for thickness
        for (let d = -1; d <= 1; d += 2) {
            const o = osc(i === 2 ? 'triangle' : 'sine', f, d * spec.detune + (i - 1) * spec.detune);
            const g = ctx.createGain();
            g.gain.value = spec.peak * (d === -1 ? 1.0 : 0.7);
            o.connect(g).connect(out);
            o.start();
            nodes.push(o);
        }

        // Slow LFO on detune for organic motion
        const lfo = osc('sine', spec.lfoRate + i * 0.015);
        const lfoG = ctx.createGain(); lfoG.gain.value = 3 + i;
        // Connect to the last added oscillator's detune - need to store ref
        const lastOsc = nodes[nodes.length - 1];
        if (lastOsc && lastOsc.detune) {
            lfo.connect(lfoG).connect(lastOsc.detune);
        }
        lfo.start();
        nodes.push(lfo);
    });

    // Stage-0 womb: low slow heartbeat pulse — LFO-triggered amplitude on a
    // very low sine. We emulate by using an oscillator LFO * gain modulation.
    if (spec.wombPulse) {
        const heart = osc('sine', 50);
        const hg = ctx.createGain();
        hg.gain.value = 0.0;
        const pulse = osc('sine', 0.9); // ~55 bpm
        const pulseG = ctx.createGain(); pulseG.gain.value = 0.09;
        pulse.connect(pulseG).connect(hg.gain);
        heart.connect(hg).connect(out);
        heart.start(); pulse.start();
        nodes.push(heart, pulse);
    }

    // Stage-7 choir shimmer: very high detuned sines with slow amplitude LFO
    if (spec.choir) {
        const chs = [1568, 2093, 2637];
        chs.forEach((f, i) => {
            const o = osc('sine', f, (i - 1) * 6);
            const g = ctx.createGain(); g.gain.value = 0.0;
            const amp = osc('sine', 0.07 + i * 0.02);
            const ampG = ctx.createGain(); ampG.gain.value = 0.012;
            amp.connect(ampG).connect(g.gain);
            o.connect(g).connect(out);
            o.start(); amp.start();
            nodes.push(o, amp);
        });
    }

    // Crossfade in
    const t0 = now();
    out.gain.cancelScheduledValues(t0);
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(1.0, t0 + 2.5);

    ambient = { nodes, out, stage };
}

function stopAmbient(fadeSeconds = 1.2) {
    if (!ambient || !ctx) return;
    const t0 = now();
    const { nodes, out } = ambient;
    try {
        out.gain.cancelScheduledValues(t0);
        out.gain.setValueAtTime(out.gain.value, t0);
        out.gain.exponentialRampToValueAtTime(0.0001, t0 + fadeSeconds);
    } catch (_) {}
    setTimeout(() => {
        for (const n of nodes) { try { n.stop(); n.disconnect(); } catch (_) {} }
        try { out.disconnect(); } catch (_) {}
    }, (fadeSeconds + 0.1) * 1000);
    ambient = null;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------
export const SoundEngine = {
    /** Initialize. Safe to call multiple times; AudioContext is lazy. */
    init() {
        loadPrefs();
        // Arm user-gesture auto-resume
        const resume = () => {
            this.resume();
            window.removeEventListener('pointerdown', resume, true);
            window.removeEventListener('keydown', resume, true);
            window.removeEventListener('touchstart', resume, true);
        };
        window.addEventListener('pointerdown', resume, true);
        window.addEventListener('keydown', resume, true);
        window.addEventListener('touchstart', resume, true);
    },

    /** Create/resume the AudioContext. Called on first user gesture. */
    resume() {
        if (!ensureCtx()) return;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
    },

    setEnabled(v) {
        _enabled = !!v;
        localStorage.setItem(LS_ENABLED, _enabled ? '1' : '0');
        applyGain();
        if (!_enabled) { stopAmbient(0.4); stopCriticalAlert(); }
    },
    isEnabled() { return _enabled; },

    setVolume(v) {
        _volume = clamp(Number(v) || 0, 0, 1);
        localStorage.setItem(LS_VOLUME, String(_volume));
        applyGain();
    },
    getVolume() { return _volume; },

    isReducedMotion() { return _reducedMotion; },

    // UI
    playClick,
    playToggle,
    playToast,
    playSuccess,
    playScreenIn,
    playScreenOut,
    playTutorialTip,
    playError,
    playLogin,
    playCloudSync,
    playNeedTap,

    // Pet actions
    playPoke,
    playCaress,
    playFeed,
    playSleep,
    playClean,
    playTalk,
    playMeditate,
    playChirp,

    // Games (generic)
    playGameWin,
    playGameLose,
    playLevelUp,
    playHeartbeat,

    // Minigame-specific
    playEchoNode,
    playEchoSuccess,
    playEchoFail,
    playCleanseSparkle,
    playCleanseFlinch,
    playCleanseComplete,
    playStarEdge,
    playStarSelect,
    playStarConstellation,
    playStarSessionComplete,

    // STT / AI
    playMicOpen,
    playMicClose,
    playMicSuccess,
    playThinking,

    // Lifecycle
    playHatch,
    playEvolution,
    playDeath,
    playRebirth,
    playTranscendence,

    // Need-critical alert loop
    playNeedCritical,
    startCriticalAlert,
    stopCriticalAlert,

    // Ambient
    startAmbient,
    stopAmbient,
};
