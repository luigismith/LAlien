/**
 * speech-bubble.js -- Typewriter text effect with mood variants + TTS
 * Voice evolves with stage: baby-cub (high pitch) → adult → elder (deep)
 */
import { Pet } from '../pet/pet.js';
import { SoundEngine } from '../audio/sound-engine.js';

let _timeout = null;
let _typeInterval = null;
// Priority of the bubble currently being shown. Any new request with lower
// or equal priority while one is active will be dropped instead of
// interrupting it — so a chat reply doesn't get clipped mid-sentence by an
// autonomous "la-la-la!" chirp. See PRIORITY constant below.
let _activePriority = 0;   // 0 = nothing speaking
const PRIORITY = { autonomy: 1, chat: 2, urgent: 3 };

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

    // Stages 0-1 (egg, newborn) — no keeper language yet. Emit a sequence
    // of alien chirps/syllables that SOUND like speech but aren't words.
    if (stage <= 1) {
        try {
            const { SoundEngine } = window._speechSoundRef || {};
            if (SoundEngine && SoundEngine.playMoodChirp) {
                // Babble: 2-4 chirps at slight delays (alien speech)
                const count = Math.min(4, Math.max(2, Math.ceil(text.length / 8)));
                const moods = ['neutral','curious','happy','neutral','sad'];
                for (let i = 0; i < count; i++) {
                    setTimeout(() => {
                        try { SoundEngine.playMoodChirp(stage, moods[(i + text.charCodeAt(0)) % moods.length]); } catch (_) {}
                    }, i * 280);
                }
            }
        } catch (_) {}
        return;  // NO TTS at stages 0-1
    }

    // Stages 2+: real TTS — from Lali-shi onward the pet imitates the
    // keeper's language, so its voice is audibly pronounced (with alien
    // phonetics for lalien syllables and a high pitch at stage 2).
    if (!('speechSynthesis' in window)) return;
    // TTS is a SEPARATE pipeline from Web Audio — we must manually apply the
    // global SoundEngine volume + enabled flag so the settings slider truly
    // controls every sound coming out of the app.
    const engineVol = (SoundEngine.getVolume && SoundEngine.getVolume()) ?? 1;
    const engineOn  = (SoundEngine.isEnabled && SoundEngine.isEnabled()) ?? true;
    if (!engineOn || engineVol <= 0.001) return;
    try {
        speechSynthesis.cancel();
        const voice = pickAlienVoice(stage);
        const langCode = ((voice && voice.lang) || navigator.language || 'it').slice(0, 2).toLowerCase();
        const spoken = phoneticizeAlien(text, langCode);
        const u = new SpeechSynthesisUtterance(spoken);
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        const base = STAGE_VOICE[stage] || STAGE_VOICE[2];
        const mo   = MOOD_OFFSET[mood] || MOOD_OFFSET.neutral;
        u.pitch  = clamp(base.pitch + mo.pitch, 0.1, 2.0);
        u.rate   = clamp(base.rate  + mo.rate,  0.5, 2.0);
        u.volume = clamp(base.volume * engineVol, 0, 1);
        speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
}

// Map alien words to phonetic spellings the browser TTS engine can actually
// pronounce in the keeper's language. Without this, short syllables like
// "sha" get spelled letter-by-letter ("esse-acca-a") by most voices.
// The map is keyed by language code (first 2 chars of voice.lang).
const ALIEN_PHONETIC = {
    it: {
        sha: 'scià', shi: 'sci', 'sha-sha': 'scià scià', 'shi-shi': 'sci sci',
        thi: 'ti', 'thi-thi': 'ti ti',
        ko: 'co', 'ko-ko': 'cò cò', 'ko!': 'cò!',
        kora: 'còra', 'ko-ra': 'cò ra',
        kesma: 'chèsma', 'kesma-thi': 'chèsma ti',
        moko: 'mòco', 'mo-ko': 'mò co',
        nashi: 'nàsci', vythi: 'viti', 'vythi-thi': 'viti ti',
        selath: 'sèlat', 'selath-thi': 'sèlat ti', 'selath-vi': 'sèlat vi',
        ven: 'vèn', 'ven-thi': 'vèn ti', 'ven-kora': 'vèn còra',
        lalí: 'lalì', lali: 'lalì', 'la-la': 'la la', 'la-la-la': 'la la la',
        rak: 'rak', 'la-shi': 'la sci', 'ven-la': 'vèn la',
        morak: 'mòrak', velin: 'vèlin', rena: 'rèna',
        thavrim: 'tàvrim', kevra: 'chèvra', shalim: 'scià lim',
        thishi: 'tisci', revosh: 'rèvosc', korim: 'còrim',
        mmh: 'mmm', shai: 'sciàj', zzz: 'zeta zeta', shh: 'ssss',
    },
    en: {
        sha: 'shah', shi: 'shee', 'sha-sha': 'shah shah',
        thi: 'thee', 'thi-thi': 'thee thee',
        ko: 'koh', kora: 'KOH-rah',
        kesma: 'KESS-mah', moko: 'MOH-koh', nashi: 'NAH-shee',
        vythi: 'VEE-thee', selath: 'SEH-lath',
        ven: 'vain', lalí: 'lah-LEE', lali: 'LAH-lee',
    },
};

function phoneticizeAlien(text, langCode) {
    const map = ALIEN_PHONETIC[langCode] || ALIEN_PHONETIC.it;
    if (!text) return text;
    // Strip diacritics for matching so "kòra" matches "kora" in the map
    const strip = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Tokenise on whitespace + punctuation while preserving the separators so
    // we can rebuild the string in the original rhythm.
    return text.replace(/[A-Za-zÀ-ÿ]+[-'A-Za-zÀ-ÿ]*/g, (word) => {
        const lookup = strip(word).toLowerCase();
        if (map[lookup]) return map[lookup];
        // Also try a bare de-hyphenated variant ("ko-ra" → "kora")
        const dehyph = lookup.replace(/[-']/g, '');
        if (map[dehyph]) return map[dehyph];
        return word;   // unchanged (keeper-language word)
    });
}

// Preload voices (they load async on some browsers)
if ('speechSynthesis' in window) {
    speechSynthesis.addEventListener?.('voiceschanged', () => { /* voices ready */ });
    setTimeout(() => speechSynthesis.getVoices(), 500);
}
// Lazy-load SoundEngine ref (avoids circular import)
import('../audio/sound-engine.js').then(m => { window._speechSoundRef = m; }).catch(() => {});

export const SpeechBubble = {
    /**
     * @param {string} text
     * @param {string} [mood]      'neutral'|'happy'|'sad'|'scared'|'sleepy'|...
     * @param {number} [duration]  ms to keep the bubble up
     * @param {object} [opts]      { fromDream?: bool,  priority?: 'autonomy'|'chat'|'urgent' }
     *   - fromDream bypasses the sleep silence guard (dream-world reply)
     *   - priority (default 'chat') controls interruption:
     *       'autonomy' → ambient chirps; dropped if anything is speaking
     *       'chat'     → user-triggered reply; cannot be interrupted by autonomy
     *       'urgent'   → critical alerts; always interrupts
     */
    show(text, mood = 'neutral', duration = 3000, opts = {}) {
        const sleeping = (Pet && Pet.activity && Pet.activity.type === 'SLEEPING') || window._lalienPetSleeping;
        // Block spontaneous speech while sleeping UNLESS the caller is
        // intentionally routing a dream-reply to the keeper.
        if (sleeping && !opts.fromDream) return;

        // Priority gating — don't interrupt a chat reply with a chirp
        const pr = PRIORITY[opts.priority || 'chat'] || PRIORITY.chat;
        if (_activePriority > 0 && pr <= _activePriority) return;  // skip
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
        _activePriority = pr;
        _timeout = setTimeout(() => {
            bubble.classList.add('hidden');
            _activePriority = 0;
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
