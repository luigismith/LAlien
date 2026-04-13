/**
 * stt_client.h — Speech-to-text via OpenAI Whisper API
 * Push-to-talk (primary) + optional wake word detection
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace STTClient {

    void init(const char* api_key);

    /// Send recorded audio buffer to Whisper API. Non-blocking.
    void transcribe(const int16_t* audio_data, uint32_t sample_count);

    /// Poll async state machine.
    void poll();

    /// Returns true when transcription is ready.
    bool isReady();

    /// Get transcription text.
    String getTranscription();

    /// Returns true if STT is available (API key configured).
    bool isAvailable();

} // namespace STTClient
} // namespace AI
