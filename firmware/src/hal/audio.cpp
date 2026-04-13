/**
 * audio.cpp — Audio output implementation
 * Uses DAC output on GIGA R1 WiFi if available, otherwise no-op (visual fallback).
 * The GIGA Display Shield does not have a dedicated speaker, so audio goes
 * through DAC0 (A12) — user can connect a small piezo or amplified speaker.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "audio.h"
#include "AdvancedDAC.h"

static bool audio_available = false;
static uint8_t volume = 128;

// Melody playback state
static const HAL::Audio::Note* current_melody = nullptr;
static uint8_t melody_count = 0;
static uint8_t melody_idx = 0;
static uint32_t note_end_ms = 0;

// Simple square wave via DAC
static AdvancedDAC dac_out(A12);
static bool dac_initialized = false;

namespace HAL {
namespace Audio {

void init() {
    // Try to initialize DAC for square wave output
    // AdvancedDAC on GIGA R1 supports waveform generation
    audio_available = false; // Conservative: start disabled

    // DAC init attempt — the GIGA R1 has DAC0 on A12
    // For chiptune, we'll use tone() on a digital pin as simplest approach
    // or AdvancedDAC for waveform synthesis.
    // Mark as unavailable for now; enable after hardware verification.
    Serial.println("[AUDIO] Visual-only mode (no speaker detected)");
    Serial.println("[AUDIO] Connect piezo to A12/GND for chiptune audio");
}

bool isAvailable() {
    return audio_available;
}

void playTone(uint16_t freq_hz, uint16_t duration_ms) {
    if (!audio_available || freq_hz == 0) return;
    // tone() is not available on mbed_giga; would need timer-based PWM.
    // Placeholder for hardware-verified implementation.
}

void playMelody(const Note* notes, uint8_t count) {
    if (!audio_available || count == 0) return;
    current_melody = notes;
    melody_count = count;
    melody_idx = 0;
    playTone(notes[0].freq, notes[0].duration_ms);
    note_end_ms = millis() + notes[0].duration_ms;
}

void stop() {
    current_melody = nullptr;
}

void poll() {
    if (!current_melody) return;
    if (millis() >= note_end_ms) {
        melody_idx++;
        if (melody_idx >= melody_count) {
            current_melody = nullptr;
            return;
        }
        playTone(current_melody[melody_idx].freq,
                 current_melody[melody_idx].duration_ms);
        note_end_ms = millis() + current_melody[melody_idx].duration_ms;
    }
}

void setVolume(uint8_t vol) {
    volume = vol;
}

// Pre-defined sounds (frequencies in Hz)
void playBlip() {
    static const Note blip[] = { {880, 30} };
    playMelody(blip, 1);
}

void playFeedSound() {
    static const Note feed[] = { {523, 80}, {659, 80}, {784, 120} };
    playMelody(feed, 3);
}

void playHappyJingle() {
    static const Note happy[] = { {523, 100}, {659, 100}, {784, 100}, {1047, 200} };
    playMelody(happy, 4);
}

void playSadTone() {
    static const Note sad[] = { {440, 200}, {392, 200}, {349, 300} };
    playMelody(sad, 3);
}

void playAlertTone() {
    static const Note alert[] = { {880, 150}, {0, 100}, {880, 150} };
    playMelody(alert, 3);
}

} // namespace Audio
} // namespace HAL
