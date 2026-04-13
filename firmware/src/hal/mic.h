/**
 * mic.h — PDM Microphone HAL for GIGA Display Shield
 * Provides: audio level monitoring, short recording buffers for STT
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {
namespace Mic {

    static constexpr uint32_t SAMPLE_RATE    = 16000;
    static constexpr uint16_t BUFFER_SAMPLES = 512;

    void init();

    /// Poll audio level (call at ~60 Hz). Cheap — just reads RMS.
    void pollLevel();

    /// Current RMS audio level (0.0 – 1.0).
    float getLevel();

    /// Returns true if level exceeds the voice threshold for > duration_ms.
    bool isVoiceDetected(uint32_t duration_ms = 300);

    /// Start recording into an internal ring buffer. Max ~2 seconds.
    void startRecording();

    /// Stop recording. After this, getRecordingBuffer() is valid.
    void stopRecording();

    /// Returns pointer to recorded PCM16 samples and sets out_len.
    const int16_t* getRecordingBuffer(uint32_t& out_len);

    /// Returns true if currently recording.
    bool isRecording();

    /// Voice detection threshold (0.0-1.0, default 0.1).
    void setVoiceThreshold(float threshold);

} // namespace Mic
} // namespace HAL
