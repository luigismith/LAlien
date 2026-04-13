/**
 * wake_word.cpp — Wake word detection via mic level + STT cloud
 * Detects voice activity using HAL::Mic, records a 2-second clip,
 * sends it to Whisper for transcription, then fuzzy-matches against
 * the pet's name (or default "Lali"). Cooldown prevents re-triggers.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "wake_word.h"
#include "stt_client.h"
#include "../hal/mic.h"

namespace AI {
namespace WakeWord {

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

enum class DetectState : uint8_t {
    LISTENING,       // Waiting for voice activity
    RECORDING,       // Recording 2s clip
    TRANSCRIBING,    // Waiting for STT result
    COOLDOWN         // Post-detection cooldown
};

static bool s_enabled = false;
static char s_wake_word[32] = "lali";
static DetectState s_detect_state = DetectState::LISTENING;
static uint32_t s_record_start_millis = 0;
static uint32_t s_cooldown_until = 0;

static constexpr uint32_t RECORD_DURATION_MS = 2000;
static constexpr uint32_t COOLDOWN_MS = 5000;

// ---------------------------------------------------------------------------
// Fuzzy match — Levenshtein edit distance
// ---------------------------------------------------------------------------

static uint8_t editDistance(const char* a, const char* b) {
    uint8_t len_a = strlen(a);
    uint8_t len_b = strlen(b);

    if (len_a > 20) len_a = 20;
    if (len_b > 20) len_b = 20;

    // Use single-row DP to save memory
    uint8_t prev[21];
    uint8_t curr[21];

    for (uint8_t j = 0; j <= len_b; j++) {
        prev[j] = j;
    }

    for (uint8_t i = 1; i <= len_a; i++) {
        curr[0] = i;
        for (uint8_t j = 1; j <= len_b; j++) {
            uint8_t cost = (tolower(a[i - 1]) == tolower(b[j - 1])) ? 0 : 1;
            uint8_t del = prev[j] + 1;
            uint8_t ins = curr[j - 1] + 1;
            uint8_t sub = prev[j - 1] + cost;
            curr[j] = min(del, min(ins, sub));
        }
        memcpy(prev, curr, len_b + 1);
    }

    return prev[len_b];
}

// ---------------------------------------------------------------------------
// Check if transcription contains the wake word (fuzzy)
// ---------------------------------------------------------------------------

static bool fuzzyContains(const String& text, const char* word) {
    if (text.length() == 0 || strlen(word) == 0) return false;

    // Convert both to lowercase for comparison
    String lower_text = text;
    lower_text.toLowerCase();

    String lower_word = word;
    lower_word.toLowerCase();

    // Exact substring check first (fast path)
    if (lower_text.indexOf(lower_word) >= 0) {
        return true;
    }

    // Fuzzy: slide a window of wake word length over the transcription
    uint8_t word_len = lower_word.length();
    if (lower_text.length() < word_len) {
        // Compare the whole text against the word
        return editDistance(lower_text.c_str(), lower_word.c_str()) <= 2;
    }

    for (uint16_t i = 0; i <= lower_text.length() - word_len; i++) {
        String window = lower_text.substring(i, i + word_len);
        if (editDistance(window.c_str(), lower_word.c_str()) <= 2) {
            return true;
        }
    }

    // Also try with window_len +/- 1 for insertions/deletions
    if (word_len > 1) {
        for (uint16_t i = 0; i <= lower_text.length() - (word_len - 1); i++) {
            String window = lower_text.substring(i, i + word_len - 1);
            if (editDistance(window.c_str(), lower_word.c_str()) <= 2) {
                return true;
            }
        }
    }
    if (lower_text.length() >= word_len + 1) {
        for (uint16_t i = 0; i <= lower_text.length() - (word_len + 1); i++) {
            String window = lower_text.substring(i, i + word_len + 1);
            if (editDistance(window.c_str(), lower_word.c_str()) <= 2) {
                return true;
            }
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void init(const char* wake_word) {
    setWord(wake_word);
    s_enabled = false;
    s_detect_state = DetectState::LISTENING;
    s_cooldown_until = 0;
}

void setEnabled(bool enabled) {
    s_enabled = enabled;
    if (enabled) {
        s_detect_state = DetectState::LISTENING;
    }
}

bool isEnabled() {
    return s_enabled;
}

void setWord(const char* word) {
    if (word && strlen(word) > 0) {
        strncpy(s_wake_word, word, sizeof(s_wake_word) - 1);
        s_wake_word[sizeof(s_wake_word) - 1] = '\0';
    } else {
        strcpy(s_wake_word, "lali");
    }
}

bool poll() {
    if (!s_enabled) return false;
    if (!STTClient::isAvailable()) return false;

    uint32_t now = millis();

    switch (s_detect_state) {

    case DetectState::LISTENING: {
        // Check if voice is detected (above threshold for 300ms)
        if (HAL::Mic::isVoiceDetected(300)) {
            // Start recording 2 seconds of audio
            HAL::Mic::startRecording();
            s_record_start_millis = now;
            s_detect_state = DetectState::RECORDING;
        }
        return false;
    }

    case DetectState::RECORDING: {
        // Wait for 2 seconds of recording
        if (now - s_record_start_millis >= RECORD_DURATION_MS) {
            HAL::Mic::stopRecording();

            // Get recorded buffer
            uint32_t sample_count = 0;
            const int16_t* buffer = HAL::Mic::getRecordingBuffer(sample_count);

            if (buffer && sample_count > 0) {
                // Send to STT
                STTClient::transcribe(buffer, sample_count);
                s_detect_state = DetectState::TRANSCRIBING;
            } else {
                // No data — go back to listening
                s_detect_state = DetectState::LISTENING;
            }
        }
        return false;
    }

    case DetectState::TRANSCRIBING: {
        // Poll STT
        STTClient::poll();

        if (STTClient::isReady()) {
            String text = STTClient::getTranscription();

            // Check for wake word match
            bool detected = fuzzyContains(text, s_wake_word);

            // Enter cooldown regardless of match result
            s_cooldown_until = now + COOLDOWN_MS;
            s_detect_state = DetectState::COOLDOWN;

            return detected;
        }
        return false;
    }

    case DetectState::COOLDOWN: {
        if (now >= s_cooldown_until) {
            s_detect_state = DetectState::LISTENING;
        }
        return false;
    }

    } // switch

    return false;
}

} // namespace WakeWord
} // namespace AI
