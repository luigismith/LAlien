/**
 * stt_client.cpp — Speech-to-text via OpenAI Whisper API
 * Converts PCM16 audio to WAV in memory, sends multipart/form-data POST
 * to Whisper API, parses transcription result. Fully async via poll().
 * Author: Claude Code | Date: 2026-04-13
 */
#include "stt_client.h"
#include "../util/config.h"
#include "../network/tls_certs.h"
#include <WiFi.h>
#include <WiFiSSLClient.h>
#include <ArduinoJson.h>

namespace AI {
namespace STTClient {

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

enum class STTState : uint8_t {
    IDLE,
    CONNECTING,
    SENDING,
    WAITING,
    PARSING,
    DONE,
    ERROR
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

static STTState s_state = STTState::IDLE;
static const char* s_api_key = nullptr;
static WiFiSSLClient s_client;

static String s_transcription;
static String s_response_raw;
static String s_error_text;

// WAV data pointers (non-owning, valid during a transcribe cycle)
static const int16_t* s_audio_data = nullptr;
static uint32_t s_sample_count = 0;

// HTTP response parsing
static bool s_headers_done = false;
static int s_content_length = -1;
static int s_body_received = 0;

// Timeout
static uint32_t s_request_start_millis = 0;
static constexpr uint32_t REQUEST_TIMEOUT_MS = 15000;

// Multipart boundary
static const char BOUNDARY[] = "----LalienAudioBoundary9x7k3m";

// WAV header constants
static constexpr uint32_t WAV_SAMPLE_RATE = 16000;
static constexpr uint16_t WAV_BITS_PER_SAMPLE = 16;
static constexpr uint16_t WAV_NUM_CHANNELS = 1;
static constexpr uint8_t WAV_HEADER_SIZE = 44;

// ---------------------------------------------------------------------------
// WAV header builder (44 bytes, PCM16 mono 16kHz)
// ---------------------------------------------------------------------------

static void writeWavHeader(uint8_t* header, uint32_t data_size) {
    uint32_t file_size = data_size + WAV_HEADER_SIZE - 8;
    uint32_t byte_rate = WAV_SAMPLE_RATE * WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);
    uint16_t block_align = WAV_NUM_CHANNELS * (WAV_BITS_PER_SAMPLE / 8);

    // RIFF header
    memcpy(header + 0, "RIFF", 4);
    memcpy(header + 4, &file_size, 4);
    memcpy(header + 8, "WAVE", 4);

    // fmt sub-chunk
    memcpy(header + 12, "fmt ", 4);
    uint32_t fmt_size = 16;
    memcpy(header + 16, &fmt_size, 4);
    uint16_t audio_format = 1; // PCM
    memcpy(header + 20, &audio_format, 2);
    uint16_t channels = WAV_NUM_CHANNELS;
    memcpy(header + 22, &channels, 2);
    uint32_t sample_rate = WAV_SAMPLE_RATE;
    memcpy(header + 24, &sample_rate, 4);
    memcpy(header + 28, &byte_rate, 4);
    memcpy(header + 32, &block_align, 2);
    uint16_t bps = WAV_BITS_PER_SAMPLE;
    memcpy(header + 34, &bps, 2);

    // data sub-chunk
    memcpy(header + 36, "data", 4);
    memcpy(header + 40, &data_size, 4);
}

// ---------------------------------------------------------------------------
// Compute multipart body length without building the whole body
// ---------------------------------------------------------------------------

static uint32_t computeMultipartBodyLength() {
    uint32_t pcm_bytes = s_sample_count * sizeof(int16_t);
    uint32_t wav_size = WAV_HEADER_SIZE + pcm_bytes;

    // Build part lengths:
    // --BOUNDARY\r\n
    // Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n
    // Content-Type: audio/wav\r\n
    // \r\n
    // <wav data>
    // \r\n
    // --BOUNDARY\r\n
    // Content-Disposition: form-data; name="model"\r\n
    // \r\n
    // whisper-1\r\n
    // --BOUNDARY\r\n
    // Content-Disposition: form-data; name="language"\r\n
    // \r\n
    // <lang>\r\n
    // --BOUNDARY--\r\n

    uint32_t len = 0;

    // File part
    len += 2 + strlen(BOUNDARY) + 2;  // --BOUNDARY\r\n
    len += 52 + 2;  // Content-Disposition line + \r\n
    len += 24 + 2;  // Content-Type line + \r\n
    len += 2;       // \r\n (blank line)
    len += wav_size;
    len += 2;       // \r\n

    // Model part
    len += 2 + strlen(BOUNDARY) + 2;
    len += 40 + 2;  // Content-Disposition
    len += 2;       // blank line
    len += 9 + 2;   // whisper-1\r\n

    // Language part
    const char* lang = Config::getLanguage();
    if (lang && strlen(lang) > 0) {
        len += 2 + strlen(BOUNDARY) + 2;
        len += 43 + 2;  // Content-Disposition
        len += 2;       // blank line
        len += strlen(lang) + 2;
    }

    // Final boundary
    len += 2 + strlen(BOUNDARY) + 2 + 2;  // --BOUNDARY--\r\n

    return len;
}

// ---------------------------------------------------------------------------
// Write multipart body to client
// ---------------------------------------------------------------------------

static void writeMultipartBody() {
    uint32_t pcm_bytes = s_sample_count * sizeof(int16_t);

    // --- File part ---
    s_client.print("--");
    s_client.print(BOUNDARY);
    s_client.print("\r\n");
    s_client.print("Content-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\n");
    s_client.print("Content-Type: audio/wav\r\n");
    s_client.print("\r\n");

    // Write WAV header
    uint8_t wav_header[WAV_HEADER_SIZE];
    writeWavHeader(wav_header, pcm_bytes);
    s_client.write(wav_header, WAV_HEADER_SIZE);

    // Write PCM data in chunks to avoid buffer overflow
    const uint8_t* raw = (const uint8_t*)s_audio_data;
    uint32_t remaining = pcm_bytes;
    static constexpr uint32_t CHUNK_SIZE = 512;

    while (remaining > 0) {
        uint32_t to_write = (remaining > CHUNK_SIZE) ? CHUNK_SIZE : remaining;
        s_client.write(raw, to_write);
        raw += to_write;
        remaining -= to_write;
    }

    s_client.print("\r\n");

    // --- Model part ---
    s_client.print("--");
    s_client.print(BOUNDARY);
    s_client.print("\r\n");
    s_client.print("Content-Disposition: form-data; name=\"model\"\r\n");
    s_client.print("\r\n");
    s_client.print("whisper-1\r\n");

    // --- Language part ---
    const char* lang = Config::getLanguage();
    if (lang && strlen(lang) > 0) {
        s_client.print("--");
        s_client.print(BOUNDARY);
        s_client.print("\r\n");
        s_client.print("Content-Disposition: form-data; name=\"language\"\r\n");
        s_client.print("\r\n");
        s_client.print(lang);
        s_client.print("\r\n");
    }

    // --- Final boundary ---
    s_client.print("--");
    s_client.print(BOUNDARY);
    s_client.print("--\r\n");
}

// ---------------------------------------------------------------------------
// Write HTTP request
// ---------------------------------------------------------------------------

static void writeHttpRequest() {
    uint32_t body_len = computeMultipartBodyLength();

    s_client.println("POST /v1/audio/transcriptions HTTP/1.1");
    s_client.println("Host: api.openai.com");
    s_client.print("Authorization: Bearer ");
    s_client.println(s_api_key);
    s_client.print("Content-Type: multipart/form-data; boundary=");
    s_client.println(BOUNDARY);
    s_client.println("Connection: close");
    s_client.print("Content-Length: ");
    s_client.println(body_len);
    s_client.println(); // End headers

    writeMultipartBody();
}

// ---------------------------------------------------------------------------
// Parse transcription from JSON response
// ---------------------------------------------------------------------------

static bool parseResponse() {
    int body_start = s_response_raw.indexOf("\r\n\r\n");
    if (body_start < 0) {
        s_error_text = "No HTTP body";
        return false;
    }
    body_start += 4;

    // Check status code
    int status_start = s_response_raw.indexOf(' ') + 1;
    int status_code = s_response_raw.substring(status_start, status_start + 3).toInt();

    if (status_code < 200 || status_code >= 300) {
        s_error_text = "STT HTTP ";
        s_error_text += String(status_code);
        return false;
    }

    String body = s_response_raw.substring(body_start);
    int json_start = body.indexOf('{');
    if (json_start < 0) {
        s_error_text = "No JSON in STT response";
        return false;
    }
    body = body.substring(json_start);

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) {
        s_error_text = "STT JSON parse error";
        return false;
    }

    const char* text = doc["text"];
    if (!text) {
        s_error_text = "No text in STT response";
        return false;
    }

    s_transcription = text;
    return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void init(const char* api_key) {
    s_api_key = api_key;
    s_state = STTState::IDLE;
    s_transcription = "";
}

bool isAvailable() {
    return s_api_key != nullptr && strlen(s_api_key) > 0;
}

void transcribe(const int16_t* audio_data, uint32_t sample_count) {
    if (s_state != STTState::IDLE) return;
    if (!isAvailable()) {
        s_error_text = "STT not configured";
        s_state = STTState::ERROR;
        return;
    }

    s_audio_data = audio_data;
    s_sample_count = sample_count;
    s_response_raw = "";
    s_transcription = "";
    s_error_text = "";
    s_headers_done = false;
    s_content_length = -1;
    s_body_received = 0;

    s_request_start_millis = millis();
    s_state = STTState::CONNECTING;
}

void poll() {
    uint32_t now = millis();

    switch (s_state) {

    case STTState::IDLE:
    case STTState::DONE:
    case STTState::ERROR:
        return;

    case STTState::CONNECTING: {
        if (now - s_request_start_millis > REQUEST_TIMEOUT_MS) {
            s_client.stop();
            s_error_text = "STT connection timeout";
            s_state = STTState::ERROR;
            return;
        }

        if (s_client.connect("api.openai.com", 443)) {
            s_state = STTState::SENDING;
        }
        // If connect fails, we just retry on the next poll() until timeout
        return;
    }

    case STTState::SENDING: {
        writeHttpRequest();
        s_state = STTState::WAITING;
        return;
    }

    case STTState::WAITING: {
        if (now - s_request_start_millis > REQUEST_TIMEOUT_MS) {
            s_client.stop();
            s_error_text = "STT response timeout";
            s_state = STTState::ERROR;
            return;
        }

        while (s_client.available()) {
            char c = s_client.read();
            s_response_raw += c;

            if (!s_headers_done) {
                if (s_response_raw.endsWith("\r\n\r\n")) {
                    s_headers_done = true;
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

        bool body_complete = false;
        if (s_headers_done) {
            if (s_content_length > 0 && s_body_received >= s_content_length) {
                body_complete = true;
            }
            if (!s_client.connected() && !s_client.available()) {
                body_complete = true;
            }
        }

        if (body_complete) {
            s_client.stop();
            s_state = STTState::PARSING;
        }
        return;
    }

    case STTState::PARSING: {
        if (parseResponse()) {
            s_state = STTState::DONE;
        } else {
            s_state = STTState::ERROR;
        }
        s_response_raw = "";
        s_audio_data = nullptr;
        s_sample_count = 0;
        return;
    }

    } // switch
}

bool isReady() {
    return s_state == STTState::DONE;
}

String getTranscription() {
    String result = s_transcription;
    // Reset to IDLE so caller can trigger another transcription
    s_state = STTState::IDLE;
    s_transcription = "";
    return result;
}

bool isBusy() {
    return s_state != STTState::IDLE &&
           s_state != STTState::DONE &&
           s_state != STTState::ERROR;
}

String getError() {
    return s_error_text;
}

void reset() {
    if (s_state == STTState::CONNECTING ||
        s_state == STTState::SENDING ||
        s_state == STTState::WAITING) {
        s_client.stop();
    }
    s_state = STTState::IDLE;
    s_transcription = "";
    s_error_text = "";
    s_response_raw = "";
    s_audio_data = nullptr;
    s_sample_count = 0;
}

} // namespace STTClient
} // namespace AI
