/**
 * commands.js -- Parse keeper's chat messages for action commands and decide
 * whether the pet will actually perform them.
 *
 * Unlike the LLM reply path (which only produces speech), this module reaches
 * into the simulation: it moves the pet, triggers activities, drops items,
 * plays solo games, refuses, or flinches. Compliance is probabilistic and
 * depends on mood, personality, SULKY/AFRAID/SICK activity, tiredness, and
 * sentiment of the request.
 *
 * Returns { handled, executed, reason, reply? } so the caller can decide
 * whether to still hit the LLM for a follow-up utterance (we do — a short
 * confirmation or refusal over the speech bubble is more alive than silence).
 */
import { Pet } from './pet.js';
import { NeedType, Needs } from './needs.js';
import { Activity } from './activity.js';
import { Events } from '../engine/events.js';

// ---- Command patterns (Italian + English + a few stage-friendly lalien)
// Each entry: { id, re (RegExp), kind: 'move'|'activity'|'emote', need?: NeedType }
const PATTERNS = [
    // Movement / tricks
    { id: 'jump',   re: /\b(salta|salt[ai]|jump|hop)\b/i,              kind: 'move',    cost: 'moko' },
    { id: 'dance',  re: /\b(balla|ball[ai]|danza|dance)\b/i,           kind: 'move',    cost: 'moko' },
    { id: 'spin',   re: /\b(gira|girati|ruota|spin|twirl)\b/i,         kind: 'move',    cost: 'moko' },
    { id: 'sit',    re: /\b(siediti|seduto|sit|sit down)\b/i,          kind: 'move' },
    { id: 'come',   re: /\b(vieni(\s+qui)?|avvicinati|torna\s+qui|come\s+here|come\s+closer)\b/i, kind: 'move' },
    { id: 'stay',   re: /\b(fermo|stai\s+fermo|stop|fermati|stay)\b/i, kind: 'move' },
    { id: 'left',   re: /\b(sinistra|vai\s+a\s+sinistra|left)\b/i,     kind: 'move' },
    { id: 'right',  re: /\b(destra|vai\s+a\s+destra|right)\b/i,        kind: 'move' },
    { id: 'shelter',re: /\b(rifugio|grotta|tana|nasconditi|hide|shelter|cave)\b/i, kind: 'move' },
    // Activities
    { id: 'sleep',  re: /\b(dormi|pisolin[oi]|a\s+nanna|vai\s+a\s+letto|sleep|nap|bedtime)\b/i,        kind: 'activity' },
    { id: 'eat',    re: /\b(mangia|nutriti|cibati|eat|food)\b/i,                                        kind: 'activity' },
    { id: 'wash',   re: /\b(lavati|pulisciti|wash|clean\s+yourself|bath)\b/i,                          kind: 'activity' },
    { id: 'meditate',re: /\b(medita|meditazione|meditate)\b/i,                                          kind: 'activity' },
    { id: 'wake',   re: /\b(svegliati|alzati|wake\s+up|wake)\b/i,                                       kind: 'activity' },
    // Expressive / solo
    { id: 'sing',   re: /\b(canta|cantami|sing|song)\b/i,              kind: 'emote' },
    { id: 'speak',  re: /\b(parla|dì|di[mc]mi|say\s+something|speak)\b/i, kind: 'emote' },
    { id: 'quiet',  re: /\b(zitto|silenzio|taci|shh+|be\s+quiet|hush)\b/i, kind: 'emote' },
    { id: 'play',   re: /\b(gioca|gioc(h|a)?iamo|divertiti|play)\b/i,  kind: 'move' },
];

// ---- Replies (short, stage-agnostic) — used when the LLM call is skipped
const REPLIES = {
    comply: {
        jump:     ['ko! thi!', 'la-shi!', 'ven-thi!', 'shi shi!'],
        dance:    ['la-la-la!', 'ko-thi ven!', 'kesma-thi la!'],
        spin:     ['la-la shi!', 'ven-kora! la!'],
        sit:      ['ko… mmh.', 'shi… thi.'],
        come:     ['ven-thi!', 'lalí! ko!', 'thi-thi!'],
        stay:     ['ko.', 'mmh… ko.', 'shi.'],
        left:     ['ko!', 'ven-la!'],
        right:    ['ko!', 'shi-thi!'],
        shelter:  ['ven-thi… kesma.', 'shi… moko.', 'sha-la… ven.'],
        sleep:    ['moko… thi.', 'Zzz… lalí.', 'sha-la moko…'],
        eat:      ['kora! thi-thi!', 'ko-ra ven!', 'shi! kora!'],
        wash:     ['miska… ko. thi.', 'vythi… thi.'],
        meditate: ['selath… thi.', 'ko… ven-selath.'],
        wake:     ['shi?! ko… thi.', 'sha… mmh… ko.'],
        sing:     ['la-la-la… shi-la!', 'mo-ko-la-la thi!'],
        speak:    ['lalí! thi-thi!', 'ko ko thi!', 'shi la-la!'],
        quiet:    ['...', 'mmh.', '…thi.'],
        play:     ['ven! la-shi!', 'shi-thi! ven!'],
    },
    refuse: {
        jump:     ['sha… moko.', 'sha-sha. stanco.', 'mmh… sha.'],
        dance:    ['sha-la… non ora.', 'sha. no-thi.'],
        spin:     ['sha. girami la testa.', 'sha-sha.'],
        sit:      ['sha. ven-stare.', 'ko… già seduto.'],
        come:     ['sha… resta tu.', 'sha-sha, ven tu.'],
        stay:     ['sha! ven-kora!', 'no-thi, ven.'],
        sleep:    ['sha. non moko.', 'mmh… sha, non adesso.'],
        eat:      ['sha… sazio.', 'mmh… sha, kora ko già.'],
        wash:     ['sha! acqua no!', 'sha-sha, miska ko.'],
        meditate: ['sha. pensieri tanti.', 'sha-sha.'],
        play:     ['sha-sha. moko ven.', 'mmh… sha, stanco.'],
        default:  ['sha.', 'mmh… sha.', 'no-thi.', 'sha-sha.'],
    },
    cant: {
        sleep:    ['non qui… sha.', 'sha, già sveglio ora.'],
        wake:     ['sha, già sveglio.'],
        eat:      ['non c\'è kora… sha.'],
        default:  ['sha… non riesco.'],
    },
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

function personalityBias() {
    const t = Pet.dna?.personalityTraits ?? 0;
    return {
        calm:          !!(t & 0x02),
        anxious:       !!(t & 0x04),
        playful:       !!(t & 0x08),
        affectionate:  !!(t & 0x10),
        curious:       !!(t & 0x01),
    };
}

function complianceProb(cmd) {
    const n = Pet.needs;
    const act = Activity.getType(Pet);
    const p = personalityBias();
    let prob = 0.72;

    // Relationship
    if (n[NeedType.AFFECTION] > 70) prob += 0.12;
    if (n[NeedType.AFFECTION] < 25) prob -= 0.25;

    // Mood / state
    if (act === 'SULKY')  prob -= 0.45;
    if (act === 'AFRAID') prob -= 0.30;
    if (act === 'SICK')   prob -= 0.25;

    // Tiredness for physical commands
    if (cmd.cost === 'moko' && n[NeedType.MOKO] < 30) prob -= 0.35;
    if (cmd.cost === 'moko' && n[NeedType.MOKO] < 15) prob -= 0.2;

    // Personality nudges
    if (p.playful && (cmd.id === 'jump' || cmd.id === 'dance' || cmd.id === 'play' || cmd.id === 'spin')) prob += 0.15;
    if (p.calm    && (cmd.id === 'jump' || cmd.id === 'dance' || cmd.id === 'spin')) prob -= 0.10;
    if (p.anxious && (cmd.id === 'shelter' || cmd.id === 'come')) prob += 0.20;
    if (p.affectionate && cmd.id === 'come') prob += 0.20;

    // Hunger/boredom lowers willingness broadly
    if (n[NeedType.KORA]  < 20) prob -= 0.2;
    if (n[NeedType.NASHI] < 20) prob -= 0.15;

    // Babies barely obey before stage 2
    if (Pet.stage < 2) prob -= 0.3;

    return clamp(prob, 0.05, 0.98) / 100 * 100;  // keep 0..1
}

// ---------------------------------------------------------------------------
// Execution per command (returns 'ok' | 'cant' | 'noop')
// ---------------------------------------------------------------------------
function canvasWidth() { return document.getElementById('game-canvas')?.width || 800; }

function ensureMotion() {
    if (!Pet.motion) {
        Pet.motion = { offsetX: 0, offsetY: 0, targetOffsetX: 0, targetOffsetY: 0, scaleBoost: 0, targetScaleBoost: 0, bob: 0, mood: 'neutral' };
    }
}

async function doHop() {
    ensureMotion();
    Pet.motion.targetOffsetY = -36;
    Pet.motion.targetScaleBoost = 0.10;
    setTimeout(() => { if (Pet.motion) { Pet.motion.targetOffsetY = 0; Pet.motion.targetScaleBoost = 0; } }, 380);
    // Second bounce for good measure
    setTimeout(() => { if (Pet.motion) { Pet.motion.targetOffsetY = -24; } }, 520);
    setTimeout(() => { if (Pet.motion) { Pet.motion.targetOffsetY = 0; } }, 800);
    // Costs some MOKO
    Pet.needs[NeedType.MOKO] = clamp(Pet.needs[NeedType.MOKO] - 2);
    Pet.needs[NeedType.NASHI] = clamp(Pet.needs[NeedType.NASHI] + 3);
}

function doSpin() {
    ensureMotion();
    let i = 0;
    const swing = () => {
        if (!Pet.motion || i >= 6) { if (Pet.motion) { Pet.motion.targetOffsetX = 0; Pet.motion.targetScaleBoost = 0; } return; }
        Pet.motion.targetOffsetX = (i % 2 === 0 ? 18 : -18);
        Pet.motion.targetScaleBoost = (i % 2 === 0 ? 0.06 : -0.06);
        i++;
        setTimeout(swing, 160);
    };
    swing();
    Pet.needs[NeedType.NASHI] = clamp(Pet.needs[NeedType.NASHI] + 4);
}

async function doDance() {
    try {
        const { SoloGames } = await import('./solo-games.js');
        SoloGames.cancel();
    } catch (_) {}
    // Trigger the shadow_dance solo game programmatically
    try {
        const { SoloGames } = await import('./solo-games.js');
        Pet._soloGame = { key: 'shadow_dance', startedAt: Date.now(), endsAt: Date.now() + 12000, data: { spin: 0 } };
    } catch (_) {}
    Pet.needs[NeedType.NASHI] = clamp(Pet.needs[NeedType.NASHI] + 6);
    Pet.needs[NeedType.MOKO]  = clamp(Pet.needs[NeedType.MOKO]  - 3);
}

function doSit() {
    ensureMotion();
    Pet.motion.targetScaleBoost = -0.10;
    Pet.motion.targetOffsetY = 6;
    setTimeout(() => { if (Pet.motion) { Pet.motion.targetScaleBoost = 0; Pet.motion.targetOffsetY = 0; } }, 3000);
}

function doCome() {
    ensureMotion();
    Pet.motion.targetOffsetX = 0;
    Pet.motion.targetOffsetY = -2;
    setTimeout(() => { if (Pet.motion) Pet.motion.targetOffsetY = 0; }, 1200);
    Pet.needs[NeedType.AFFECTION] = clamp(Pet.needs[NeedType.AFFECTION] + 4);
}

function doStay() {
    ensureMotion();
    Pet.motion.targetOffsetX = Pet.motion.offsetX;
    Pet.motion.targetOffsetY = 0;
}

function doLeft()  { ensureMotion(); Pet.motion.targetOffsetX = -Math.min(150, canvasWidth() * 0.3); }
function doRight() { ensureMotion(); Pet.motion.targetOffsetX =  Math.min(150, canvasWidth() * 0.3); }

function doShelter() {
    ensureMotion();
    Pet.motion.targetOffsetX = Math.floor(canvasWidth() * 0.39);
    Pet.motion.targetOffsetY = 0;
}

function doSleep() {
    const res = Activity.start(Pet, Activity.Type.SLEEPING, { reason: 'command' });
    return res && res.ok ? 'ok' : 'cant';
}

function doWake() {
    if (Activity.is(Pet, Activity.Type.SLEEPING)) {
        // Gentle wake, no grumpy penalty
        Activity._exit(Pet, 'interrupt');
        return 'ok';
    }
    return 'cant';
}

function doEat() {
    const res = Activity.start(Pet, Activity.Type.EATING, { cap: 100 });
    if (!res || !res.ok) {
        // No activity available — fall back to manual feed
        Needs.feed(Pet.needs);
    }
    return 'ok';
}

function doWash() {
    Needs.clean(Pet.needs);
    Pet.needs[NeedType.MISKA] = clamp(Pet.needs[NeedType.MISKA] + 15);
    return 'ok';
}

function doMeditate() {
    if (Pet.stage < 6) return 'cant';
    const res = Activity.start(Pet, Activity.Type.MEDITATING);
    return res && res.ok ? 'ok' : 'cant';
}

function doSing() {
    // Audible melody + bubble
    try {
        import('../audio/sound-engine.js').then(m => {
            m.SoundEngine.playPetMelody(Pet.getStage ? Pet.getStage() : 2, { noteCount: 6, stepMs: 210 });
        }).catch(() => {});
    } catch (_) {}
    try { Events.emit('autonomy-speak', { line: 'la-la-la shi-la!', mood: 'happy' }); } catch (_) {}
    Pet.needs[NeedType.NASHI] = clamp(Pet.needs[NeedType.NASHI] + 5);
}

function doQuiet() {
    // Lower speak probability for a bit by bumping the last-speak stamp through events
    try { Events.emit('autonomy-silence', { forMs: 60_000 }); } catch (_) {}
    Pet.needs[NeedType.AFFECTION] = clamp(Pet.needs[NeedType.AFFECTION] - 2);
}

async function doPlay() {
    try {
        const { SoloGames } = await import('./solo-games.js');
        Pet._soloGame = { key: 'chase_firefly', startedAt: Date.now(), endsAt: Date.now() + 18000, data: { fireflyX: 40, fireflyY: -50, phase: 0 } };
    } catch (_) {}
    Pet.needs[NeedType.NASHI] = clamp(Pet.needs[NeedType.NASHI] + 6);
}

async function execute(id) {
    switch (id) {
        case 'jump':     await doHop();   return 'ok';
        case 'dance':    await doDance(); return 'ok';
        case 'spin':     doSpin();        return 'ok';
        case 'sit':      doSit();         return 'ok';
        case 'come':     doCome();        return 'ok';
        case 'stay':     doStay();        return 'ok';
        case 'left':     doLeft();        return 'ok';
        case 'right':    doRight();       return 'ok';
        case 'shelter':  doShelter();     return 'ok';
        case 'sleep':    return doSleep();
        case 'wake':     return doWake();
        case 'eat':      return doEat();
        case 'wash':     return doWash();
        case 'meditate': return doMeditate();
        case 'sing':     doSing();        return 'ok';
        case 'quiet':    doQuiet();       return 'ok';
        case 'speak':    return 'ok';  // caller will let LLM speak
        case 'play':     await doPlay();  return 'ok';
    }
    return 'noop';
}

// ---------------------------------------------------------------------------
export const Commands = {
    /**
     * Called from the chat handler. Returns:
     *   { handled: true, executed: true|false, id, reply, needLlm }
     *   { handled: false }  when no command was detected
     */
    async interpret(text) {
        if (!text) return { handled: false };
        // Lowercase + normalise accents minimally
        const lower = text.toLowerCase();
        // Find the first matching command (most specific wins; we iterate in declaration order)
        const match = PATTERNS.find(p => p.re.test(lower));
        if (!match) return { handled: false };

        // Baby stages can hear but can't execute much
        if (Pet.isEgg && Pet.isEgg()) {
            return { handled: true, executed: false, id: match.id, reply: '…mmm… thi?', needLlm: false };
        }

        // B1: A hungry pet cannot refuse food. Bypass the compliance roll
        // and force acceptance when KORA is low — otherwise the refuse bank
        // will shout "sazio!" at a starving Lalìen.
        const prob = complianceProb(match);
        let willDo = Math.random() < prob;
        if (match.id === 'eat' && Pet.needs[NeedType.KORA] < 45) willDo = true;

        if (!willDo) {
            // Contextual refuse: pick a reason that matches the pet's
            // actual state instead of the generic hardcoded bank.
            let refuseBank = REPLIES.refuse[match.id] || REPLIES.refuse.default;
            if (match.id === 'eat') {
                if (Pet.needs[NeedType.KORA] > 80) {
                    refuseBank = ['sha… sazio.', 'mmh… sha, kora ko già.', 'shai… stomaco pieno.'];
                } else if (Pet.needs[NeedType.MOKO] < 25) {
                    refuseBank = ['sha… troppo moko.', 'mmh… dopo, ora dormo.'];
                } else {
                    refuseBank = ['sha… più tardi.', 'mmh… non adesso.', 'sha-sha, dopo.'];
                }
            } else if (match.id === 'sleep' && Pet.needs[NeedType.MOKO] > 75) {
                refuseBank = ['sha… non stanco.', 'mmh… moko ko, ven-gioco.'];
            } else if (match.id === 'play' && Pet.needs[NeedType.MOKO] < 20) {
                refuseBank = ['sha-sha… troppo moko.', 'sha, ven-riposo.'];
            }
            const reply = pick(refuseBank);
            Pet.needs[NeedType.NASHI] = clamp(Pet.needs[NeedType.NASHI] - 1);
            return { handled: true, executed: false, id: match.id, reply, needLlm: false };
        }

        const result = await execute(match.id);
        if (result === 'cant') {
            const bank = REPLIES.cant[match.id] || REPLIES.cant.default;
            return { handled: true, executed: false, id: match.id, reply: pick(bank), needLlm: false };
        }
        if (result === 'noop') {
            return { handled: false };
        }

        const bank = REPLIES.comply[match.id] || ['ko!'];
        const reply = pick(bank);
        // Affection bump for obeying
        Pet.needs[NeedType.AFFECTION] = clamp(Pet.needs[NeedType.AFFECTION] + 2);
        Pet.needs[NeedType.COGNITION] = clamp(Pet.needs[NeedType.COGNITION] + 1);
        return { handled: true, executed: true, id: match.id, reply, needLlm: false };
    },
};
