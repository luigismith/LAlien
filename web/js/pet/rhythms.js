/**
 * rhythms.js -- Circadian cycle + sleep-triggered dreams
 *
 * - Uses local clock: MOKO decays faster at night, NASHI perks at morning,
 *   spontaneous naps possible at post-lunch hours.
 * - Dreams are short LLM-generated narratives produced during a long
 *   enough SLEEPING activity, logged to the diary with a 💭 tag.
 */
import { Pet } from './pet.js';
import { NeedType } from './needs.js';
import { Activity } from './activity.js';
import { Events } from '../engine/events.js';

// ---------------------------------------------------------------------------
// Circadian phases (local time)
// ---------------------------------------------------------------------------
function phase(h) {
    if (h >= 22 || h < 7)   return 'night';     // 22:00 – 06:59
    if (h >= 7  && h < 10)  return 'morning';   // 07:00 – 09:59
    if (h >= 13 && h < 15)  return 'siesta';    // 13:00 – 14:59
    return 'day';
}

let _lastCheckHour = -1;
let _lastNapAttempt = 0;
let _morningPerkedDate = '';

/**
 * Called every logic tick (1Hz).
 * - Accelerates MOKO decay at night if pet is awake.
 * - Applies a one-shot morning NASHI perk.
 * - Offers a spontaneous nap during siesta when MOKO < 50.
 */
function checkRhythm() {
    if (!Pet || !Pet.isAlive || !Pet.isAlive()) return;
    if (Pet.isEgg && Pet.isEgg()) return;

    const nowMs = Date.now();
    const d = new Date();
    const h = d.getHours();
    const p = phase(h);
    const dateKey = d.toISOString().slice(0, 10);

    // ---- Night: if awake, MOKO decays faster (small continuous tax) ----
    if (p === 'night' && !Activity.is(Pet, 'SLEEPING')) {
        // A tiny extra tiredness per tick — 0.02/s * ~3600s/hr = ~72/night max
        Pet.needs[NeedType.MOKO]  = Math.max(0, Pet.needs[NeedType.MOKO]  - 0.02);
        Pet.needs[NeedType.NASHI] = Math.max(0, Pet.needs[NeedType.NASHI] - 0.01);
    }

    // ---- Morning: one-shot cheerful boost if the pet was asleep past dawn ----
    if (p === 'morning' && _morningPerkedDate !== dateKey) {
        _morningPerkedDate = dateKey;
        // If they were asleep, auto-wake with a happy bonus
        if (Activity.is(Pet, 'SLEEPING')) {
            // Graceful exit: force auto-completion with positive end
            try { Activity._exit(Pet, 'duration'); } catch (_) {}
        }
        Pet.needs[NeedType.NASHI]     = Math.min(100, Pet.needs[NeedType.NASHI]     + 5);
        Pet.needs[NeedType.CURIOSITY] = Math.min(100, Pet.needs[NeedType.CURIOSITY] + 4);
        Events.emit('rhythm-morning');
    }

    // ---- Siesta: if tired during early afternoon, propose a spontaneous nap ----
    if (p === 'siesta'
        && nowMs - _lastNapAttempt > 25 * 60 * 1000                // at most once / 25 min
        && Activity.getType(Pet) === 'IDLE'
        && Pet.needs[NeedType.MOKO] < 50) {
        _lastNapAttempt = nowMs;
        if (Math.random() < 0.6) {
            // Short nap: ~4–8 minutes
            Activity.start(Pet, 'SLEEPING', { fromNap: true });
            Events.emit('rhythm-nap');
        }
    }

    _lastCheckHour = h;
}

// ---------------------------------------------------------------------------
// Dream generation during long SLEEPING
// ---------------------------------------------------------------------------
let _dreamedThisSleep = false;

async function maybeGenerateDream() {
    if (!Activity.is(Pet, 'SLEEPING')) { _dreamedThisSleep = false; return; }
    if (_dreamedThisSleep) return;
    const elapsedMs = Date.now() - (Pet.activity.startedAt || Date.now());
    if (elapsedMs < 3 * 60 * 1000) return;   // at least 3 min of sleep

    _dreamedThisSleep = true;
    try {
        const { LLMClient } = await import('../ai/llm-client.js');
        const { DiaryGenerator } = await import('../ai/diary-generator.js');
        if (!LLMClient.isAvailable || !LLMClient.isAvailable()) return;

        const memories = DiaryGenerator.getRecentMemories(5);
        const memBlock = memories.length
            ? memories.map(m => `- ${m.type}: ${m.text}`).join('\n')
            : '- (no memories yet)';

        const sys = [
            'You are the dream voice of a Lalìen — a small alien creature asleep on its keeper\'s world.',
            'Produce ONE short dream (1–2 sentences, max 30 words), fragmented and poetic, weaving one or two real memories.',
            'Mix Italian and fragments of alien words (kora, moko, lalí, thi, kèsma, selath, sha).',
            'Do not address the keeper directly. Do not use emoji.',
            'Return only the dream text — no quotes, no prefix.',
        ].join('\n');
        const userMsg = 'Recent memories:\n' + memBlock;

        const text = await LLMClient.chat(sys, userMsg);
        if (!text) return;

        const trimmed = text.trim().replace(/^"|"$/g, '').slice(0, 280);
        DiaryGenerator.logMemory('dream', trimmed);
        Events.emit('rhythm-dream', { text: trimmed });
    } catch (_) { /* LLM unavailable or error — silent */ }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
let _timer = null;
let _dreamTimer = null;

export const Rhythms = {
    init() {
        if (_timer) clearInterval(_timer);
        _timer = setInterval(checkRhythm, 60 * 1000);     // once a minute
        if (_dreamTimer) clearInterval(_dreamTimer);
        _dreamTimer = setInterval(maybeGenerateDream, 90 * 1000);  // once per 90s check
        // Reset on each activity-start (so a fresh sleep can generate a dream)
        Events.on('activity-start', (ev) => {
            if (ev && ev.type === 'SLEEPING') _dreamedThisSleep = false;
        });
    },

    getPhase() { return phase(new Date().getHours()); },
};
