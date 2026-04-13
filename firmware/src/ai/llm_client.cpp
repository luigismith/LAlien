/**
 * llm_client.cpp — Async LLM client with adapter pattern for Anthropic/OpenAI
 * Non-blocking state machine driven by poll() at 10Hz.
 * Supports both Anthropic Claude and OpenAI GPT providers behind a common
 * interface. Handles rate limiting, retry with exponential backoff, and
 * conversation history (last 5 turns).
 * Author: Claude Code | Date: 2026-04-13
 */
#include "llm_client.h"
#include "system_prompt.h"
#include "../util/config.h"
#include "../network/tls_certs.h"
#include <WiFi.h>
#include <WiFiSSLClient.h>
#include <ArduinoJson.h>

namespace AI {
namespace LLMClient {

// ---------------------------------------------------------------------------
// Provider type
// ---------------------------------------------------------------------------

enum class Provider : uint8_t {
    ANTHROPIC,
    OPENAI
};

// ---------------------------------------------------------------------------
// Conversation turn for history
// ---------------------------------------------------------------------------

struct Turn {
    String role;    // "user" or "assistant"
    String content;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

static State s_state = State::IDLE;
static Provider s_provider = Provider::ANTHROPIC;
static const char* s_api_key = nullptr;

static WiFiSSLClient s_client;

// Request / response buffers
static String s_request_body;
static String s_response_raw;
static String s_response_text;
static String s_error_text;

// Conversation history (circular, max 5 turns = 10 entries user+assistant)
static constexpr uint8_t MAX_HISTORY = 10;
static Turn s_history[MAX_HISTORY];
static uint8_t s_history_count = 0;

// Pending user message (for adding to history after response)
static String s_pending_user_msg;

// Rate limiting
static uint16_t s_daily_call_count = 0;
static uint32_t s_last_call_millis = 0;
static uint32_t s_day_start_millis = 0;

// Retry state
static uint8_t s_retry_count = 0;
static uint32_t s_retry_wait_until = 0;
static constexpr uint8_t MAX_RETRIES = 3;

// Timeout
static uint32_t s_request_start_millis = 0;
static constexpr uint32_t REQUEST_TIMEOUT_MS = 15000;

// HTTP response parsing
static bool s_headers_done = false;
static int s_content_length = -1;
static int s_body_received = 0;

// Provider host/path
static const char* getHost() {
    return (s_provider == Provider::ANTHROPIC)
           ? "api.anthropic.com"
           : "api.openai.com";
}

static const char* getPath() {
    return (s_provider == Provider::ANTHROPIC)
           ? "/v1/messages"
           : "/v1/chat/completions";
}

// ---------------------------------------------------------------------------
// History management
// ---------------------------------------------------------------------------

static void addToHistory(const char* role, const String& content) {
    if (s_history_count >= MAX_HISTORY) {
        // Shift left by 2 (drop oldest turn pair)
        for (uint8_t i = 0; i < MAX_HISTORY - 2; i++) {
            s_history[i] = s_history[i + 2];
        }
        s_history_count -= 2;
    }
    s_history[s_history_count].role = role;
    s_history[s_history_count].content = content;
    s_history_count++;
}

static void clearHistory() {
    for (uint8_t i = 0; i < MAX_HISTORY; i++) {
        s_history[i].role = "";
        s_history[i].content = "";
    }
    s_history_count = 0;
}

// ---------------------------------------------------------------------------
// JSON request body builder
// ---------------------------------------------------------------------------

static void buildRequestBody(const String& system_prompt, const String& user_message) {
    // Use ArduinoJson to build the request
    JsonDocument doc;

    if (s_provider == Provider::ANTHROPIC) {
        doc["model"] = "claude-haiku-4-5-20251001";
        doc["max_tokens"] = 256;
        doc["system"] = system_prompt;

        JsonArray messages = doc["messages"].to<JsonArray>();

        // Add conversation history
        for (uint8_t i = 0; i < s_history_count; i++) {
            JsonObject msg = messages.add<JsonObject>();
            msg["role"] = s_history[i].role;
            msg["content"] = s_history[i].content;
        }

        // Add current user message
        JsonObject user_msg = messages.add<JsonObject>();
        user_msg["role"] = "user";
        user_msg["content"] = user_message;

    } else {
        // OpenAI format
        doc["model"] = "gpt-4o-mini";
        doc["max_tokens"] = 256;

        JsonArray messages = doc["messages"].to<JsonArray>();

        // System message first
        JsonObject sys_msg = messages.add<JsonObject>();
        sys_msg["role"] = "system";
        sys_msg["content"] = system_prompt;

        // Add conversation history
        for (uint8_t i = 0; i < s_history_count; i++) {
            JsonObject msg = messages.add<JsonObject>();
            msg["role"] = s_history[i].role;
            msg["content"] = s_history[i].content;
        }

        // Add current user message
        JsonObject user_msg = messages.add<JsonObject>();
        user_msg["role"] = "user";
        user_msg["content"] = user_message;
    }

    s_request_body = "";
    serializeJson(doc, s_request_body);
}

// ---------------------------------------------------------------------------
// HTTP request writer
// ---------------------------------------------------------------------------

static void writeHttpRequest() {
    const char* host = getHost();
    const char* path = getPath();

    // Request line
    s_client.print("POST ");
    s_client.print(path);
    s_client.println(" HTTP/1.1");

    // Common headers
    s_client.print("Host: ");
    s_client.println(host);
    s_client.println("Content-Type: application/json");
    s_client.println("Connection: close");

    // Provider-specific auth headers
    if (s_provider == Provider::ANTHROPIC) {
        s_client.print("x-api-key: ");
        s_client.println(s_api_key);
        s_client.println("anthropic-version: 2023-06-01");
    } else {
        s_client.print("Authorization: Bearer ");
        s_client.println(s_api_key);
    }

    // Content length + body
    s_client.print("Content-Length: ");
    s_client.println(s_request_body.length());
    s_client.println(); // End headers
    s_client.print(s_request_body);
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

static bool parseResponse() {
    // Find the body start (after \r\n\r\n)
    int body_start = s_response_raw.indexOf("\r\n\r\n");
    if (body_start < 0) {
        s_error_text = "No HTTP body found";
        return false;
    }
    body_start += 4;

    // Check HTTP status code from first line
    int status_start = s_response_raw.indexOf(' ') + 1;
    int status_code = s_response_raw.substring(status_start, status_start + 3).toInt();

    if (status_code < 200 || status_code >= 300) {
        s_error_text = "HTTP ";
        s_error_text += String(status_code);
        // Try to extract error message from body
        String body = s_response_raw.substring(body_start);
        if (body.length() > 0 && body.length() < 200) {
            s_error_text += ": ";
            s_error_text += body;
        }
        return false;
    }

    String body = s_response_raw.substring(body_start);

    // Find the JSON start (skip any chunked encoding prefixes)
    int json_start = body.indexOf('{');
    if (json_start < 0) {
        s_error_text = "No JSON in response";
        return false;
    }
    body = body.substring(json_start);

    // Parse JSON
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) {
        s_error_text = "JSON parse error: ";
        s_error_text += err.c_str();
        return false;
    }

    // Extract text based on provider
    if (s_provider == Provider::ANTHROPIC) {
        // Anthropic: content[0].text
        JsonArray content = doc["content"];
        if (content.isNull() || content.size() == 0) {
            s_error_text = "No content in Anthropic response";
            return false;
        }
        const char* text = content[0]["text"];
        if (!text) {
            s_error_text = "No text in content block";
            return false;
        }
        s_response_text = text;
    } else {
        // OpenAI: choices[0].message.content
        JsonArray choices = doc["choices"];
        if (choices.isNull() || choices.size() == 0) {
            s_error_text = "No choices in OpenAI response";
            return false;
        }
        const char* text = choices[0]["message"]["content"];
        if (!text) {
            s_error_text = "No content in choice";
            return false;
        }
        s_response_text = text;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Rate limit helpers
// ---------------------------------------------------------------------------

static void checkDayRollover() {
    uint32_t now = millis();
    // Reset daily count every 24 hours (approximate)
    if (now - s_day_start_millis > 86400000UL) {
        s_daily_call_count = 0;
        s_day_start_millis = now;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void init(const char* provider, const char* api_key) {
    s_api_key = api_key;

    if (provider && strcmp(provider, "openai") == 0) {
        s_provider = Provider::OPENAI;
    } else {
        s_provider = Provider::ANTHROPIC;
    }

    s_state = State::IDLE;
    s_daily_call_count = 0;
    s_day_start_millis = millis();
    s_retry_count = 0;

    clearHistory();
}

void requestCompletion(const String& user_message) {
    if (s_state != State::IDLE) return;
    if (isRateLimited()) {
        s_error_text = "Rate limited";
        s_state = State::ERROR;
        return;
    }

    // Build system prompt
    String system_prompt = SystemPrompt::build();

    // Build request body with history
    buildRequestBody(system_prompt, user_message);

    // Store user message for history (added after successful response)
    s_pending_user_msg = user_message;

    // Reset response state
    s_response_raw = "";
    s_response_text = "";
    s_error_text = "";
    s_headers_done = false;
    s_content_length = -1;
    s_body_received = 0;

    // Reset retry
    s_retry_count = 0;
    s_retry_wait_until = 0;

    // Begin connection
    s_request_start_millis = millis();
    s_state = State::CONNECTING;
}

void poll() {
    uint32_t now = millis();

    switch (s_state) {

    case State::IDLE:
    case State::DONE:
    case State::ERROR:
        // Nothing to do
        return;

    case State::CONNECTING: {
        // Check global timeout
        if (now - s_request_start_millis > REQUEST_TIMEOUT_MS) {
            s_client.stop();
            s_error_text = "Connection timeout";
            s_state = State::ERROR;
            return;
        }

        // Wait for retry backoff
        if (s_retry_wait_until > 0 && now < s_retry_wait_until) {
            return;
        }

        const char* host = getHost();
        if (s_client.connect(host, 443)) {
            s_state = State::SENDING;
        } else {
            // Connection failed — retry with backoff
            s_retry_count++;
            if (s_retry_count > MAX_RETRIES) {
                s_error_text = "Connection failed after retries";
                s_state = State::ERROR;
                return;
            }
            // Backoff: 1s, 2s, 4s
            uint32_t backoff = 1000UL << (s_retry_count - 1);
            s_retry_wait_until = now + backoff;
        }
        return;
    }

    case State::SENDING: {
        writeHttpRequest();
        s_state = State::WAITING;
        return;
    }

    case State::WAITING: {
        // Check timeout
        if (now - s_request_start_millis > REQUEST_TIMEOUT_MS) {
            s_client.stop();
            s_error_text = "Response timeout";
            s_state = State::ERROR;
            return;
        }

        // Read available bytes
        while (s_client.available()) {
            char c = s_client.read();
            s_response_raw += c;

            // Detect Content-Length from headers
            if (!s_headers_done) {
                if (s_response_raw.endsWith("\r\n\r\n")) {
                    s_headers_done = true;
                    // Parse Content-Length
                    int cl_idx = s_response_raw.indexOf("Content-Length: ");
                    if (cl_idx < 0) {
                        cl_idx = s_response_raw.indexOf("content-length: ");
                    }
                    if (cl_idx >= 0) {
                        int cl_end = s_response_raw.indexOf("\r\n", cl_idx);
                        String cl_str = s_response_raw.substring(cl_idx + 16, cl_end);
                        s_content_length = cl_str.toInt();
                    }
                    s_body_received = 0;
                }
            } else {
                s_body_received++;
            }
        }

        // Check if we have the full body
        bool body_complete = false;
        if (s_headers_done) {
            if (s_content_length > 0 && s_body_received >= s_content_length) {
                body_complete = true;
            }
            // Also check if connection closed (server signals end)
            if (!s_client.connected() && !s_client.available()) {
                body_complete = true;
            }
        }

        if (body_complete) {
            s_client.stop();
            s_state = State::PARSING;
        }
        return;
    }

    case State::PARSING: {
        if (parseResponse()) {
            // Success — update history and rate limit counters
            addToHistory("user", s_pending_user_msg);
            addToHistory("assistant", s_response_text);
            s_daily_call_count++;
            s_last_call_millis = now;
            s_state = State::DONE;
        } else {
            s_state = State::ERROR;
        }

        // Free the raw response buffer
        s_response_raw = "";
        s_request_body = "";
        return;
    }

    } // switch
}

State getState() {
    return s_state;
}

String getResponse() {
    return s_response_text;
}

String getError() {
    return s_error_text;
}

void reset() {
    s_client.stop();
    s_state = State::IDLE;
    s_response_raw = "";
    s_response_text = "";
    s_error_text = "";
    s_request_body = "";
}

uint16_t getDailyCallCount() {
    checkDayRollover();
    return s_daily_call_count;
}

bool isRateLimited() {
    checkDayRollover();

    // Check daily limit
    uint16_t max_daily = Config::getLLMMaxCallsPerDay();
    if (s_daily_call_count >= max_daily) {
        return true;
    }

    // Check minimum interval
    float min_interval = Config::getLLMMinIntervalSec();
    uint32_t min_interval_ms = (uint32_t)(min_interval * 1000.0f);
    if (s_last_call_millis > 0 &&
        (millis() - s_last_call_millis) < min_interval_ms) {
        return true;
    }

    return false;
}

} // namespace LLMClient
} // namespace AI
