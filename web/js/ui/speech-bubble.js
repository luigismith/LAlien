/**
 * speech-bubble.js -- Typewriter text effect with mood variants + TTS
 * Voice evolves with stage: baby-cub (high pitch) → adult → elder (deep)
 */
import { Pet } from '../pet/pet.js';
import { SoundEngine } from '../audio/sound-engine.js';

let _timeout = null;
let _typeInterval = null;

// Mood → pitch/rate offsets (added on top of stage base)
const MOOD_OFFSET = {
    happy:   { pitch: +0.15, rate: +0.10 },
    neutral: { pitch:  0.00, rate:  0.00 },
    sad:     { pitch: -0.20, rate: -0.15 },
    scared:  { pitch: +0.25, rate: +0.25 },
};

// Stage → base voice (pitch, rate) — max pitch=2.0, max rate=2.0 in Web Speech API
// 0 Syrma (egg)  → sussurro squittio
// 1 Lali-na      → neonato piccolissimo (cucciolo appena nato)
// 2 Lali-shi     → cucciolo
// 3 Lali-ko      → bambino
// 4 Lali-ren     → adolescente (voce in transizione)
// 5 Lali-vox     → adulto
// 6 Lali-mere    → anziano (voce più profonda)
// 7 Lali-thishi  → trascendente (eterea)
const STAGE_VOICE = [
    { pitch: 1.95, rate: 1.15, volume: 0.55 }, // Syrma - squittio
    { pitch: 1.90, rate: 1.30, volume: 0.90 }, // Lali-na - cucciolo piccolissimo
    { pitch: 1.75, rate: 1.25, volume: 1.00 }, // Lali-shi - cucciolo
    { pitch: 1.50, rate: 1.15, volume: 1.00 }, // Lali-ko - bambino
    { pitch: 1.25, rate: 1.05, volume: 1.00 }, // Lali-ren - adolescente
    { pitch: 1.00, rate: 1.00, volume: 1.00 }, // Lali-vox - adulto
    { pitch: 0.80, rate: 0.85, volume: 0.95 }, // Lali-mere - anziano
    { pitch: 1.10, rate: 0.75, volume: 0.90 }, // Lali-thishi - trascendente (etereo lento)
];

function pickAlienVoice(stage) {
    if (!('speechSynthesis' in window)) return null;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const lang = (localStorage.getItem('lalien_language') || 'it').toLowerCase();
    const inLang = voices.filter(v => v.lang.toLowerCase().startsWith(lang));
    const pool = inLang.length ? inLang : voices;

    // Cucciolo (stage 0-3): prefer female/child voice
    if (stage <= 3) {
        return pool.find(v => /child|kid|bambina|bambino|ragazz/i.test(v.name))
            || pool.find(v => /female|donna|femm|alice|carla|elsa|samantha|zira/i.test(v.name))
            || pool[0];
    }
    // Adolescente/adulto (4-5): voce adulta femminile di default
    if (stage <= 5) {
        return pool.find(v => /female|donna|femm|alice|carla|elsa|samantha/i.test(v.name))
            || pool[0];
    }
    // Anziano/trascendente (6-7): voce più profonda, preferibilmente maschile
    return pool.find(v => /male|uomo|mascul|luca|giorgio|diego|daniel|alex(?!a)/i.test(v.name))
        || pool.find(v => /diego|daniel|google italiano/i.test(v.name))
        || pool[0];
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function speak(text, mood) {
    if (localStorage.getItem('lalien_tts_enabled') === '0') return;
    const stage = (typeof Pet !== 'undefined' && Pet.getStage) ? Pet.getStage() : 0;

    // Stages 0-2: the pet hasn't learned to speak the keeper's language yet.
    // Instead of TTS, emit a sequence of alien chirps/syllables that SOUND like
    // the text but aren't intelligible. The mood chirp already fired before this.
    // Add 2-3 extra voiced syllables for a "babbling" effect.
    if (stage <= 2) {
        try {
            const { SoundEngine } = window._speechSoundRef || {};
            if (SoundEngine && SoundEngine.playMoodChirp) {
                // Babble: emit 2-4 chirps with slight delays (simulates alien speech)
                const count = Math.min(4, Math.max(2, Math.ceil(text.length / 8)));
                const moods = ['neutral','curious','happy','neutral','sad'];
                for (let i = 0; i < count; i++) {
                    setTimeout(() => {
                        try { SoundEngine.playMoodChirp(stage, moods[(i + text.charCodeAt(0)) % moods.length]); } catch (_) {}
                    }, i * 280);
                }
            }
        } catch (_) {}
        return;  // NO TTS at stages 0-2
    }

    // Stages 3+: real TTS — the pet is learning/speaking the keeper's language
    if (!('speechSynthesis' in window)) return;
    try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voice = pickAlienVoice(stage);
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        const base = STAGE_VOICE[stage] || STAGE_VOICE[2];
        const mo   = MOOD_OFFSET[mood] || MOOD_OFFSET.neutral;
        u.pitch  = clamp(base.pitch + mo.pitch, 0.1, 2.0);
        u.rate   = clamp(base.rate  + mo.rate,  0.5, 2.0);
        u.volume = base.volume;
        speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
}

// Preload voices (they load async on some browsers)
if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener?.('voiceschanged', () => { /* voices ready */ });
    setTimeout(() => speechSynthesis.getVoices(), 500);
}
// Lazy-load SoundEngine ref (avoids circular import)
import('../audio/sound-engine.js').then(m => { window._speechSoundRef = m; }).catch(() => {});

export const SpeechBubble = {
    show(text, mood = 'neutral', duration = 3000) {
        // Absolute silence while sleeping — check both raw state AND module
        try {
            if (Pet && Pet.activity && Pet.activity.type === 'SLEEPING') return;
        } catch (_) {}
        // Also block if game-loop flagged sleeping (set by renderer/activity tick)
        if (window._lalienPetSleeping) return;
        // Sanitize: if text looks like raw JSON from LLM, extract just the utterance
        if (text && text.includes('"action"')) {
            try {
                const m = text.match(/\{[\s\S]*\}/);
                if (m) {
                    const j = JSON.parse(m[0]);
                    text = j.utterance || j.question || j.thought || j.greeting || text;
                }
            } catch (_) {
                // Strip JSON artifacts manually
                text = text.replace(/\{[^}]*\}/g, '').replace(/[{}"]/g, '').trim();
            }
            if (!text || text.length < 1) return;
        }

        const bubble = document.getElementById('speech-bubble');
        const textEl = document.getElementById('speech-text');

        // Clear previous
        clearTimeout(_timeout);
        clearInterval(_typeInterval);

        // Remove old mood classes
        bubble.className = '';
        bubble.classList.add(`mood-${mood}`);
        bubble.classList.remove('hidden');

        // Typewriter effect (30 chars/sec)
        textEl.textContent = '';
        let i = 0;
        const speed = 1000 / 30;
        _typeInterval = setInterval(() => {
            if (i < text.length) {
                textEl.textContent += text[i];
                i++;
            } else {
                clearInterval(_typeInterval);
            }
        }, speed);

        // Mood-aware alien chirp before TTS, to give the creature a voice
        try {
            const stage = (Pet && Pet.getStage) ? Pet.getStage() : 2;
            if (SoundEngine.playMoodChirp) {
                SoundEngine.playMoodChirp(stage, mood);
            } else {
                SoundEngine.playChirp(stage);
            }
        } catch (_) {}

        // Speak aloud
        speak(text, mood);

        // Auto-dismiss (reading time: at least duration, plus 50ms per char)
        const readTime = Math.max(duration, text.length * 50 + 1500);
        _timeout = setTimeout(() => {
            bubble.classList.add('hidden');
        }, readTime);
    },

    /** Toggle TTS persistently */
    setTTSEnabled(enabled) {
        localStorage.setItem('lalien_tts_enabled', enabled ? '1' : '0');
        if (!enabled && 'speechSynthesis' in window) speechSynthesis.cancel();
    },

    isTTSEnabled() {
        return localStorage.getItem('lalien_tts_enabled') !== '0';
    },

    hide() {
        clearTimeout(_timeout);
        clearInterval(_typeInterval);
        document.getElementById('speech-bubble').classList.add('hidden');
    },
};
