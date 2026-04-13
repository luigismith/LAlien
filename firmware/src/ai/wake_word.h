/**
 * wake_word.h — Wake word detection via mic level + STT cloud
 * Detects voice activity, sends 2s clip to Whisper, fuzzy matches pet name
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace WakeWord {

    void init(const char* wake_word);
    void setEnabled(bool enabled);
    bool isEnabled();

    /// Poll for wake word detection (call at ~10Hz).
    /// Returns true if wake word detected this tick.
    bool poll();

    /// Set the wake word (pet name or "Lali" default).
    void setWord(const char* word);

} // namespace WakeWord
} // namespace AI
