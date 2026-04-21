/**
 * sim-tests.js -- Headless simulation harness.
 *
 * Exports `runAllTests()` callable from the browser dev tools console:
 *     (await import('/js/tools/sim-tests.js')).runAllTests()
 *
 * Each test spins up an isolated Pet (separate from the live one), runs the
 * needs simulation for a virtual number of hours at a given time multiplier,
 * and asserts invariants. The goal is to catch balance and catch-up bugs
 * without having to play the real game for hours.
 *
 * Not wired into the app — purely a developer tool.
 */
import { Needs, NeedType, createNeedsState } from '../pet/needs.js';

// ---------------------------------------------------------------------------
// Minimal pet shell — enough surface for Needs.decay/catchUp to operate.
// ---------------------------------------------------------------------------
function makeTestPet({ stage = 3, needsInit = 100 } = {}) {
    const needs = createNeedsState();
    for (let i = 0; i < NeedType.COUNT; i++) {
        needs[i] = typeof needsInit === 'function' ? needsInit(i) : needsInit;
    }
    return { stage, needs };
}

function snapshot(pet) {
    return {
        KORA:      Math.round(pet.needs[NeedType.KORA]),
        MOKO:      Math.round(pet.needs[NeedType.MOKO]),
        MISKA:     Math.round(pet.needs[NeedType.MISKA]),
        NASHI:     Math.round(pet.needs[NeedType.NASHI]),
        HEALTH:    Math.round(pet.needs[NeedType.HEALTH]),
        COGNITION: Math.round(pet.needs[NeedType.COGNITION]),
        AFFECTION: Math.round(pet.needs[NeedType.AFFECTION]),
        CURIOSITY: Math.round(pet.needs[NeedType.CURIOSITY]),
        COSMIC:    Math.round(pet.needs[NeedType.COSMIC]),
        SECURITY:  Math.round(pet.needs[NeedType.SECURITY]),
    };
}

function avgExclHealth(pet) {
    let s = 0, n = 0;
    for (let i = 0; i < NeedType.COUNT; i++) {
        if (i === NeedType.HEALTH) continue;
        s += pet.needs[i]; n++;
    }
    return s / n;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------
const results = [];
function assert(name, cond, detail = '') {
    results.push({ name, pass: !!cond, detail });
    return !!cond;
}

function assertInRange(name, value, lo, hi) {
    const ok = value >= lo && value <= hi;
    return assert(name, ok, `got ${value}, expected [${lo}, ${hi}]`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testCatchUp2h() {
    const pet = makeTestPet();
    Needs.resetTracking();
    Needs.catchUp(pet.needs, 2 * 3600, pet.stage);
    const s = snapshot(pet);
    assertInRange('catch-up 2h · KORA healthy',   s.KORA,   45, 75);
    assertInRange('catch-up 2h · MOKO healthy',   s.MOKO,   60, 85);
    assert      ('catch-up 2h · HEALTH 100',       s.HEALTH === 100);
    assert      ('catch-up 2h · NOT dead',         s.HEALTH > 15);
}

function testCatchUp8h() {
    const pet = makeTestPet();
    Needs.resetTracking();
    Needs.catchUp(pet.needs, 8 * 3600, pet.stage);
    const s = snapshot(pet);
    assertInRange('catch-up 8h · KORA >= floor',   s.KORA,   12, 50);
    assertInRange('catch-up 8h · HEALTH alive',    s.HEALTH, 70, 100);
    assert       ('catch-up 8h · survivable',      s.HEALTH > 30);
}

function testCatchUp24h() {
    const pet = makeTestPet();
    Needs.resetTracking();
    Needs.catchUp(pet.needs, 24 * 3600, pet.stage);
    const s = snapshot(pet);
    assert      ('catch-up 24h · critical but not zeroed (needs)',  s.KORA >= 10 && s.KORA <= 35);
    assert      ('catch-up 24h · HEALTH respects floor', s.HEALTH >= 10);
}

function testCatchUp72h() {
    const pet = makeTestPet();
    Needs.resetTracking();
    Needs.catchUp(pet.needs, 72 * 3600, pet.stage);
    const s = snapshot(pet);
    // No floor past 24h — permadeath path must be reachable
    assert('catch-up 72h · HEALTH collapses (permadeath path open)', s.HEALTH <= 15);
}

function testRealTimeDecay() {
    // Simulate real-time continuous care: 8 hours with perfect feeding
    // every hour (KORA stays full) — HEALTH should remain high.
    const pet = makeTestPet();
    Needs.resetTracking();
    for (let hour = 0; hour < 8; hour++) {
        // one hour of decay in 60 chunks of 60 seconds at 1x
        for (let m = 0; m < 60; m++) Needs.decay(pet.needs, 60, pet.stage);
        // Refill all needs to 95 (represents an attentive keeper)
        for (let i = 0; i < NeedType.COUNT; i++) {
            if (i === NeedType.HEALTH) continue;
            pet.needs[i] = 95;
        }
    }
    const s = snapshot(pet);
    assert      ('cared-for 8h · HEALTH recovered',    s.HEALTH >= 90);
    assert      ('cared-for 8h · othersAvg high',      avgExclHealth(pet) >= 80);
}

function testNeglectCollapses() {
    // Real-time decay with NO intervention: after 6 hours HEALTH should drop
    // significantly as othersAvg crashes, proving the death pipeline works
    // when the keeper truly neglects the pet (vs the gentler offline catch-up).
    const pet = makeTestPet();
    Needs.resetTracking();
    for (let sec = 0; sec < 6 * 3600; sec++) {
        Needs.decay(pet.needs, 1, pet.stage);
    }
    const s = snapshot(pet);
    assert('neglect 6h real-time · KORA starved', s.KORA < 10);
    assert('neglect 6h real-time · HEALTH dropped', s.HEALTH < 90);
}

function testFeedRestores() {
    const pet = makeTestPet({ needsInit: 20 });
    Needs.resetTracking();
    const before = pet.needs[NeedType.KORA];
    Needs.feed(pet.needs);
    const after = pet.needs[NeedType.KORA];
    assert('feed · restores KORA', after > before + 25 && after <= 100);
}

function testCleanRestores() {
    const pet = makeTestPet({ needsInit: 10 });
    Needs.resetTracking();
    const before = pet.needs[NeedType.MISKA];
    Needs.clean(pet.needs);
    const after = pet.needs[NeedType.MISKA];
    assert('clean · restores MISKA', after > before + 25 && after <= 100);
}

function testHealthConvergesUpward() {
    // If othersAvg is high (~90) and HEALTH is low, it should trend UP.
    const pet = makeTestPet({ needsInit: 90 });
    pet.needs[NeedType.HEALTH] = 40;
    Needs.resetTracking();
    for (let i = 0; i < 600; i++) Needs.decay(pet.needs, 1, pet.stage);
    assert('HEALTH converges UP when cared for', pet.needs[NeedType.HEALTH] > 42);
}

function testHealthConvergesDownward() {
    // If othersAvg is very low, HEALTH should trend DOWN.
    const pet = makeTestPet({ needsInit: 10 });
    pet.needs[NeedType.HEALTH] = 80;
    Needs.resetTracking();
    for (let i = 0; i < 600; i++) Needs.decay(pet.needs, 1, pet.stage);
    assert('HEALTH converges DOWN when neglected', pet.needs[NeedType.HEALTH] < 78);
}

function testGameTimeAdvances() {
    // Pathological timers rely on _gameTimeSeconds advancing by timeMult.
    Needs.resetTracking();
    const t0 = Needs.getGameTimeSeconds();
    const pet = makeTestPet();
    Needs.decay(pet.needs, 3600, pet.stage);   // one hour in one call
    const t1 = Needs.getGameTimeSeconds();
    assert('_gameTimeSeconds advances by timeMult', t1 - t0 >= 3500);
}

function testEmoCoupling() {
    // Pet with high NASHI but crushed COGNITION/AFFECTION/CURIOSITY/SECURITY
    // should see NASHI drift down — you can't be euphoric while also apathetic
    // and lonely. Simulate 20 minutes of real-time decay.
    const pet = makeTestPet({ needsInit: (i) => (i === NeedType.NASHI ? 100 : 5) });
    pet.needs[NeedType.HEALTH] = 80;
    Needs.resetTracking();
    for (let i = 0; i < 20 * 60; i++) Needs.decay(pet.needs, 1, pet.stage);
    assert('emotional coupling · NASHI drifts down when mind/heart empty', pet.needs[NeedType.NASHI] < 60);
    assert('emotional coupling · NASHI stays above floor of 0',           pet.needs[NeedType.NASHI] > 0);
}

function testEmoCouplingSpares() {
    // NASHI at 80 with well-supported other emotions should stay roughly stable.
    const pet = makeTestPet({ needsInit: 80 });
    Needs.resetTracking();
    for (let i = 0; i < 20 * 60; i++) Needs.decay(pet.needs, 1, pet.stage);
    assert('emotional coupling · does not punish well-supported joy', pet.needs[NeedType.NASHI] > 55);
}

function testVocabularyWisdom() {
    // Two identical pets, one with a rich shared lexicon, the other with
    // none. After 30 real minutes of decay, the one with the lexicon should
    // have noticeably more COGNITION left.
    const a = makeTestPet();  // no vocab
    const b = makeTestPet();  // vocab 150 words
    Needs.resetTracking();
    for (let i = 0; i < 30 * 60; i++) Needs.decay(a.needs, 1, a.stage, 1, 0);
    Needs.resetTracking();
    for (let i = 0; i < 30 * 60; i++) Needs.decay(b.needs, 1, b.stage, 1, 150);
    assert('wisdom passive · lexicon slows COGNITION decay',
           b.needs[NeedType.COGNITION] > a.needs[NeedType.COGNITION] + 5);
}

function testFloorRespectsPreState() {
    // If a need started BELOW the floor, catchUp must NOT lift it up to the
    // floor — a pet already starving before the keeper left should still be
    // starving when they return.
    const pet = makeTestPet({ needsInit: 100 });
    pet.needs[NeedType.KORA] = 5;
    Needs.resetTracking();
    Needs.catchUp(pet.needs, 2 * 3600, pet.stage);
    assert('floor respects pre-state (cannot heal a low need)', pet.needs[NeedType.KORA] < 45);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
export async function runAllTests() {
    results.length = 0;

    testCatchUp2h();
    testCatchUp8h();
    testCatchUp24h();
    testCatchUp72h();
    testRealTimeDecay();
    testNeglectCollapses();
    testFeedRestores();
    testCleanRestores();
    testHealthConvergesUpward();
    testHealthConvergesDownward();
    testGameTimeAdvances();
    testEmoCoupling();
    testEmoCouplingSpares();
    testVocabularyWisdom();
    testFloorRespectsPreState();

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass);

    console.group(`%c[SIM-TESTS] ${passed}/${results.length} passed`,
        failed.length ? 'color:#e04848;font-weight:bold'
                      : 'color:#3ecf77;font-weight:bold');
    for (const r of results) {
        const mark = r.pass ? '✓' : '✗';
        const col = r.pass ? 'color:#3ecf77' : 'color:#e04848';
        console.log(`%c${mark} ${r.name}${r.detail ? ' — ' + r.detail : ''}`, col);
    }
    console.groupEnd();

    return { passed, total: results.length, failures: failed };
}
