/**
 * mic.cpp — PDM Microphone HAL implementation
 * Uses mbed PDM library on GIGA R1 WiFi
 * Author: Claude Code | Date: 2026-04-13
 */
#include "mic.h"
#include <PDM.h>

static constexpr uint32_t MAX_RECORDING_SAMPLES = SAMPLE_RATE * 2; // 2 seconds
static int16_t sample_buffer[HAL::Mic::BUFFER_SAMPLES];
static int16_t recording_buffer[MAX_RECORDING_SAMPLES];
static volatile uint32_t recording_write_idx = 0;
static volatile bool recording_active = false;
static volatile bool samples_ready = false;

static float current_level = 0.0f;
static float voice_threshold = 0.1f;
static uint32_t voice_start_ms = 0;
static bool voice_above_threshold = false;

// PDM data callback
static void onPDMdata() {
    int bytes_available = PDM.available();
    PDM.read(sample_buffer, bytes_available);
    samples_ready = true;

    // If recording, copy to recording buffer
    if (recording_active) {
        int num_samples = bytes_available / 2;
        for (int i = 0; i < num_samples && recording_write_idx < MAX_RECORDING_SAMPLES; i++) {
            recording_buffer[recording_write_idx++] = sample_buffer[i];
        }
        if (recording_write_idx >= MAX_RECORDING_SAMPLES) {
            recording_active = false;
        }
    }
}

static constexpr uint32_t SAMPLE_RATE_VAL = 16000;

namespace HAL {
namespace Mic {

void init() {
    PDM.onReceive(onPDMdata);
    if (PDM.begin(1, SAMPLE_RATE_VAL)) {
        Serial.println("[MIC] OK — PDM mic ready, 16kHz mono");
    } else {
        Serial.println("[MIC] FAIL — PDM init failed");
    }
}

void pollLevel() {
    if (!samples_ready) return;
    samples_ready = false;

    // Compute RMS
    int64_t sum_sq = 0;
    for (uint16_t i = 0; i < BUFFER_SAMPLES; i++) {
        int32_t s = sample_buffer[i];
        sum_sq += s * s;
    }
    float rms = sqrtf((float)sum_sq / BUFFER_SAMPLES) / 32768.0f;
    current_level = rms;

    // Voice detection state
    if (rms > voice_threshold) {
        if (!voice_above_threshold) {
            voice_above_threshold = true;
            voice_start_ms = millis();
        }
    } else {
        voice_above_threshold = false;
    }
}

float getLevel() {
    return current_level;
}

bool isVoiceDetected(uint32_t duration_ms) {
    return voice_above_threshold && (millis() - voice_start_ms >= duration_ms);
}

void startRecording() {
    recording_write_idx = 0;
    recording_active = true;
}

void stopRecording() {
    recording_active = false;
}

const int16_t* getRecordingBuffer(uint32_t& out_len) {
    out_len = recording_write_idx;
    return recording_buffer;
}

bool isRecording() {
    return recording_active;
}

void setVoiceThreshold(float threshold) {
    voice_threshold = threshold;
}

} // namespace Mic
} // namespace HAL
