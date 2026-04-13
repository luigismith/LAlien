/**
 * llm_client.h — Async LLM client with adapter pattern for Anthropic/OpenAI
 * Non-blocking state machine: IDLE → CONNECTING → SENDING → WAITING → PARSING → DONE
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace LLMClient {

    enum class State : uint8_t {
        IDLE, CONNECTING, SENDING, WAITING, PARSING, DONE, ERROR
    };

    void init(const char* provider, const char* api_key);
    void poll(); // advance async state machine (call at 10Hz)

    /// Start a completion request. Non-blocking.
    void requestCompletion(const String& user_message);

    /// Get current state.
    State getState();

    /// Get response text (valid only when state == DONE).
    String getResponse();

    /// Get error message (valid only when state == ERROR).
    String getError();

    /// Reset to IDLE for next request.
    void reset();

    /// Rate limiting
    uint16_t getDailyCallCount();
    bool isRateLimited();

} // namespace LLMClient
} // namespace AI
