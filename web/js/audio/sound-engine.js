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
let chorusIn = null;    // subtle chorus send (voice warmth)
let ambient = null;     // current ambient graph
let _enabled = true;
let _volume = 0.55;
let _reducedMotion = false;

let _critTimer = null;

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------
function now() { return ctx ? ctx.currentTime : 0; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function rand(a, b) { return a + Math.random() * (b - a); }

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

// Procedural impulse-response: warmer, slightly longer for Ghibli cave tail.
function buildImpulseResponse(seconds = 2.8, decay = 2.4) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = ir.getChannelData(ch);
        let p1 = 0, p2 = 0, p3 = 0;
        for (let i = 0; i < len; i++) {
            const t = i / len;
            const raw = (Math.random() * 2 - 1);
            // 4-tap lowpass for softer tail
            const filt = (raw + p1 + p2 + p3) * 0.25;
            p3 = p2; p2 = p1; p1 = filt;
            // Early reflections cluster for first 40ms, then exp decay
            const early = t < 0.04 ? 1 + Math.sin(t * 600) * 0.3 : 1;
            data[i] = filt * early * Math.pow(1 - t, decay);
        }
    }
    return ir;
}

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

function osc(type, freq, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    return o;
}

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

// Pink-ish noise (warmer than white) via simple Voss-ish filter cascade.
function pinkNoise(duration = 0.3) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179;
        b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520;
        b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522;
        b5 = -0.7616*b5 - w*0.0168980;
        data[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
        b6 = w * 0.115926;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
}

function connectOut(node, wetAmount = 0.15) {
    node.connect(master);
    if (wetAmount > 0 && revBus) {
        const send = ctx.createGain();
        send.gain.value = wetAmount;
        node.connect(send);
        send.connect(revBus);
    }
}

// -----------------------------------------------------------------------------
// Core graph
// -----------------------------------------------------------------------------
function buildGraph() {
    if (!ctx) return;
    master = ctx.createGain();
    master.gain.value = _enabled ? _volume : 0;

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 10;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.14;

    reverb = ctx.createConvolver();
    reverb.buffer = buildImpulseResponse(2.8, 2.4);
    revBus = ctx.createGain();
    revBus.gain.value = 1.0;
    revOut = ctx.createGain();
    revOut.gain.value = 0.38;
    revBus.connect(reverb);
    reverb.connect(revOut);
    // IMPORTANT: the reverb WET must go through `master` so the user's
    // volume slider controls it. Previously `revOut.connect(limiter)`
    // bypassed the slider — anything with a reverb send (especially the
    // ambient bed at wet=0.85) stayed loud when the user lowered volume.
    revOut.connect(master);

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
// Primitives
// -----------------------------------------------------------------------------

// Bell-like chime with FM and gentle sine sub-layer for warmth.
function chime(freq, { dur = 0.6, peak = 0.35, wet = 0.3, type = 'sine', modRatio = 3.01, modDepth = 0, sub = 0 } = {}) {
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
    if (sub > 0) {
        const so = osc('sine', freq * 0.5);
        const sg = ctx.createGain();
        so.connect(sg);
        connectOut(sg, wet * 0.5);
        env(sg, t0, { a: 0.01, d: dur * 0.3, s: 0.25, r: dur * 0.6, peak: peak * sub });
        so.start(t0); so.stop(t0 + dur + 0.2);
    }
    env(g, t0, { a: 0.005, d: dur * 0.3, s: 0.2, r: dur * 0.7, peak });
    o.stop(t0 + dur + 0.2);
}

// Woody tick — tiny natural tap (UI click). Sine transient + highpassed noise pluck.
function woodTick(freq = 1800, peak = 0.09) {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', freq);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.08);
    env(g, t0, { a: 0.0008, d: 0.015, s: 0.0, r: 0.035, peak });
    o.frequency.setValueAtTime(freq * 1.6, t0);
    o.frequency.exponentialRampToValueAtTime(freq, t0 + 0.02);
    o.start(t0); o.stop(t0 + 0.06);

    const n = noise(0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    const ng = ctx.createGain();
    n.connect(hp).connect(ng);
    connectOut(ng, 0.04);
    env(ng, t0, { a: 0.0005, d: 0.008, s: 0.0, r: 0.02, peak: peak * 0.35 });
    n.start(t0); n.stop(t0 + 0.04);
}

function tick(freq = 2200, peak = 0.08) {
    woodTick(freq * 0.75, peak);
}

function whoosh({ dur = 0.4, freqStart = 2000, freqEnd = 500, q = 6, peak = 0.22, wet = 0.2, pink = false } = {}) {
    if (!ensureCtx()) return;
    const t0 = now();
    const n = pink ? pinkNoise(dur + 0.1) : noise(dur + 0.1);
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

function chord(freqs, { dur = 1.0, peak = 0.25, wet = 0.4, type = 'sine', modDepth = 0, stagger = 18, sub = 0 } = {}) {
    freqs.forEach((f, i) => {
        setTimeout(() => chime(f, { dur, peak: peak / Math.sqrt(freqs.length), wet, type, modDepth, sub }), i * stagger);
    });
}

function sparkle({ count = 5, lo = 1500, hi = 3200, peak = 0.12, wet = 0.5, spread = 400 } = {}) {
    if (!ensureCtx()) return;
    for (let i = 0; i < count; i++) {
        const f = lo + Math.random() * (hi - lo);
        setTimeout(() => chime(f, { dur: 0.45, peak, wet, modRatio: 2.01, modDepth: 1 }), i * spread * Math.random() / count + i * 30);
    }
}

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
// UI sounds -- polished, warmer, each with distinct timbre
// -----------------------------------------------------------------------------

function playClick() {
    // Tiny wooden tap — very short pitch drop sine + HP noise pluck
    woodTick(1900, 0.07);
}

function playToggle(on = true) {
    // On = rising 4th; Off = falling 4th. Soft marimba-like pluck.
    if (!ensureCtx()) return;
    const t0 = now();
    const [a, b] = on ? [659, 988] : [988, 659];
    [a, b].forEach((f, i) => {
        const o = osc('sine', f);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.25);
        const at = t0 + i * 0.055;
        env(g, at, { a: 0.002, d: 0.06, s: 0.15, r: 0.2, peak: 0.13 });
        // FM for pluckyness
        const m = osc('sine', f * 3.01);
        const mg = ctx.createGain(); mg.gain.value = 2.2;
        m.connect(mg).connect(o.frequency);
        o.start(at); m.start(at);
        o.stop(at + 0.3); m.stop(at + 0.3);
    });
}

function playToast() {
    // Gentle two-note appoggiatura — warm crystal tone
    chime(1175, { dur: 0.38, peak: 0.16, wet: 0.45, modRatio: 3.01, modDepth: 1.4 });
    setTimeout(() => chime(1568, { dur: 0.5, peak: 0.14, wet: 0.5, modRatio: 2.01, modDepth: 1.6 }), 85);
}

function playSuccess() {
    // Warm rising major triad with harmonic shimmer
    chord([784, 988, 1319], { dur: 0.7, peak: 0.22, wet: 0.45, modDepth: 1.8, stagger: 40, sub: 0.3 });
    setTimeout(() => sparkle({ count: 3, lo: 2200, hi: 3400, peak: 0.07, wet: 0.7, spread: 180 }), 180);
}

function playScreenIn() {
    whoosh({ dur: 0.4, freqStart: 380, freqEnd: 2400, q: 2.2, peak: 0.14, wet: 0.4, pink: true });
    setTimeout(() => chime(1568, { dur: 0.25, peak: 0.09, wet: 0.55 }), 220);
}

function playScreenOut() {
    whoosh({ dur: 0.35, freqStart: 2200, freqEnd: 400, q: 2.2, peak: 0.12, wet: 0.4, pink: true });
}

function playTutorialTip() {
    // Soft wooden bell — distinct from toast
    chime(1046, { dur: 0.5, peak: 0.18, wet: 0.4, modRatio: 2.76, modDepth: 2.5, sub: 0.25 });
}

function playError() {
    if (!ensureCtx()) return;
    const t0 = now();
    // Muted minor second — soft disappointment, not harsh
    const f1 = 277, f2 = 294;  // C#4 / D4
    [f1, f2].forEach((f, i) => {
        const o = osc('triangle', f);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1200;
        const g = ctx.createGain();
        o.connect(lp).connect(g);
        connectOut(g, 0.2);
        env(g, t0, { a: 0.005, d: 0.12, s: 0.25, r: 0.3, peak: 0.17 });
        o.start(t0); o.stop(t0 + 0.5);
    });
    // Small downward sigh
    setTimeout(() => whoosh({ dur: 0.22, freqStart: 900, freqEnd: 400, q: 3, peak: 0.08, wet: 0.25, pink: true }), 120);
}

// Login / cloud
function playLogin() {
    chord([523, 659, 784, 1046], { dur: 1.3, peak: 0.22, wet: 0.5, modDepth: 2, stagger: 55, sub: 0.35 });
    setTimeout(() => sparkle({ count: 5, lo: 1800, hi: 3400, peak: 0.1, wet: 0.7 }), 420);
}
function playCloudSync() {
    // Two soft pings rising — distinct from tick (no harshness)
    chime(1760, { dur: 0.2, peak: 0.08, wet: 0.55, modRatio: 2.01, modDepth: 1 });
    setTimeout(() => chime(2349, { dur: 0.22, peak: 0.07, wet: 0.6, modRatio: 2.01, modDepth: 1 }), 90);
}

// -----------------------------------------------------------------------------
// Pet actions
// -----------------------------------------------------------------------------
function playPoke() {
    // Soft poked-balloon/pillow: short FM chirp with tiny thump
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', 520);
    const mod = osc('sine', 520 * 5.1);
    const modG = ctx.createGain(); modG.gain.value = 55;
    mod.connect(modG).connect(o.frequency);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.28);
    o.frequency.setValueAtTime(520, t0);
    o.frequency.exponentialRampToValueAtTime(820, t0 + 0.05);
    o.frequency.exponentialRampToValueAtTime(640, t0 + 0.12);
    env(g, t0, { a: 0.002, d: 0.08, s: 0.15, r: 0.18, peak: 0.22 });
    o.start(t0); mod.start(t0);
    o.stop(t0 + 0.32); mod.stop(t0 + 0.32);
    // Low thump
    const thump = osc('sine', 90);
    const tg = ctx.createGain();
    thump.connect(tg);
    connectOut(tg, 0.1);
    env(tg, t0, { a: 0.002, d: 0.04, s: 0.0, r: 0.08, peak: 0.18 });
    thump.start(t0); thump.stop(t0 + 0.16);
}

function playCaress(combo = 1) {
    if (!ensureCtx()) return;
    const t0 = now();
    // Shimmering pad: two detuned sines + slow LFO + breathy purr
    const base = 440;
    const o1 = osc('sine', base, -7);
    const o2 = osc('sine', base, +9);
    const o3 = osc('triangle', base * 1.5, -4);
    const lfo = osc('sine', 4.8);
    const lfoG = ctx.createGain(); lfoG.gain.value = 3.5;
    lfo.connect(lfoG).connect(o1.frequency);
    lfo.connect(lfoG).connect(o2.frequency);
    const g = ctx.createGain();
    o1.connect(g); o2.connect(g); o3.connect(g);
    connectOut(g, 0.45);
    env(g, t0, { a: 0.08, d: 0.25, s: 0.55, r: 0.7, peak: 0.2 });
    o1.start(t0); o2.start(t0); o3.start(t0); lfo.start(t0);
    o1.stop(t0 + 1.2); o2.stop(t0 + 1.2); o3.stop(t0 + 1.2); lfo.stop(t0 + 1.2);

    // Purr: filtered pink noise pulsing gently
    const n = pinkNoise(1.0);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 1.4;
    const ng = ctx.createGain();
    const purrLfo = osc('sine', 18);
    const purrG = ctx.createGain(); purrG.gain.value = 0.035;
    purrLfo.connect(purrG).connect(ng.gain);
    n.connect(lp).connect(ng);
    connectOut(ng, 0.12);
    env(ng, t0, { a: 0.1, d: 0.25, s: 0.4, r: 0.5, peak: 0.09 });
    n.start(t0); purrLfo.start(t0);
    n.stop(t0 + 1.1); purrLfo.stop(t0 + 1.1);

    if (combo >= 4) {
        setTimeout(() => chord([659, 784, 988, 1319], { dur: 1.3, peak: 0.16, wet: 0.6, modDepth: 1.5, stagger: 45 }), 180);
    }
}

function playFeed() {
    // Warm satisfied bell: ascending triad with liquid drop + small munch hint
    if (!ensureCtx()) return;
    const t0 = now();
    // Soft warm bell
    const freqs = [523, 659, 784];
    freqs.forEach((f, i) => {
        const o = osc('sine', f);
        const m = osc('sine', f * 3.01);
        const mg = ctx.createGain(); mg.gain.value = 3;
        m.connect(mg).connect(o.frequency);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.35);
        const at = t0 + i * 0.06;
        env(g, at, { a: 0.003, d: 0.1, s: 0.25, r: 0.35, peak: 0.16 });
        o.start(at); m.start(at);
        o.stop(at + 0.6); m.stop(at + 0.6);
    });
    // Liquid drop — quick bandpass sweep
    setTimeout(() => whoosh({ dur: 0.18, freqStart: 1600, freqEnd: 500, q: 11, peak: 0.12, wet: 0.3 }), 200);
    // Tiny sparkle of satisfaction
    setTimeout(() => chime(1760, { dur: 0.22, peak: 0.08, wet: 0.6, modRatio: 2.01, modDepth: 1 }), 280);
}

function playSleep() {
    // Descending lullaby fragment: 4 soft notes with long reverb + breath wash
    const notes = [988, 784, 659, 523];
    notes.forEach((f, i) => setTimeout(() => chime(f, { dur: 1.0, peak: 0.18, wet: 0.7, modRatio: 2.01, modDepth: 1.2, sub: 0.3 }), i * 240));
    setTimeout(() => whoosh({ dur: 1.6, freqStart: 320, freqEnd: 100, q: 1.2, peak: 0.08, wet: 0.55, pink: true }), 150);
}

function playClean() {
    // Water sparkle: tiny liquid bubbles + high shimmer
    for (let i = 0; i < 3; i++) {
        setTimeout(() => whoosh({
            dur: 0.2 + Math.random() * 0.08,
            freqStart: 1800 + Math.random() * 1000,
            freqEnd: 800 + Math.random() * 400,
            q: 10, peak: 0.14, wet: 0.25,
        }), i * 110);
    }
    setTimeout(() => sparkle({ count: 4, lo: 2600, hi: 4200, peak: 0.08, wet: 0.65, spread: 90 }), 260);
    // Tiny liquid drop tail
    setTimeout(() => chime(2093, { dur: 0.28, peak: 0.07, wet: 0.7, modRatio: 2.01, modDepth: 1.5 }), 450);
}

function playTalk() {
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
    const t0 = now();
    // Tibetan bowl: low fundamental + 2 overtones + slow beat
    const f = 146;
    [1, 2.01, 3.04, 4.08].forEach((ratio, i) => {
        const o = osc('sine', f * ratio);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.6);
        env(g, t0, { a: 0.2 + i * 0.05, d: 0.3, s: 0.55, r: 1.8 - i * 0.15, peak: 0.14 / (1 + i * 0.6) });
        o.start(t0); o.stop(t0 + 2.8);
    });
    setTimeout(() => chime(1318, { dur: 1.6, peak: 0.12, wet: 0.75, modDepth: 2, sub: 0.2 }), 450);
    setTimeout(() => sparkle({ count: 3, lo: 2200, hi: 3800, peak: 0.06, wet: 0.8, spread: 400 }), 1000);
}

// -----------------------------------------------------------------------------
// Games / lifecycle (mostly preserved, slight polish)
// -----------------------------------------------------------------------------
function playGameWin() {
    chord([523, 659, 784, 1046, 1319], { dur: 1.2, peak: 0.24, wet: 0.5, modDepth: 1.5, sub: 0.3 });
    setTimeout(() => sparkle({ count: 7, lo: 1500, hi: 3800, peak: 0.12, wet: 0.65 }), 320);
}
function playGameLose() {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('triangle', 440);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t0);
    lp.frequency.exponentialRampToValueAtTime(400, t0 + 0.7);
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.3);
    o.frequency.setValueAtTime(440, t0);
    o.frequency.exponentialRampToValueAtTime(174, t0 + 0.8);
    env(g, t0, { a: 0.006, d: 0.18, s: 0.4, r: 0.6, peak: 0.2 });
    o.start(t0); o.stop(t0 + 1.1);
    // Supportive soft sigh
    setTimeout(() => whoosh({ dur: 0.4, freqStart: 600, freqEnd: 200, q: 2, peak: 0.06, wet: 0.3, pink: true }), 200);
}

function playLevelUp() {
    const notes = [784, 988, 1175, 1568];
    notes.forEach((f, i) => setTimeout(() => chime(f, { dur: 0.45, peak: 0.22, wet: 0.4, modDepth: 1.2, sub: 0.25 }), i * 75));
    setTimeout(() => sparkle({ count: 4, lo: 2200, hi: 3400, peak: 0.09, wet: 0.7 }), 380);
}

function playHeartbeat() {
    if (!ensureCtx()) return;
    const t0 = now();
    const beat = (at, vol = 0.35) => {
        const o = osc('sine', 60);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.05);
        env(g, at, { a: 0.005, d: 0.08, s: 0.0, r: 0.12, peak: vol });
        o.start(at); o.stop(at + 0.25);
    };
    beat(t0, 0.35);
    beat(t0 + 0.22, 0.28);
}

function playNeedCritical() {
    if (!ensureCtx()) return;
    const t0 = now();
    const freqs = [392, 311];
    freqs.forEach((f, i) => {
        const o = osc('sine', f);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.4);
        const at = t0 + i * 0.28;
        env(g, at, { a: 0.04, d: 0.08, s: 0.3, r: 0.45, peak: 0.11 });
        o.start(at); o.stop(at + 0.65);
    });
}

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

function playHatch() {
    if (!ensureCtx()) return;
    whoosh({ dur: 0.14, freqStart: 800, freqEnd: 3200, q: 4, peak: 0.3, wet: 0.25 });
    setTimeout(() => {
        const t0 = now();
        const o = osc('sawtooth', 120);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000; lp.Q.value = 2;
        const g = ctx.createGain();
        o.connect(lp).connect(g);
        connectOut(g, 0.5);
        o.frequency.setValueAtTime(120, t0);
        o.frequency.exponentialRampToValueAtTime(880, t0 + 0.9);
        env(g, t0, { a: 0.05, d: 0.3, s: 0.5, r: 0.5, peak: 0.18 });
        o.start(t0); o.stop(t0 + 1.3);
    }, 120);
    setTimeout(() => chord([523, 659, 784, 988, 1480], { dur: 2.0, peak: 0.28, wet: 0.7, modDepth: 2, sub: 0.4 }), 900);
    setTimeout(() => formantBlip(900, 2100, { dur: 0.35, peak: 0.18, wet: 0.55, breathy: 0.8 }), 1400);
    setTimeout(() => sparkle({ count: 8, lo: 2000, hi: 4200, peak: 0.12, wet: 0.75 }), 1100);
}

function playEvolution(fromStage, toStage) {
    if (!ensureCtx()) return;
    const base = 261.63;
    const ratio = Math.pow(2, (toStage || 1) / 7);
    const freqs = [1, 1.25, 1.5, 1.875, 2.25].map(r => base * ratio * r);
    chord(freqs, { dur: 2.0, peak: 0.26, wet: 0.65, modDepth: 3, sub: 0.35 });
    const t0 = now();
    const o = osc('sine', base * ratio * 0.5);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.5);
    env(g, t0, { a: 0.25, d: 0.5, s: 0.5, r: 1.8, peak: 0.22 });
    o.start(t0); o.stop(t0 + 2.6);
    setTimeout(() => whoosh({ dur: 1.0, freqStart: 400, freqEnd: 3400, q: 2, peak: 0.14, wet: 0.6, pink: true }), 150);
    setTimeout(() => sparkle({ count: 9, lo: 1800, hi: 4200, peak: 0.12, wet: 0.75, spread: 220 }), 700);
}

function playDeath(deathType) {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', 330);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 3.5);
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.75);
    o.frequency.setValueAtTime(330, t0);
    o.frequency.exponentialRampToValueAtTime(82, t0 + 3.5);
    env(g, t0, { a: 0.2, d: 0.5, s: 0.6, r: 3.0, peak: 0.3 });
    o.start(t0); o.stop(t0 + 4.0);
    const o2 = osc('sine', 311);
    const g2 = ctx.createGain();
    o2.connect(g2);
    connectOut(g2, 0.7);
    o2.frequency.setValueAtTime(311, t0);
    o2.frequency.exponentialRampToValueAtTime(78, t0 + 3.5);
    env(g2, t0, { a: 0.3, d: 0.5, s: 0.5, r: 3.0, peak: 0.22 });
    o2.start(t0); o2.stop(t0 + 4.0);
}

function playRebirth() {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('sine', 110);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t0);
    lp.frequency.exponentialRampToValueAtTime(3200, t0 + 3.0);
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.75);
    o.frequency.setValueAtTime(110, t0);
    o.frequency.exponentialRampToValueAtTime(523, t0 + 3.0);
    env(g, t0, { a: 0.8, d: 0.4, s: 0.7, r: 1.8, peak: 0.22 });
    o.start(t0); o.stop(t0 + 3.5);
    setTimeout(() => chord([523, 659, 784, 988], { dur: 2.4, peak: 0.18, wet: 0.8, modDepth: 1.5, sub: 0.3 }), 1400);
    setTimeout(() => sparkle({ count: 6, lo: 1600, hi: 3000, peak: 0.1, wet: 0.75, spread: 280 }), 2000);
}

function playTranscendence() {
    if (!ensureCtx()) return;
    chord([523, 659, 784, 988, 1175, 1568], { dur: 3.5, peak: 0.22, wet: 0.9, modDepth: 1.5, sub: 0.4 });
    setTimeout(() => chord([2093, 2637], { dur: 3.0, peak: 0.12, wet: 0.9 }), 600);
    setTimeout(() => sparkle({ count: 14, lo: 2400, hi: 5400, peak: 0.08, wet: 0.9, spread: 400 }), 1000);
}

// -----------------------------------------------------------------------------
// Voice palette (mood-aware, formant-based)
// -----------------------------------------------------------------------------
function voiceParams(stage) {
    const s = clamp(stage | 0, 0, 7);
    const table = [
        { p: 1.85, wet: 0.35, breathy: 0.8, jitterBase: 1.0 },
        { p: 1.75, wet: 0.30, breathy: 0.5, jitterBase: 0.7 },
        { p: 1.55, wet: 0.28, breathy: 0.35, jitterBase: 0.5 },
        { p: 1.35, wet: 0.28, breathy: 0.25, jitterBase: 0.4 },
        { p: 1.18, wet: 0.28, breathy: 0.18, jitterBase: 0.3 },
        { p: 1.00, wet: 0.30, breathy: 0.15, jitterBase: 0.25 },
        { p: 0.80, wet: 0.35, breathy: 0.45, jitterBase: 0.35 },
        { p: 0.95, wet: 0.80, breathy: 0.25, jitterBase: 0.2 },
    ];
    return table[s];
}

// Enhanced voiced syllable — richer formant chain (F1+F2+F3), contour jitter,
// optional creak/shimmer, dual carrier (saw + triangle) for body.
function voicedSyllable(stage, {
    base = 520,
    dur = 0.28,
    peak = 0.22,
    f1 = 700, f2 = 1700, f3 = 2800,
    contour = [{ t: 0, c: 0 }, { t: 1, c: 0 }],
    jitter = 1.0,
    vibratoHz = 0,
    vibratoCents = 18,
    breathyBoost = 0,
    wetBoost = 0,
    creak = 0,       // 0..1 low-frequency amplitude jitter (vocal fry)
    shimmer = 0,     // 0..1 add faint upper harmonic
} = {}) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    const rootFreq = base * vp.p;

    // Dual carrier: saw for formant drive + soft triangle for body
    const saw = osc('sawtooth', rootFreq);
    const tri = osc('triangle', rootFreq);
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass'; bp1.frequency.value = f1 * vp.p * 0.55 + f1 * 0.45; bp1.Q.value = 9;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = f2 * vp.p * 0.55 + f2 * 0.45; bp2.Q.value = 12;
    const bp3 = ctx.createBiquadFilter();
    bp3.type = 'bandpass'; bp3.frequency.value = f3 * vp.p * 0.5 + f3 * 0.5; bp3.Q.value = 8;
    const f3g = ctx.createGain(); f3g.gain.value = 0.4;
    const mix = ctx.createGain();
    const body = ctx.createGain(); body.gain.value = 0.35;
    const g = ctx.createGain();
    saw.connect(bp1).connect(mix);
    saw.connect(bp2).connect(mix);
    saw.connect(bp3).connect(f3g).connect(mix);
    tri.connect(body).connect(g);
    mix.connect(g);
    connectOut(g, clamp(vp.wet + wetBoost, 0, 0.95));

    // Pitch contour with micro-jitter
    saw.frequency.setValueAtTime(rootFreq, t0);
    tri.frequency.setValueAtTime(rootFreq, t0);
    const jitCents = vp.jitterBase * jitter * 12;
    contour.forEach((pt, i) => {
        const at = t0 + pt.t * dur;
        const cents = pt.c + (Math.random() * 2 - 1) * jitCents;
        const f = rootFreq * Math.pow(2, cents / 12);
        const ff = Math.max(40, f);
        if (i === 0) {
            saw.frequency.setValueAtTime(ff, at);
            tri.frequency.setValueAtTime(ff, at);
        } else {
            saw.frequency.exponentialRampToValueAtTime(ff, at);
            tri.frequency.exponentialRampToValueAtTime(ff, at);
        }
    });

    if (vibratoHz > 0) {
        const lfo = osc('sine', vibratoHz);
        const lfoG = ctx.createGain();
        lfoG.gain.value = rootFreq * (Math.pow(2, vibratoCents / 1200) - 1);
        lfo.connect(lfoG);
        lfoG.connect(saw.frequency);
        lfoG.connect(tri.frequency);
        lfo.start(t0); lfo.stop(t0 + dur + 0.1);
    }

    // Creak: low-freq amp tremor on gain
    if (creak > 0) {
        const cLfo = osc('sine', 22 + creak * 20);
        const cG = ctx.createGain(); cG.gain.value = peak * creak * 0.4;
        cLfo.connect(cG).connect(g.gain);
        cLfo.start(t0); cLfo.stop(t0 + dur + 0.1);
    }

    env(g, t0, { a: 0.012, d: dur * 0.35, s: 0.55, r: dur * 0.55, peak });
    saw.start(t0); tri.start(t0);
    saw.stop(t0 + dur + 0.1); tri.stop(t0 + dur + 0.1);

    const breathy = clamp(vp.breathy + breathyBoost, 0, 1.2);
    if (breathy > 0.02) {
        const n = pinkNoise(dur + 0.1);
        const bpN = ctx.createBiquadFilter();
        bpN.type = 'bandpass';
        bpN.frequency.value = (f1 + f2) * 0.5 * vp.p * 0.7 + (f1 + f2) * 0.5 * 0.3;
        bpN.Q.value = 2.5;
        const gN = ctx.createGain();
        n.connect(bpN).connect(gN);
        connectOut(gN, Math.min(0.6, vp.wet + wetBoost * 0.5));
        env(gN, t0, { a: 0.008, d: dur * 0.3, s: 0.35, r: dur * 0.6, peak: peak * breathy * 0.75 });
        n.start(t0); n.stop(t0 + dur + 0.1);
    }

    if (shimmer > 0) {
        const sh = osc('sine', rootFreq * 3.02);
        const sg = ctx.createGain();
        sh.connect(sg);
        connectOut(sg, vp.wet + 0.1);
        env(sg, t0, { a: 0.03, d: dur * 0.3, s: 0.3, r: dur * 0.5, peak: peak * shimmer * 0.25 });
        sh.start(t0); sh.stop(t0 + dur + 0.1);
    }
}

function playChirp(stage = 2) {
    if (!ensureCtx()) return;
    const t0 = now();
    stage = clamp(stage | 0, 0, 7);

    if (stage === 0) {
        // Breathy whisper with tiny voice peek
        const n = pinkNoise(0.3);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3.5;
        const gN = ctx.createGain();
        n.connect(bp).connect(gN);
        connectOut(gN, 0.35);
        env(gN, t0, { a: 0.012, d: 0.06, s: 0.4, r: 0.2, peak: 0.14 });
        n.start(t0); n.stop(t0 + 0.32);
        const o = osc('sine', 1100);
        const g = ctx.createGain();
        o.connect(g);
        connectOut(g, 0.25);
        env(g, t0, { a: 0.02, d: 0.05, s: 0.3, r: 0.14, peak: 0.06 });
        o.start(t0); o.stop(t0 + 0.22);
        return;
    }

    if (stage >= 3 && stage <= 6) {
        voicedSyllable(stage, {
            base: stage === 6 ? 380 : 460,
            dur: 0.24, peak: 0.2,
            f1: [0,0,0,400,550,700,600][stage],
            f2: [0,0,0,2400,2100,1800,1400][stage],
            f3: [0,0,0,3200,2900,2700,2400][stage],
            contour: [{ t: 0, c: -1 }, { t: 0.5, c: +2 }, { t: 1, c: -2 }],
            jitter: 0.6, breathyBoost: stage === 6 ? 0.35 : 0.1,
        });
        return;
    }

    if (stage === 7) {
        chord([1568, 2093, 2637], { dur: 0.65, peak: 0.14, wet: 0.88, modDepth: 1.2 });
        return;
    }

    // 1..2 FM squeak
    const base = clamp(1400 - stage * 140, 600, 1600);
    const carrier = osc('triangle', base);
    const mod = osc('sine', base * 2.01);
    const modG = ctx.createGain(); modG.gain.value = base * 0.25;
    mod.connect(modG).connect(carrier.frequency);
    const g = ctx.createGain();
    carrier.connect(g);
    connectOut(g, 0.22);
    carrier.frequency.setValueAtTime(base, t0);
    carrier.frequency.linearRampToValueAtTime(base * 1.15, t0 + 0.07);
    carrier.frequency.linearRampToValueAtTime(base * 0.95, t0 + 0.14);
    env(g, t0, { a: 0.005, d: 0.05, s: 0.4, r: 0.1, peak: 0.2 });
    carrier.start(t0); mod.start(t0);
    carrier.stop(t0 + 0.24); mod.stop(t0 + 0.24);
}

// Mood chirp — each mood has deeply distinct shape: contour, jitter, vibrato,
// creak/shimmer, number of syllables, inter-syllable gaps.
function playMoodChirp(stage = 2, mood = 'neutral') {
    if (!ensureCtx()) return;
    const s = clamp(stage | 0, 0, 7);

    if (s === 0) {
        const t0 = now();
        const dur = (mood === 'sleepy') ? 0.45 : (mood === 'scared') ? 0.14 : 0.28;
        const n = pinkNoise(dur);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = (mood === 'scared') ? 2800 : (mood === 'sleepy') ? 1100 : 1800;
        bp.Q.value = (mood === 'scared') ? 6 : 3.2;
        const gN = ctx.createGain();
        n.connect(bp).connect(gN);
        connectOut(gN, 0.4);
        env(gN, t0, { a: 0.01, d: dur * 0.3, s: 0.4, r: dur * 0.6, peak: 0.14 });
        n.start(t0); n.stop(t0 + dur + 0.05);
        return;
    }
    if (s === 7) {
        const choice = (mood === 'sad' || mood === 'sulky')
            ? [1319, 1661, 1975]
            : (mood === 'scared')
                ? [1568, 1760, 2349]
                : (mood === 'happy' || mood === 'curious')
                    ? [1760, 2349, 2794, 3136]
                    : [1568, 2093, 2637];
        chord(choice, { dur: 0.7, peak: 0.14, wet: 0.9, modDepth: 1.2, stagger: 30 });
        return;
    }

    switch (mood) {
        case 'happy': {
            // Two bright leaping syllables "tli-HAH!"
            voicedSyllable(s, {
                base: 520, dur: 0.14, peak: 0.2,
                f1: 650, f2: 2250, f3: 3200,
                contour: [{ t: 0, c: -2 }, { t: 1, c: +5 }],
                jitter: 0.5, shimmer: 0.4,
            });
            setTimeout(() => voicedSyllable(s, {
                base: 580, dur: 0.22, peak: 0.24,
                f1: 700, f2: 2400, f3: 3400,
                contour: [{ t: 0, c: +3 }, { t: 0.5, c: +8 }, { t: 1, c: +6 }],
                jitter: 0.6, vibratoHz: 7, vibratoCents: 14, shimmer: 0.5,
            }), 130);
            break;
        }
        case 'curious': {
            // Soft "hm?" questioning rise, 2 beats
            voicedSyllable(s, {
                base: 460, dur: 0.12, peak: 0.15,
                f1: 560, f2: 1800, f3: 2600,
                contour: [{ t: 0, c: 0 }, { t: 1, c: +2 }],
                jitter: 0.4, breathyBoost: 0.15,
            });
            setTimeout(() => voicedSyllable(s, {
                base: 500, dur: 0.3, peak: 0.2,
                f1: 620, f2: 2000, f3: 2800,
                contour: [{ t: 0, c: +1 }, { t: 0.5, c: +5 }, { t: 1, c: +11 }],
                jitter: 0.6, shimmer: 0.25,
            }), 170);
            break;
        }
        case 'sad': {
            // Slow falling "oooh" with gentle vibrato
            voicedSyllable(s, {
                base: 440, dur: 0.7, peak: 0.17,
                f1: 540, f2: 1400, f3: 2200,
                contour: [{ t: 0, c: +3 }, { t: 0.3, c: 0 }, { t: 1, c: -12 }],
                jitter: 0.35, vibratoHz: 4, vibratoCents: 16,
                breathyBoost: 0.3, wetBoost: 0.1,
            });
            break;
        }
        case 'hungry': {
            // 3 pleading calls escalating
            voicedSyllable(s, {
                base: 420, dur: 0.16, peak: 0.16,
                f1: 600, f2: 1700, f3: 2500,
                contour: [{ t: 0, c: 0 }, { t: 1, c: +4 }],
                jitter: 0.5,
            });
            setTimeout(() => voicedSyllable(s, {
                base: 470, dur: 0.18, peak: 0.2,
                f1: 600, f2: 1700, f3: 2500,
                contour: [{ t: 0, c: +2 }, { t: 1, c: +7 }],
                jitter: 0.6, vibratoHz: 5.5, vibratoCents: 18,
            }), 180);
            setTimeout(() => voicedSyllable(s, {
                base: 510, dur: 0.36, peak: 0.22,
                f1: 580, f2: 1600, f3: 2400,
                contour: [{ t: 0, c: +6 }, { t: 0.4, c: +3 }, { t: 1, c: -5 }],
                jitter: 0.7, vibratoHz: 7, vibratoCents: 26,
            }), 380);
            break;
        }
        case 'sleepy': {
            // Long yawn with slow open formant
            voicedSyllable(s, {
                base: 360, dur: 1.0, peak: 0.17,
                f1: 500, f2: 1100, f3: 1900,
                contour: [{ t: 0, c: -2 }, { t: 0.3, c: +4 }, { t: 0.7, c: +2 }, { t: 1, c: -11 }],
                jitter: 0.25, breathyBoost: 0.55, wetBoost: 0.12,
                vibratoHz: 2.5, vibratoCents: 10,
            });
            break;
        }
        case 'scared': {
            // Quick high stuttering triplet
            for (let i = 0; i < 3; i++) {
                setTimeout(() => voicedSyllable(s, {
                    base: 620 + i * 30, dur: 0.09, peak: 0.22,
                    f1: 820, f2: 2500, f3: 3400,
                    contour: [{ t: 0, c: +4 + i * 2 }, { t: 1, c: +10 + i * 2 }],
                    jitter: 2.5, shimmer: 0.2,
                }), i * 95);
            }
            break;
        }
        case 'dirty': {
            // Disgusted "eugh" — open then close, slight creak
            voicedSyllable(s, {
                base: 430, dur: 0.32, peak: 0.22,
                f1: 540, f2: 1150, f3: 1900,
                contour: [{ t: 0, c: +5 }, { t: 0.3, c: +2 }, { t: 0.7, c: -3 }, { t: 1, c: -8 }],
                jitter: 0.9, breathyBoost: 0.2, creak: 0.4,
            });
            break;
        }
        case 'bored': {
            // Flat-ish drawn-out "mehhh", slight downward drift
            voicedSyllable(s, {
                base: 420, dur: 0.7, peak: 0.14,
                f1: 540, f2: 1400, f3: 2200,
                contour: [{ t: 0, c: 0 }, { t: 0.3, c: -1 }, { t: 0.8, c: -3 }, { t: 1, c: -6 }],
                jitter: 0.3, breathyBoost: 0.3, creak: 0.25,
            });
            break;
        }
        case 'lonely': {
            // Calling: soft arc with vibrato, long reverb
            voicedSyllable(s, {
                base: 460, dur: 0.65, peak: 0.18,
                f1: 600, f2: 1700, f3: 2600,
                contour: [{ t: 0, c: -1 }, { t: 0.35, c: +6 }, { t: 0.7, c: +3 }, { t: 1, c: -1 }],
                jitter: 0.4, vibratoHz: 4.5, vibratoCents: 14,
                wetBoost: 0.18, shimmer: 0.2,
            });
            break;
        }
        case 'sulky': {
            // Low grumble turning away
            voicedSyllable(s, {
                base: 300, dur: 0.6, peak: 0.2,
                f1: 420, f2: 900, f3: 1700,
                contour: [{ t: 0, c: 0 }, { t: 0.4, c: -2 }, { t: 1, c: -9 }],
                jitter: 0.5, breathyBoost: 0.2, creak: 0.5,
            });
            break;
        }
        case 'sick': {
            // Weak wobbly
            voicedSyllable(s, {
                base: 370, dur: 0.6, peak: 0.15,
                f1: 480, f2: 1050, f3: 1700,
                contour: [{ t: 0, c: -1 }, { t: 0.4, c: -5 }, { t: 1, c: -10 }],
                jitter: 1.6, vibratoHz: 3.2, vibratoCents: 32,
                breathyBoost: 0.45, creak: 0.5,
            });
            break;
        }
        default: {
            // Neutral — slight lilt
            voicedSyllable(s, {
                base: 480, dur: 0.26, peak: 0.18,
                f1: 600, f2: 1700, f3: 2600,
                contour: [{ t: 0, c: 0 }, { t: 0.5, c: +2 }, { t: 1, c: -1 }],
                jitter: 0.45,
            });
        }
    }
}

// Named vocal expressions
function playSleepYawn(stage = 2) {
    voicedSyllable(stage, {
        base: 340, dur: 1.2, peak: 0.2,
        f1: 400, f2: 900, f3: 1700,
        contour: [{ t: 0, c: -3 }, { t: 0.3, c: +5 }, { t: 0.6, c: +2 }, { t: 1, c: -12 }],
        jitter: 0.35, breathyBoost: 0.7, wetBoost: 0.15,
        vibratoHz: 2.4, vibratoCents: 12,
    });
}

function playSnore(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    // In-breath rumble — triangle + LP + slow freq wobble
    const o = osc('triangle', 78 * vp.p);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 1.4;
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.4);
    o.frequency.setValueAtTime(70 * vp.p, t0);
    o.frequency.linearRampToValueAtTime(130 * vp.p, t0 + 0.5);
    o.frequency.linearRampToValueAtTime(65 * vp.p, t0 + 1.0);
    env(g, t0, { a: 0.18, d: 0.25, s: 0.65, r: 0.4, peak: 0.11 });
    o.start(t0); o.stop(t0 + 1.2);
    // Second harmonic for nasal color
    const o2 = osc('sine', 156 * vp.p);
    const g2 = ctx.createGain();
    o2.connect(g2);
    connectOut(g2, 0.2);
    env(g2, t0, { a: 0.2, d: 0.25, s: 0.5, r: 0.45, peak: 0.04 });
    o2.start(t0); o2.stop(t0 + 1.2);
    // Nasal hiss modulated
    const n = pinkNoise(1.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2.5;
    const gN = ctx.createGain();
    const hLfo = osc('sine', 0.9);
    const hLfoG = ctx.createGain(); hLfoG.gain.value = 0.03;
    hLfo.connect(hLfoG).connect(gN.gain);
    n.connect(bp).connect(gN);
    connectOut(gN, 0.18);
    env(gN, t0, { a: 0.22, d: 0.25, s: 0.45, r: 0.5, peak: 0.05 });
    n.start(t0); hLfo.start(t0);
    n.stop(t0 + 1.1); hLfo.stop(t0 + 1.1);
}

function playMunch(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    // Two wet jaw clicks with tiny food crunch
    for (let i = 0; i < 2; i++) {
        const at = t0 + i * 0.12;
        const o = osc('triangle', (190 + Math.random() * 70) * vp.p);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2.5;
        const g = ctx.createGain();
        o.connect(lp).connect(g);
        connectOut(g, 0.12);
        env(g, at, { a: 0.002, d: 0.03, s: 0.0, r: 0.05, peak: 0.15 });
        o.frequency.setValueAtTime((240) * vp.p, at);
        o.frequency.exponentialRampToValueAtTime(130 * vp.p, at + 0.08);
        o.start(at); o.stop(at + 0.12);
        // Crunch
        const n = noise(0.08);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 900; bp.Q.value = 5;
        const gN = ctx.createGain();
        n.connect(bp).connect(gN);
        connectOut(gN, 0.08);
        env(gN, at, { a: 0.001, d: 0.025, s: 0.0, r: 0.05, peak: 0.1 });
        n.start(at); n.stop(at + 0.09);
    }
}

function playCough(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    // Burst: explosive noise + low grunt
    const n = noise(0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900 * vp.p; bp.Q.value = 3;
    bp.frequency.setValueAtTime(500 * vp.p, t0);
    bp.frequency.exponentialRampToValueAtTime(1400 * vp.p, t0 + 0.04);
    bp.frequency.exponentialRampToValueAtTime(600 * vp.p, t0 + 0.18);
    const gN = ctx.createGain();
    n.connect(bp).connect(gN);
    connectOut(gN, 0.22);
    env(gN, t0, { a: 0.002, d: 0.04, s: 0.25, r: 0.12, peak: 0.28 });
    n.start(t0); n.stop(t0 + 0.22);
    // Voice grunt
    const o = osc('sawtooth', 200 * vp.p);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.18);
    o.frequency.setValueAtTime(260 * vp.p, t0);
    o.frequency.exponentialRampToValueAtTime(120 * vp.p, t0 + 0.15);
    env(g, t0, { a: 0.004, d: 0.04, s: 0.2, r: 0.14, peak: 0.18 });
    o.start(t0); o.stop(t0 + 0.22);
    // Wheezy tail
    const n2 = pinkNoise(0.25);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = 1800; bp2.Q.value = 2;
    const gN2 = ctx.createGain();
    n2.connect(bp2).connect(gN2);
    connectOut(gN2, 0.15);
    env(gN2, t0 + 0.1, { a: 0.02, d: 0.06, s: 0.2, r: 0.15, peak: 0.06 });
    n2.start(t0 + 0.1); n2.stop(t0 + 0.35);
}

function playWhimper(stage = 2) {
    voicedSyllable(stage, {
        base: 520, dur: 0.6, peak: 0.17,
        f1: 700, f2: 1900, f3: 2800,
        contour: [{ t: 0, c: +6 }, { t: 0.4, c: 0 }, { t: 1, c: -7 }],
        jitter: 1.9, vibratoHz: 9, vibratoCents: 30,
        breathyBoost: 0.25, creak: 0.2,
    });
}

function playGrumble(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    // Three detuned saws for thick beat; vocal formant LP
    const o1 = osc('sawtooth', 130 * vp.p, -8);
    const o2 = osc('sawtooth', 137 * vp.p, +6);
    const o3 = osc('triangle', 65 * vp.p);  // sub
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 2;
    const g = ctx.createGain();
    o1.connect(lp); o2.connect(lp); lp.connect(g);
    const subG = ctx.createGain(); subG.gain.value = 0.4;
    o3.connect(subG).connect(g);
    connectOut(g, 0.22);
    [o1, o2].forEach(o => {
        o.frequency.setValueAtTime(o.frequency.value, t0);
        o.frequency.linearRampToValueAtTime(o.frequency.value * 0.85, t0 + 0.75);
    });
    // Amp tremor
    const tr = osc('sine', 8);
    const trG = ctx.createGain(); trG.gain.value = 0.05;
    tr.connect(trG).connect(g.gain);
    env(g, t0, { a: 0.04, d: 0.15, s: 0.6, r: 0.4, peak: 0.2 });
    o1.start(t0); o2.start(t0); o3.start(t0); tr.start(t0);
    o1.stop(t0 + 1.0); o2.stop(t0 + 1.0); o3.stop(t0 + 1.0); tr.stop(t0 + 1.0);
}

function playMeditateHum(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    const f = 220 * vp.p;
    const o1 = osc('sine', f);
    const o2 = osc('sine', f * 1.503);
    const o3 = osc('sine', f * 2.01);  // octave shimmer
    const g = ctx.createGain();
    const g3 = ctx.createGain(); g3.gain.value = 0.25;
    o1.connect(g); o2.connect(g); o3.connect(g3).connect(g);
    connectOut(g, 0.6);
    const lfo = osc('sine', 4.6);
    const lfoG = ctx.createGain(); lfoG.gain.value = f * 0.006;
    lfo.connect(lfoG).connect(o1.frequency);
    env(g, t0, { a: 0.7, d: 0.3, s: 0.65, r: 1.2, peak: 0.13 });
    o1.start(t0); o2.start(t0); o3.start(t0); lfo.start(t0);
    o1.stop(t0 + 2.0); o2.stop(t0 + 2.0); o3.stop(t0 + 2.0); lfo.stop(t0 + 2.0);
}

function playLaugh(stage = 2) {
    const s = clamp(stage | 0, 0, 7);
    const count = 3 + Math.floor(Math.random() * 2);
    const contours = [
        [{ t: 0, c: +2 }, { t: 1, c: +6 }],
        [{ t: 0, c: +5 }, { t: 1, c: +1 }],
        [{ t: 0, c: +3 }, { t: 1, c: +7 }],
        [{ t: 0, c: +4 }, { t: 1, c: 0 }],
    ];
    for (let i = 0; i < count; i++) {
        setTimeout(() => voicedSyllable(s, {
            base: 540 + i * 12, dur: 0.1 + Math.random() * 0.04, peak: 0.2,
            f1: 680 + i * 20, f2: 2100, f3: 3000,
            contour: contours[i % contours.length],
            jitter: 0.9, shimmer: 0.3, breathyBoost: 0.1,
        }), i * (110 + Math.random() * 30));
    }
}

function playYay(stage = 2) {
    voicedSyllable(stage, {
        base: 560, dur: 0.22, peak: 0.22,
        f1: 700, f2: 2250, f3: 3300,
        contour: [{ t: 0, c: 0 }, { t: 0.55, c: +6 }, { t: 1, c: +4 }],
        jitter: 0.6, shimmer: 0.35, vibratoHz: 6, vibratoCents: 12,
    });
}

// ---------------------------------------------------------------------------
// Pet song — a short melodic phrase in the pet's own voice. The pet's base
// pitch shifts per stage (small & squeaky early, rich & low by stage 7), and
// the melody picks 5-7 notes from a mode that matches that stage's palette.
// Called from Autonomy when the pet is happy enough to sing.
// ---------------------------------------------------------------------------
const PET_SONG_SCALES = [
    [261.63, 329.63, 392.00, 523.25, 659.25],                // stage 0 — C pent maj
    [261.63, 311.13, 392.00, 466.16, 587.33],                // 1 — C minor pent
    [293.66, 349.23, 440.00, 523.25, 659.25],                // 2 — D minor open
    [329.63, 392.00, 493.88, 587.33, 659.25, 783.99],        // 3 — E dorian-ish, bright
    [293.66, 349.23, 440.00, 523.25, 659.25, 783.99],        // 4 — warm D minor 7
    [329.63, 392.00, 440.00, 523.25, 659.25, 784.00, 988.0], // 5 — wider cosmic
    [196.00, 261.63, 329.63, 392.00, 523.25],                // 6 — elder, lower
    [261.63, 329.63, 392.00, 493.88, 659.25, 784.00],        // 7 — transcendent
];
function playPetMelody(stage = 3, opts = {}) {
    if (!_enabled || _reducedMotion) return;
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const s = clamp(stage | 0, 0, 7);
    const scale = PET_SONG_SCALES[s] || PET_SONG_SCALES[3];
    const noteCount = opts.noteCount || (4 + Math.floor(Math.random() * 3));  // 4-6
    const stepMs = opts.stepMs || 220;
    const pitchMul = [1.55, 1.45, 1.30, 1.15, 1.00, 0.88, 0.80, 0.92][s];

    const t0 = now();
    // Pick notes with a light melodic shape: start low-mid, rise, return
    const seq = [];
    let idx = Math.floor(scale.length / 2) - 1;
    for (let i = 0; i < noteCount; i++) {
        idx += (Math.random() < 0.55 ? 1 : -1) + (Math.random() < 0.15 ? 1 : 0);
        idx = Math.max(0, Math.min(scale.length - 1, idx));
        seq.push(scale[idx] * pitchMul);
    }

    for (let i = 0; i < seq.length; i++) {
        const when = t0 + i * (stepMs / 1000);
        const hz = seq[i];
        // Short voiced syllable (triangle + sine shimmer, reverb wet)
        const o1 = osc('triangle', hz);
        const o2 = osc('sine', hz * 2);
        const g  = ctx.createGain();
        const g2 = ctx.createGain();
        env(g,  when, { a: 0.02, d: 0.1, s: 0.5, r: 0.35, peak: 0.17 });
        env(g2, when, { a: 0.02, d: 0.08, s: 0.2, r: 0.30, peak: 0.05 });
        o1.connect(g);
        o2.connect(g2);
        connectOut(g, 0.7);
        connectOut(g2, 0.8);
        o1.start(when); o2.start(when);
        o1.stop(when + 0.55);
        o2.stop(when + 0.45);
    }
    // Gentle vibrato tail on the last note
    const tailAt = t0 + (seq.length - 1) * (stepMs / 1000);
    const tailHz = seq[seq.length - 1];
    const ot = osc('sine', tailHz);
    const gt = ctx.createGain();
    const vib = osc('sine', 5);
    const vibG = ctx.createGain(); vibG.gain.value = 6;
    vib.connect(vibG).connect(ot.detune);
    env(gt, tailAt + 0.2, { a: 0.05, d: 0.1, s: 0.6, r: 0.9, peak: 0.08 });
    ot.connect(gt);
    connectOut(gt, 0.9);
    ot.start(tailAt + 0.15); ot.stop(tailAt + 1.3);
    vib.start(tailAt + 0.15); vib.stop(tailAt + 1.3);
}

function playSniff(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    const n = pinkNoise(0.2);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1600 * vp.p; bp.Q.value = 3.5;
    const g = ctx.createGain();
    n.connect(bp).connect(g);
    connectOut(g, 0.12);
    bp.frequency.setValueAtTime(800 * vp.p, t0);
    bp.frequency.exponentialRampToValueAtTime(2400 * vp.p, t0 + 0.1);
    env(g, t0, { a: 0.004, d: 0.03, s: 0.5, r: 0.08, peak: 0.15 });
    n.start(t0); n.stop(t0 + 0.2);
}

function playSigh(stage = 2) {
    voicedSyllable(stage, {
        base: 420, dur: 0.95, peak: 0.15,
        f1: 540, f2: 1350, f3: 2100,
        contour: [{ t: 0, c: +3 }, { t: 0.25, c: 0 }, { t: 1, c: -12 }],
        jitter: 0.3, breathyBoost: 0.65, wetBoost: 0.12,
        vibratoHz: 3, vibratoCents: 8,
    });
}

function playHiccup(stage = 2) {
    if (!ensureCtx()) return;
    const vp = voiceParams(stage);
    const t0 = now();
    const o = osc('triangle', 420 * vp.p);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.22);
    o.frequency.setValueAtTime(220 * vp.p, t0);
    o.frequency.exponentialRampToValueAtTime(1050 * vp.p, t0 + 0.04);
    o.frequency.exponentialRampToValueAtTime(320 * vp.p, t0 + 0.12);
    env(g, t0, { a: 0.002, d: 0.02, s: 0.0, r: 0.1, peak: 0.24 });
    o.start(t0); o.stop(t0 + 0.2);
    // Little breath tail
    const n = pinkNoise(0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200 * vp.p; bp.Q.value = 3;
    const gN = ctx.createGain();
    n.connect(bp).connect(gN);
    connectOut(gN, 0.08);
    env(gN, t0, { a: 0.001, d: 0.02, s: 0.0, r: 0.05, peak: 0.06 });
    n.start(t0); n.stop(t0 + 0.09);
}

// -----------------------------------------------------------------------------
// Activity loops
// -----------------------------------------------------------------------------
let _activityLoops = {};

function _startActivityLoop(name, intervalMs, jitterMs, fn) {
    _stopActivityLoop(name);
    const tick = () => {
        if (!_enabled) return;
        try { fn(); } catch (_) {}
    };
    const schedule = () => {
        const wait = intervalMs + (Math.random() * 2 - 1) * jitterMs;
        _activityLoops[name].timer = setTimeout(() => {
            tick();
            if (_activityLoops[name]) schedule();
        }, Math.max(600, wait));
    };
    _activityLoops[name] = { timer: null };
    schedule();
}

function _stopActivityLoop(name) {
    const l = _activityLoops[name];
    if (l && l.timer) clearTimeout(l.timer);
    delete _activityLoops[name];
}

function startSnoreLoop(stage = 2) { _startActivityLoop('snore', 8000, 1500, () => playSnore(stage)); }
function stopSnoreLoop()           { _stopActivityLoop('snore'); }
function startMunchLoop(stage = 2) { _startActivityLoop('munch', 700, 250, () => playMunch(stage)); }
function stopMunchLoop()           { _stopActivityLoop('munch'); }
function startMeditateHumLoop(stage = 2) { _startActivityLoop('medhum', 2800, 500, () => playMeditateHum(stage)); }
function stopMeditateHumLoop()     { _stopActivityLoop('medhum'); }
function startCoughLoop(stage = 2) { _startActivityLoop('cough', 14000, 4000, () => playCough(stage)); }
function stopCoughLoop()           { _stopActivityLoop('cough'); }
function startWhimperLoop(stage = 2) { _startActivityLoop('whimper', 11000, 3000, () => playWhimper(stage)); }
function stopWhimperLoop()         { _stopActivityLoop('whimper'); }
function startGrumbleLoop(stage = 2) { _startActivityLoop('grumble', 16000, 4500, () => playGrumble(stage)); }
function stopGrumbleLoop()         { _stopActivityLoop('grumble'); }

function stopAllActivityLoops() {
    Object.keys(_activityLoops).forEach(_stopActivityLoop);
}

// -----------------------------------------------------------------------------
// Need-tap timbres
// -----------------------------------------------------------------------------
function playNeedTap(level = 50, needIndex = -1) {
    if (!ensureCtx()) return;
    const bright = clamp(0.5 + level / 200, 0.5, 1.0);
    if (needIndex < 0) {
        chime(440 + level * 6, { dur: 0.25, peak: 0.18, wet: 0.22 });
        return;
    }
    switch (needIndex) {
        case 0: chime(165 * bright, { dur: 0.35, peak: 0.22, wet: 0.25, type: 'triangle', modDepth: 2, sub: 0.3 }); break;
        case 1: chime(330 * bright, { dur: 0.5, peak: 0.16, wet: 0.55, type: 'sine', sub: 0.3 }); break;
        case 2: whoosh({ dur: 0.22, freqStart: 2200, freqEnd: 1400, q: 8, peak: 0.14, wet: 0.4 });
                setTimeout(() => chime(1760 * bright, { dur: 0.2, peak: 0.1, wet: 0.45 }), 45); break;
        case 3: chime(659 * bright, { dur: 0.3, peak: 0.18, wet: 0.35, modRatio: 3.01, modDepth: 1.5 });
                setTimeout(() => chime(784 * bright, { dur: 0.3, peak: 0.16, wet: 0.35 }), 65); break;
        case 4: chime(523 * bright, { dur: 0.42, peak: 0.18, wet: 0.4, type: 'sine', sub: 0.25 }); break;
        case 5: chime(880 * bright, { dur: 0.28, peak: 0.2, wet: 0.3, type: 'sine', modRatio: 4.01, modDepth: 4 }); break;
        case 6: chime(392 * bright, { dur: 0.55, peak: 0.14, wet: 0.45, type: 'sine' });
                setTimeout(() => chime(494 * bright, { dur: 0.5, peak: 0.12, wet: 0.45, type: 'sine' }), 45); break;
        case 7: chime(698 * bright, { dur: 0.22, peak: 0.18, wet: 0.3 });
                setTimeout(() => chime(988 * bright, { dur: 0.26, peak: 0.18, wet: 0.35 }), 75); break;
        case 8: chime(1319, { dur: 0.55, peak: 0.16, wet: 0.75, modRatio: 2.41, modDepth: 2.5 });
                setTimeout(() => sparkle({ count: 2, lo: 2400, hi: 3600, peak: 0.06, wet: 0.7, spread: 80 }), 40); break;
        case 9: chime(110, { dur: 0.65, peak: 0.2, wet: 0.4, type: 'sine', sub: 0.5 });
                setTimeout(() => chime(220, { dur: 0.55, peak: 0.14, wet: 0.4, type: 'sine' }), 30); break;
        default:
            chime(440 + level * 6, { dur: 0.25, peak: 0.18, wet: 0.22 });
    }
}

// -----------------------------------------------------------------------------
// Minigame sounds
// -----------------------------------------------------------------------------
const ECHO_FREQS = [392.00, 466.16, 554.37, 659.26, 783.99, 932.33];
function playEchoNode(nodeIdx = 0, asPlayback = true) {
    const f = ECHO_FREQS[nodeIdx % ECHO_FREQS.length];
    chime(f, {
        dur: asPlayback ? 0.5 : 0.35,
        peak: asPlayback ? 0.2 : 0.24,
        wet: 0.6,
        modRatio: 3.01,
        modDepth: asPlayback ? 1.5 : 2.5,
        sub: 0.3,
    });
}
function playEchoSuccess() {
    chord([659, 784, 988, 1319], { dur: 0.75, peak: 0.22, wet: 0.55, modDepth: 1.5, sub: 0.3 });
    setTimeout(() => sparkle({ count: 5, lo: 2000, hi: 3800, peak: 0.1, wet: 0.7 }), 180);
}
function playEchoFail() {
    if (!ensureCtx()) return;
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

function playCleanseSparkle() {
    const f = 1800 + Math.random() * 1400;
    chime(f, { dur: 0.2, peak: 0.1, wet: 0.65, modRatio: 2.01, modDepth: 1 });
}
function playCleanseFlinch() {
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('triangle', 180);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.18);
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(80, t0 + 0.25);
    env(g, t0, { a: 0.003, d: 0.08, s: 0.3, r: 0.2, peak: 0.22 });
    o.start(t0); o.stop(t0 + 0.35);
}
function playCleanseComplete() {
    chord([523, 659, 784, 1046], { dur: 1.2, peak: 0.22, wet: 0.6, modDepth: 1.5, sub: 0.3 });
    setTimeout(() => sparkle({ count: 7, lo: 2200, hi: 4000, peak: 0.1, wet: 0.8, spread: 200 }), 260);
}

function playStarEdge() {
    whoosh({ dur: 0.3, freqStart: 600, freqEnd: 2400, q: 2.8, peak: 0.12, wet: 0.55 });
    setTimeout(() => chime(1175 + Math.random() * 400, { dur: 0.28, peak: 0.13, wet: 0.65 }), 130);
}
function playStarSelect() {
    chime(1568, { dur: 0.2, peak: 0.12, wet: 0.45, modRatio: 2.01, modDepth: 1 });
}
function playStarConstellation() {
    chord([523, 659, 784, 988, 1175], { dur: 1.5, peak: 0.22, wet: 0.75, modDepth: 2, sub: 0.35 });
    setTimeout(() => sparkle({ count: 8, lo: 2200, hi: 4200, peak: 0.1, wet: 0.8, spread: 220 }), 320);
}
function playStarSessionComplete() {
    playTranscendence();
}

// ---- Tetris (new dedicated sounds) ----
// 7 soft timbres, one per tetromino shape (0..6)
const TET_FREQS = [440, 494, 554, 587, 659, 740, 831];  // A4, B4, C#5, D5, E5, F#5, G#5

function playTetrisLock(shape = 0) {
    if (!ensureCtx()) return;
    const t0 = now();
    const f = TET_FREQS[clamp(shape | 0, 0, 6)];
    // Wooden thunk — low thump + soft marimba note
    const o = osc('sine', f);
    const m = osc('sine', f * 3.01);
    const mg = ctx.createGain(); mg.gain.value = 4;
    m.connect(mg).connect(o.frequency);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.25);
    env(g, t0, { a: 0.002, d: 0.04, s: 0.08, r: 0.2, peak: 0.16 });
    o.start(t0); m.start(t0);
    o.stop(t0 + 0.32); m.stop(t0 + 0.32);
    // Body thump
    const thump = osc('sine', f * 0.25);
    const tg = ctx.createGain();
    thump.connect(tg);
    connectOut(tg, 0.08);
    env(tg, t0, { a: 0.002, d: 0.03, s: 0.0, r: 0.08, peak: 0.22 });
    thump.start(t0); thump.stop(t0 + 0.14);
}

function playTetrisLineClear(n = 1) {
    n = clamp(n | 0, 1, 4);
    // 1 line: simple major 2nd up; 4 lines: grand arp "tetris" moment
    if (n === 1) {
        chord([784, 988], { dur: 0.5, peak: 0.2, wet: 0.5, modDepth: 1.5, stagger: 40, sub: 0.3 });
    } else if (n === 2) {
        chord([659, 784, 988], { dur: 0.55, peak: 0.22, wet: 0.55, modDepth: 1.5, stagger: 35, sub: 0.3 });
        setTimeout(() => sparkle({ count: 3, lo: 2200, hi: 3400, peak: 0.08, wet: 0.7 }), 180);
    } else if (n === 3) {
        chord([523, 659, 784, 988, 1175], { dur: 0.7, peak: 0.22, wet: 0.6, modDepth: 1.8, stagger: 32, sub: 0.35 });
        setTimeout(() => sparkle({ count: 5, lo: 2000, hi: 3800, peak: 0.1, wet: 0.75 }), 200);
    } else {
        // Tetris!!! Grand ascending arpeggio + triumphant chord
        const arp = [523, 659, 784, 1046, 1319, 1568];
        arp.forEach((f, i) => setTimeout(() => chime(f, { dur: 0.3, peak: 0.22, wet: 0.55, modDepth: 1.5, sub: 0.3 }), i * 55));
        setTimeout(() => chord([523, 784, 1046, 1319, 1568, 2093], { dur: 1.2, peak: 0.24, wet: 0.7, modDepth: 2, sub: 0.4 }), 380);
        setTimeout(() => sparkle({ count: 10, lo: 2200, hi: 4400, peak: 0.12, wet: 0.8, spread: 250 }), 500);
    }
}

function playTetrisGameOver() {
    if (!ensureCtx()) return;
    // Descending four-note melancholy + low drone
    const t0 = now();
    const notes = [659, 523, 415, 330];
    notes.forEach((f, i) => setTimeout(() => chime(f, { dur: 0.6, peak: 0.2, wet: 0.55, type: 'sine', sub: 0.3 }), i * 180));
    // Low pad
    const o = osc('sine', 82);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.5);
    env(g, t0, { a: 0.3, d: 0.4, s: 0.6, r: 1.5, peak: 0.2 });
    o.start(t0); o.stop(t0 + 2.4);
}

// ---- Pac-Lalì ----
let _pacPelletToggle = 0;

function playPacPellet() {
    if (!ensureCtx()) return;
    // Alternating two pitches for rhythm, very short soft "tok"
    const f = (_pacPelletToggle++ % 2 === 0) ? 1046 : 1319;
    const t0 = now();
    const o = osc('sine', f);
    const m = osc('sine', f * 2.01);
    const mg = ctx.createGain(); mg.gain.value = 1.5;
    m.connect(mg).connect(o.frequency);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.18);
    env(g, t0, { a: 0.001, d: 0.02, s: 0.0, r: 0.05, peak: 0.1 });
    o.start(t0); m.start(t0);
    o.stop(t0 + 0.08); m.stop(t0 + 0.08);
}

function playPacPower() {
    // Energetic rising chirp + shimmer
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('triangle', 440);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.3);
    o.frequency.setValueAtTime(440, t0);
    o.frequency.exponentialRampToValueAtTime(1760, t0 + 0.35);
    env(g, t0, { a: 0.005, d: 0.08, s: 0.5, r: 0.2, peak: 0.22 });
    o.start(t0); o.stop(t0 + 0.55);
    setTimeout(() => sparkle({ count: 5, lo: 2000, hi: 3600, peak: 0.1, wet: 0.7, spread: 80 }), 200);
    setTimeout(() => chord([784, 988, 1319], { dur: 0.5, peak: 0.15, wet: 0.55, modDepth: 1.5 }), 60);
}

function playPacGhostEat() {
    // Satisfying gulp
    if (!ensureCtx()) return;
    const t0 = now();
    const o = osc('triangle', 880);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain();
    o.connect(lp).connect(g);
    connectOut(g, 0.3);
    o.frequency.setValueAtTime(880, t0);
    o.frequency.exponentialRampToValueAtTime(220, t0 + 0.3);
    env(g, t0, { a: 0.003, d: 0.1, s: 0.3, r: 0.2, peak: 0.25 });
    o.start(t0); o.stop(t0 + 0.45);
    // Bubble pop
    setTimeout(() => whoosh({ dur: 0.15, freqStart: 1600, freqEnd: 400, q: 10, peak: 0.1, wet: 0.3 }), 150);
    setTimeout(() => chime(1568, { dur: 0.3, peak: 0.14, wet: 0.6, modRatio: 2.01, modDepth: 1.5 }), 280);
}

function playPacDeath() {
    if (!ensureCtx()) return;
    const t0 = now();
    // Wobbly descending sine — poignant, short
    const o = osc('sine', 660);
    const g = ctx.createGain();
    o.connect(g);
    connectOut(g, 0.5);
    const lfo = osc('sine', 12);
    const lfoG = ctx.createGain(); lfoG.gain.value = 28;
    lfo.connect(lfoG).connect(o.frequency);
    o.frequency.setValueAtTime(660, t0);
    o.frequency.exponentialRampToValueAtTime(110, t0 + 1.4);
    env(g, t0, { a: 0.01, d: 0.2, s: 0.5, r: 1.0, peak: 0.22 });
    o.start(t0); lfo.start(t0);
    o.stop(t0 + 1.7); lfo.stop(t0 + 1.7);
    // Whimper at the end
    setTimeout(() => playWhimper(2), 700);
}

function playPacWin() {
    chord([523, 659, 784, 1046, 1319, 1568], { dur: 1.3, peak: 0.24, wet: 0.6, modDepth: 1.8, stagger: 40, sub: 0.35 });
    setTimeout(() => playLaugh(3), 350);
    setTimeout(() => sparkle({ count: 10, lo: 2000, hi: 4400, peak: 0.12, wet: 0.8, spread: 250 }), 500);
}

// -----------------------------------------------------------------------------
// STT / AI feedback
// -----------------------------------------------------------------------------
function playMicOpen() {
    chime(587, { dur: 0.25, peak: 0.14, wet: 0.4, modDepth: 1, modRatio: 2.01 });
    setTimeout(() => chime(880, { dur: 0.3, peak: 0.14, wet: 0.45, modDepth: 1, modRatio: 2.01 }), 75);
}
function playMicClose() {
    chime(880, { dur: 0.22, peak: 0.12, wet: 0.4 });
    setTimeout(() => chime(587, { dur: 0.26, peak: 0.12, wet: 0.45 }), 75);
}
function playMicSuccess() {
    chime(2093, { dur: 0.32, peak: 0.12, wet: 0.6, modRatio: 2.01, modDepth: 1 });
}
function playThinking() {
    sparkle({ count: 3, lo: 2400, hi: 3600, peak: 0.07, wet: 0.75, spread: 160 });
}

// -----------------------------------------------------------------------------
// Ambient per stage — each stage has a distinctive palette/character
// -----------------------------------------------------------------------------

// Per-stage ambient spec: base frequencies (chord), filter color, LFOs, and
// special layers (womb heartbeat, cradle bells, choir, bowl, etc.).
function stageAmbientSpec(stage) {
    const s = clamp(stage | 0, 0, 7);
    // Peaks slightly lowered overall — the pad should sit behind gameplay,
    // not in front. "chordCycle" lists a few voicings the pad gently drifts
    // through over the course of minutes, giving natural variety.
    const specs = [
        // 0 Syrma — womb: deep heartbeat + distant choir whispers + warm sub
        { freqs: [55, 82.5, 110], cutoff: 380, detune: 5, peak: 0.13, lfoRate: 0.04, filterLfo: 0.05,
          wombPulse: true, distantChoir: true, tag: 'womb',
          chordCycle: [0, 2, -3, 0] },     // tiny semitone shifts
        // 1 Lali-na — tender cradle bells + soft breathing pad
        { freqs: [65.4, 98.0, 130.8], cutoff: 500, detune: 6, peak: 0.12, lfoRate: 0.05, filterLfo: 0.06,
          cradleBells: true, tag: 'cradle',
          chordCycle: [0, 3, 5, 2] },
        // 2 Lali-shi — sparkling wind chimes + airy texture
        { freqs: [73.4, 110, 146.8], cutoff: 650, detune: 7, peak: 0.11, lfoRate: 0.06, filterLfo: 0.07,
          windChimes: true, tag: 'chimes',
          chordCycle: [0, 2, 5, 7, 5, 2] },
        // 3 Lali-ko — bouncy pentatonic plucks + warm hum
        { freqs: [82.4, 123.5, 164.8], cutoff: 800, detune: 8, peak: 0.11, lfoRate: 0.07, filterLfo: 0.08,
          pentaPluck: true, tag: 'play',
          chordCycle: [0, 4, 7, 5, 2, 7] },
        // 4 Lali-ren — expansive warm pad with gentle pulse
        { freqs: [98, 147, 196], cutoff: 950, detune: 9, peak: 0.12, lfoRate: 0.08, filterLfo: 0.09,
          softPulse: true, tag: 'warm',
          chordCycle: [0, -3, 4, 2] },
        // 5 Lali-vox — rich cosmic pad with choir shimmer
        { freqs: [110, 164.8, 220], cutoff: 1100, detune: 10, peak: 0.13, lfoRate: 0.09, filterLfo: 0.10,
          choirHint: true, tag: 'cosmic',
          chordCycle: [0, 5, 3, 7, 2] },
        // 6 Lali-mere — resonant deep drone + singing bowl
        { freqs: [73.4, 110, 146.8, 293.7], cutoff: 700, detune: 6, peak: 0.13, lfoRate: 0.035, filterLfo: 0.04,
          bowl: true, tag: 'bowl',
          chordCycle: [0, 2, -5, 0] },
        // 7 Lali-thishi — transcendent ethereal chords, wide reverb
        { freqs: [130.8, 196, 261.6, 392], cutoff: 1600, detune: 12, peak: 0.12, lfoRate: 0.10, filterLfo: 0.12,
          choir: true, tag: 'ether',
          chordCycle: [0, 5, 7, 3, 10, 5] },
    ];
    const sp = specs[s];
    sp.stage = s;
    return sp;
}

function startAmbient(stage = 0) {
    if (!_enabled || _reducedMotion) return;
    // Per-user preference: if ambient was disabled from settings, do nothing.
    try {
        if (localStorage.getItem('lalien_ambient_enabled') === '0') return;
    } catch (_) {}
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    const spec = stageAmbientSpec(stage);

    if (ambient) stopAmbient(0.8);

    const nodes = [];
    const timers = [];
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = spec.cutoff;
    lp.Q.value = 0.7;
    out.connect(lp);
    // Higher reverb send for ethereal stages
    const wet = spec.choir ? 0.85 : spec.bowl ? 0.7 : 0.55;
    connectOut(lp, wet);

    // Filter breathing LFO
    const filtLfo = osc('sine', spec.filterLfo);
    const filtLfoG = ctx.createGain();
    filtLfoG.gain.value = Math.max(40, spec.cutoff * 0.25);
    filtLfo.connect(filtLfoG).connect(lp.frequency);
    filtLfo.start();
    nodes.push(filtLfo);

    // Main pad voices
    spec.freqs.forEach((f, i) => {
        for (let d = -1; d <= 1; d += 2) {
            const o = osc(i === spec.freqs.length - 1 ? 'triangle' : 'sine', f, d * spec.detune + (i - 1) * spec.detune);
            const g = ctx.createGain();
            g.gain.value = spec.peak * (d === -1 ? 1.0 : 0.7);
            o.connect(g).connect(out);
            o.start();
            nodes.push(o);
        }
        const lfo = osc('sine', spec.lfoRate + i * 0.015);
        const lfoG = ctx.createGain(); lfoG.gain.value = 3 + i;
        const lastOsc = nodes[nodes.length - 1];
        if (lastOsc && lastOsc.detune) lfo.connect(lfoG).connect(lastOsc.detune);
        lfo.start();
        nodes.push(lfo);
    });

    // --- Per-stage special layers ---

    if (spec.wombPulse) {
        const heart = osc('sine', 50);
        const hg = ctx.createGain(); hg.gain.value = 0.0;
        const pulse = osc('sine', 0.95);
        const pulseG = ctx.createGain(); pulseG.gain.value = 0.1;
        pulse.connect(pulseG).connect(hg.gain);
        heart.connect(hg).connect(out);
        heart.start(); pulse.start();
        nodes.push(heart, pulse);
    }
    if (spec.distantChoir) {
        // Very quiet high shimmer — "angels beyond the veil"
        const f = [523, 659];
        f.forEach((freq, i) => {
            const o = osc('sine', freq, (i - 0.5) * 10);
            const g = ctx.createGain(); g.gain.value = 0;
            const amp = osc('sine', 0.05 + i * 0.03);
            const ampG = ctx.createGain(); ampG.gain.value = 0.006;
            amp.connect(ampG).connect(g.gain);
            o.connect(g).connect(out);
            o.start(); amp.start();
            nodes.push(o, amp);
        });
    }
    if (spec.cradleBells) {
        // Occasional soft bell notes (C major pentatonic)
        const bellFreqs = [523, 659, 784, 1046];
        const fire = () => {
            if (!ambient) return;
            const f = bellFreqs[Math.floor(Math.random() * bellFreqs.length)];
            chime(f, { dur: 1.6, peak: 0.08, wet: 0.75, modRatio: 2.01, modDepth: 1.2, sub: 0.2 });
            const t = setTimeout(fire, 7000 + Math.random() * 5000);
            timers.push(t);
        };
        timers.push(setTimeout(fire, 3500 + Math.random() * 3000));
    }
    if (spec.windChimes) {
        // Rare wind chime clusters
        const fire = () => {
            if (!ambient) return;
            const base = [1175, 1319, 1568, 1760][Math.floor(Math.random() * 4)];
            for (let i = 0; i < 3; i++) {
                timers.push(setTimeout(() => chime(base * (1 + i * 0.15), { dur: 1.0, peak: 0.06, wet: 0.8, modRatio: 2.01, modDepth: 1 }), i * 140));
            }
            timers.push(setTimeout(fire, 9000 + Math.random() * 7000));
        };
        timers.push(setTimeout(fire, 4500));
    }
    if (spec.pentaPluck) {
        // Playful pentatonic plucks sparsely
        const penta = [440, 494, 554, 659, 740, 880];
        const fire = () => {
            if (!ambient) return;
            const f = penta[Math.floor(Math.random() * penta.length)];
            chime(f, { dur: 0.4, peak: 0.08, wet: 0.6, modRatio: 3.01, modDepth: 2, sub: 0.2 });
            timers.push(setTimeout(fire, 4500 + Math.random() * 4000));
        };
        timers.push(setTimeout(fire, 3000));
    }
    if (spec.softPulse) {
        // Slow 4/4 breathing amplitude on a sub-layer
        const pulseG = ctx.createGain(); pulseG.gain.value = 1.0;
        const lfo = osc('sine', 0.25);
        const lg = ctx.createGain(); lg.gain.value = 0.4;
        lfo.connect(lg).connect(pulseG.gain);
        out.connect(pulseG);
        // No additional tone — we just modulate existing pad via an extra node pass
        lfo.start();
        nodes.push(lfo);
    }
    if (spec.choirHint) {
        // Mid-high vowel shimmer — "aaah" background
        const vfreqs = [440, 659, 880];
        vfreqs.forEach((freq, i) => {
            const o = osc('sawtooth', freq, (i - 1) * 8);
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass'; bp.frequency.value = 1400 + i * 200; bp.Q.value = 5;
            const g = ctx.createGain(); g.gain.value = 0;
            const amp = osc('sine', 0.08 + i * 0.02);
            const ampG = ctx.createGain(); ampG.gain.value = 0.005;
            amp.connect(ampG).connect(g.gain);
            o.connect(bp).connect(g).connect(out);
            o.start(); amp.start();
            nodes.push(o, amp);
        });
    }
    if (spec.bowl) {
        // Tibetan singing bowl — occasional deep ring
        const fire = () => {
            if (!ambient) return;
            const t0 = now();
            [110, 221, 332, 443].forEach((freq, i) => {
                const o = osc('sine', freq);
                const g = ctx.createGain();
                o.connect(g).connect(out);
                env(g, t0, { a: 0.3 + i * 0.05, d: 0.4, s: 0.5, r: 2.5 - i * 0.2, peak: 0.05 / (1 + i * 0.6) });
                o.start(t0); o.stop(t0 + 3.2);
            });
            timers.push(setTimeout(fire, 12000 + Math.random() * 6000));
        };
        timers.push(setTimeout(fire, 5000));
    }
    if (spec.choir) {
        const chs = [1568, 2093, 2637, 3136];
        chs.forEach((f, i) => {
            const o = osc('sine', f, (i - 1.5) * 6);
            const g = ctx.createGain(); g.gain.value = 0.0;
            const amp = osc('sine', 0.07 + i * 0.02);
            const ampG = ctx.createGain(); ampG.gain.value = 0.012;
            amp.connect(ampG).connect(g.gain);
            o.connect(g).connect(out);
            o.start(); amp.start();
            nodes.push(o, amp);
        });
    }

    // --- Master breathing LFO (slow, ±15% on out.gain) ---------------------
    // Gives the whole ambient bed a very slow "living" swell — like distant
    // waves. Period ≈ 70 seconds.
    const breatheLfo = osc('sine', 0.014);
    const breatheG = ctx.createGain();
    breatheG.gain.value = 0.15;
    breatheLfo.connect(breatheG).connect(out.gain);
    breatheLfo.start();
    nodes.push(breatheLfo);

    // --- Slow chord drift ---------------------------------------------------
    // Every 45–80 seconds we transpose the pad voices by a few semitones along
    // a short musical cycle defined per-stage. Transitions use a 6-second
    // linearRampToValueAtTime on each voice's frequency so nothing clicks.
    // This is the main "variety" layer — subtle but keeps the pad alive.
    const mainVoices = [];
    let nodeScan = 1;  // skip filtLfo at index 0
    spec.freqs.forEach(() => {
        mainVoices.push(nodes[nodeScan]); nodeScan++;
        mainVoices.push(nodes[nodeScan]); nodeScan++;
        nodeScan++;  // skip the per-voice lfo
    });
    const baseFreqs = [];
    spec.freqs.forEach(f => { baseFreqs.push(f, f); });

    // --- Sparse melodic motifs --------------------------------------------
    // Every ~18-45 seconds, 2-3 soft pentatonic notes float above the pad,
    // detuned per-stage so each stage has its own "voice". This is what the
    // keeper remembers humming later — the thing that turns the drone into
    // *music*, not just ambient bed.
    const MOTIF_SCALES = [
        [196, 220, 261.6, 329.6],        // G3 A3 C4 E4 — womb: low, warm
        [261.6, 329.6, 392, 440],        // C4 E4 G4 A4 — cradle: innocent major
        [261.6, 311.1, 392, 466.2],      // C4 Eb4 G4 Bb4 — chimes: dorian colour
        [392, 440, 523.3, 587.3, 659.3], // G4 A4 C5 D5 E5 — play: pentatonic bright
        [293.7, 349.2, 440, 523.3],      // D4 F4 A4 C5 — warm: minor 7
        [440, 523.3, 587.3, 659.3, 784], // A4 C5 D5 E5 G5 — cosmic: airy
        [196, 293.7, 349.2, 523.3],      // G3 D4 F4 C5 — bowl: meditative gap
        [523.3, 659.3, 784, 988],        // C5 E5 G5 B5 — ether: celestial
    ];
    if (true) {
        const scale = MOTIF_SCALES[s] || MOTIF_SCALES[4];
        const motif = () => {
            if (!ambient) return;
            const noteCount = 2 + Math.floor(Math.random() * 3);   // 2-4 notes
            for (let i = 0; i < noteCount; i++) {
                const hz = scale[Math.floor(Math.random() * scale.length)];
                const startOffset = i * (0.35 + Math.random() * 0.6);
                timers.push(setTimeout(() => {
                    if (!ambient) return;
                    const t = ctx.currentTime;
                    // Primary voice — sine with bell-like FM shimmer layer
                    const o = osc('sine', hz, (Math.random() - 0.5) * 4);
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.0001, t);
                    g.gain.exponentialRampToValueAtTime(0.055, t + 0.22);
                    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
                    o.connect(g);
                    // Route through reverb for lingering tail
                    connectOut(g, 0.75);
                    o.start(t);
                    o.stop(t + 3.0);
                    // Second voice one octave up, quieter — gives shimmer
                    if (Math.random() < 0.55) {
                        const o2 = osc('sine', hz * 2, (Math.random() - 0.5) * 6);
                        const g2 = ctx.createGain();
                        g2.gain.setValueAtTime(0.0001, t);
                        g2.gain.exponentialRampToValueAtTime(0.022, t + 0.12);
                        g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
                        o2.connect(g2);
                        connectOut(g2, 0.85);
                        o2.start(t);
                        o2.stop(t + 1.9);
                    }
                }, startOffset * 1000));
            }
            timers.push(setTimeout(motif, (16 + Math.random() * 28) * 1000));
        };
        timers.push(setTimeout(motif, (8 + Math.random() * 7) * 1000));
    }

    // --- Slow counter-melody — deeper, rarer, wide-interval phrases --------
    // A second melodic voice that fires every 70-140s with 3-5 notes from
    // the lower half of the scale. Adds "conversation" between layers.
    {
        const lowerScale = (MOTIF_SCALES[s] || MOTIF_SCALES[4]).slice(0, 3).map(hz => hz * 0.5);
        const counter = () => {
            if (!ambient) return;
            const noteCount = 3 + Math.floor(Math.random() * 3);
            for (let i = 0; i < noteCount; i++) {
                const hz = lowerScale[Math.floor(Math.random() * lowerScale.length)];
                const startOffset = i * (0.8 + Math.random() * 0.6);
                timers.push(setTimeout(() => {
                    if (!ambient) return;
                    const t = ctx.currentTime;
                    const o = osc('triangle', hz, (Math.random() - 0.5) * 3);
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.0001, t);
                    g.gain.exponentialRampToValueAtTime(0.035, t + 0.4);
                    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
                    o.connect(g);
                    connectOut(g, 0.7);
                    o.start(t);
                    o.stop(t + 3.7);
                }, startOffset * 1000));
            }
            timers.push(setTimeout(counter, (70 + Math.random() * 70) * 1000));
        };
        timers.push(setTimeout(counter, (40 + Math.random() * 40) * 1000));
    }

    // --- Slow filter swell — every 90-180s, the filter cutoff climbs and
    //     returns, giving the pad a 12-18 second "breath" of brightness.
    {
        const swell = () => {
            if (!ambient) return;
            const t = ctx.currentTime;
            const dur = 14 + Math.random() * 4;
            const peak = spec.cutoff * 2.0;
            lp.frequency.cancelScheduledValues(t);
            lp.frequency.setValueAtTime(lp.frequency.value, t);
            lp.frequency.linearRampToValueAtTime(peak, t + dur / 2);
            lp.frequency.linearRampToValueAtTime(spec.cutoff, t + dur);
            timers.push(setTimeout(swell, (90 + Math.random() * 90) * 1000));
        };
        timers.push(setTimeout(swell, (55 + Math.random() * 35) * 1000));
    }

    if (spec.chordCycle && mainVoices.length) {
        const cycle = spec.chordCycle;
        let cycleIdx = 0;
        const shift = () => {
            if (!ambient) return;
            cycleIdx = (cycleIdx + 1) % cycle.length;
            const semi = cycle[cycleIdx];
            const ratio = Math.pow(2, semi / 12);
            const ramp = 6;   // seconds
            const t = ctx.currentTime;
            mainVoices.forEach((voice, i) => {
                if (!voice || !voice.frequency) return;
                voice.frequency.cancelScheduledValues(t);
                voice.frequency.setValueAtTime(voice.frequency.value, t);
                voice.frequency.linearRampToValueAtTime(baseFreqs[i] * ratio, t + ramp);
            });
            timers.push(setTimeout(shift, (45 + Math.random() * 35) * 1000));
        };
        timers.push(setTimeout(shift, (30 + Math.random() * 20) * 1000));
    }

    const t0 = now();
    out.gain.cancelScheduledValues(t0);
    out.gain.setValueAtTime(0.0001, t0);
    // Soft target — the ambient bed should sit quietly under everything.
    // 0.55 leaves headroom for pet chirps, TTS and minigame synths without
    // becoming an invasive carpet. Duck is applied separately to this value.
    // Lowered from 0.55 → 0.32 per user feedback: ambient bed was too loud
    // in the mix. Now sits well under SFX / TTS / synth voices.
    out.gain.exponentialRampToValueAtTime(0.32, t0 + 3.5);

    ambient = { nodes, out, stage, timers };
}

function stopAmbient(fadeSeconds = 1.2) {
    if (!ambient || !ctx) return;
    const t0 = now();
    const { nodes, out, timers } = ambient;
    try {
        out.gain.cancelScheduledValues(t0);
        out.gain.setValueAtTime(out.gain.value, t0);
        out.gain.exponentialRampToValueAtTime(0.0001, t0 + fadeSeconds);
    } catch (_) {}
    if (timers) timers.forEach(t => clearTimeout(t));
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
    init() {
        loadPrefs();
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
    resume() {
        if (!ensureCtx()) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    /** Expose the AudioContext + master bus so minigame synths share them. */
    getAudioContext() { ensureCtx(); return ctx; },
    getMasterBus()    { ensureCtx(); return master; },
    /** Reverb send bus — connect a gain into this to feed the shared
     *  convolution reverb. Use sparingly (0.15–0.5 send gain) to keep the
     *  mix clear. Returns null if audio graph is not ready. */
    getReverbBus()    { ensureCtx(); return revBus; },
    /** Per-user toggle for the stage ambient bed, persisted separately from
     *  the SFX master. When disabled, stopAmbient is called and startAmbient
     *  becomes a no-op until re-enabled. */
    isAmbientEnabled() {
        try { return localStorage.getItem('lalien_ambient_enabled') !== '0'; }
        catch { return true; }
    },
    setAmbientEnabled(on) {
        try { localStorage.setItem('lalien_ambient_enabled', on ? '1' : '0'); } catch (_) {}
        if (on) {
            // Start at the stage the pet is currently in; caller may re-invoke
            // startAmbient explicitly with a stage.
            try {
                import('../pet/pet.js').then(m => {
                    startAmbient(m.Pet && m.Pet.getStage ? m.Pet.getStage() : 0);
                }).catch(() => {});
            } catch (_) {}
        } else {
            stopAmbient(0.6);
        }
    },
    /** Duck the stage ambient drone down so an in-foreground synth can be
     *  heard clearly. factor is a multiplier (0..1), fadeMs the ramp length. */
    duckAmbient(factor = 0.08, fadeMs = 600) {
        if (!ambient || !ctx) return;
        const t = now();
        ambient.out.gain.cancelScheduledValues(t);
        ambient.out.gain.setValueAtTime(ambient.out.gain.value, t);
        ambient.out.gain.linearRampToValueAtTime(Math.max(0.0001, factor), t + fadeMs / 1000);
    },
    unduckAmbient(fadeMs = 1200) {
        if (!ambient || !ctx) return;
        const t = now();
        ambient.out.gain.cancelScheduledValues(t);
        ambient.out.gain.setValueAtTime(ambient.out.gain.value, t);
        // Restore to the soft baseline — see startAmbient's fade-in target.
        ambient.out.gain.linearRampToValueAtTime(0.32, t + fadeMs / 1000);
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
    playClick, playToggle, playToast, playSuccess,
    playScreenIn, playScreenOut, playTutorialTip, playError,
    playLogin, playCloudSync, playNeedTap,

    // Pet actions
    playPoke, playCaress, playFeed, playSleep, playClean, playTalk, playMeditate, playChirp,

    // Mood voice
    playMoodChirp,
    playSleepYawn, playSnore, playMunch, playCough, playWhimper, playGrumble,
    playMeditateHum, playLaugh, playYay, playSniff, playSigh, playHiccup,
    playPetMelody,

    // Activity loops
    startSnoreLoop, stopSnoreLoop,
    startMunchLoop, stopMunchLoop,
    startMeditateHumLoop, stopMeditateHumLoop,
    startCoughLoop, stopCoughLoop,
    startWhimperLoop, stopWhimperLoop,
    startGrumbleLoop, stopGrumbleLoop,
    stopAllActivityLoops,

    // Generic games
    playGameWin, playGameLose, playLevelUp, playHeartbeat,

    // Minigame-specific
    playEchoNode, playEchoSuccess, playEchoFail,
    playCleanseSparkle, playCleanseFlinch, playCleanseComplete,
    playStarEdge, playStarSelect, playStarConstellation, playStarSessionComplete,

    // Tetris
    playTetrisLock, playTetrisLineClear, playTetrisGameOver,

    // Pac-Lalì
    playPacPellet, playPacPower, playPacGhostEat, playPacDeath, playPacWin,

    // STT / AI
    playMicOpen, playMicClose, playMicSuccess, playThinking,

    // Lifecycle
    playHatch, playEvolution, playDeath, playRebirth, playTranscendence,

    // Critical
    playNeedCritical, startCriticalAlert, stopCriticalAlert,

    // Ambient
    startAmbient, stopAmbient,
};
