/**
 * audio.h — Audio output HAL (chiptune via DAC or visual-only fallback)
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {
namespace Audio {

    /// Initialize audio output. Detects if DAC/I2S is available.
    void init();

    /// Returns true if hardware audio output is available.
    bool isAvailable();

    /// Play a single tone. freq_hz=0 stops current tone.
    void playTone(uint16_t freq_hz, uint16_t duration_ms);

    /// Play a sequence of notes (chiptune melody).
    /// notes: array of {freq, duration_ms} pairs, terminated by {0,0}.
    struct Note { uint16_t freq; uint16_t duration_ms; };
    void playMelody(const Note* notes, uint8_t count);

    /// Stop all audio output.
    void stop();

    /// Update audio state machine (call in loop, non-blocking).
    void poll();

    /// Volume 0-255.
    void setVolume(uint8_t vol);

    // Pre-defined chiptune sounds
    void playBlip();          // typewriter blip
    void playFeedSound();     // eating
    void playHappyJingle();   // short happy melody
    void playSadTone();       // descending tone
    void playAlertTone();     // need attention

} // namespace Audio
} // namespace HAL
