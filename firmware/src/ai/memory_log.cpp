/**
 * memory_log.cpp --- Conversation memory beyond the 5-turn sliding window
 * Stores condensed summaries of past conversations with emotional tone,
 * topics, and new words learned. Max 20 entries with FIFO eviction.
 * Persists to SD as conversation_memory.json.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "memory_log.h"
#include "../hal/sd_storage.h"
#include <ArduinoJson.h>

namespace AI {
namespace ConversationMemory {

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

static const char* MEMORY_PATH = "/lalien/pets/current/conversation_memory.json";

static MemoryEntry s_memories[MAX_MEMORIES];
static uint8_t s_count = 0;
static bool s_dirty = false;

// ---------------------------------------------------------------------------
// Simple topic extraction from text
// Picks the longest 3 words as likely topic keywords.
// ---------------------------------------------------------------------------

static String extractTopics(const String& user_msg) {
    String msg = user_msg;
    msg.toLowerCase();

    // Collect words longer than 4 chars
    struct WordInfo {
        char word[24];
        uint8_t len;
    };
    static constexpr uint8_t MAX_CANDIDATES = 16;
    WordInfo candidates[MAX_CANDIDATES];
    uint8_t candidate_count = 0;

    int start = 0;
    int msg_len = msg.length();

    for (int i = 0; i <= msg_len; i++) {
        bool at_end = (i == msg_len);
        char c = at_end ? ' ' : msg.charAt(i);
        bool is_sep = (c == ' ' || c == ',' || c == '.' || c == '!'
                    || c == '?' || c == '\n' || c == '\t');

        if (is_sep && i > start) {
            int word_len = i - start;
            if (word_len > 4 && word_len < 23 && candidate_count < MAX_CANDIDATES) {
                String w = msg.substring(start, i);
                strncpy(candidates[candidate_count].word, w.c_str(), 23);
                candidates[candidate_count].word[23] = '\0';
                candidates[candidate_count].len = word_len;
                candidate_count++;
            }
            start = i + 1;
        } else if (is_sep) {
            start = i + 1;
        }
    }

    // Pick up to 3 longest words as topics
    String topics;
    bool used[MAX_CANDIDATES];
    memset(used, false, sizeof(used));

    for (uint8_t n = 0; n < 3 && n < candidate_count; n++) {
        uint8_t best_len = 0;
        int8_t best_idx = -1;
        for (uint8_t j = 0; j < candidate_count; j++) {
            if (!used[j] && candidates[j].len > best_len) {
                best_len = candidates[j].len;
                best_idx = j;
            }
        }
        if (best_idx < 0) break;
        used[best_idx] = true;

        if (topics.length() > 0) topics += ", ";
        topics += candidates[best_idx].word;
    }

    return topics;
}

// ---------------------------------------------------------------------------
// Build a condensed summary from the last exchange
// ---------------------------------------------------------------------------

static String buildSummary(const String& user_msg, const String& assistant_msg) {
    // Truncate to fit in 128 chars
    String summary;
    summary.reserve(128);

    // Take first ~50 chars of user message
    String user_short = user_msg;
    if (user_short.length() > 50) {
        user_short = user_short.substring(0, 47) + "...";
    }

    // Take first ~50 chars of assistant response
    String asst_short = assistant_msg;
    if (asst_short.length() > 50) {
        asst_short = asst_short.substring(0, 47) + "...";
    }

    summary = "K: \"" + user_short + "\" -> L: \"" + asst_short + "\"";

    // Ensure we don't exceed buffer
    if (summary.length() > 127) {
        summary = summary.substring(0, 124) + "...";
    }

    return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void init() {
    s_count = 0;
    s_dirty = false;
    memset(s_memories, 0, sizeof(s_memories));

    if (load()) {
        Serial.println("[CONV_MEM] Loaded " + String(s_count) + " memories from SD");
    } else {
        Serial.println("[CONV_MEM] No conversation memory file found, starting fresh");
    }
}

void recordConversation(const String& user_msg, const String& assistant_msg,
                        const char* mood, const char* new_words_csv) {
    uint32_t now = millis() / 1000;

    // If full, shift everything left (FIFO)
    if (s_count >= MAX_MEMORIES) {
        for (uint8_t i = 0; i < MAX_MEMORIES - 1; i++) {
            memcpy(&s_memories[i], &s_memories[i + 1], sizeof(MemoryEntry));
        }
        s_count = MAX_MEMORIES - 1;
    }

    MemoryEntry& entry = s_memories[s_count];
    memset(&entry, 0, sizeof(MemoryEntry));

    entry.timestamp = now;

    // Build summary
    String summary = buildSummary(user_msg, assistant_msg);
    strncpy(entry.summary, summary.c_str(), sizeof(entry.summary) - 1);

    // Emotional tone
    if (mood && strlen(mood) > 0) {
        strncpy(entry.emotional_tone, mood, sizeof(entry.emotional_tone) - 1);
    } else {
        strcpy(entry.emotional_tone, "neutral");
    }

    // Topics
    String topics = extractTopics(user_msg);
    strncpy(entry.topics, topics.c_str(), sizeof(entry.topics) - 1);

    // New words
    if (new_words_csv && strlen(new_words_csv) > 0) {
        strncpy(entry.new_words, new_words_csv, sizeof(entry.new_words) - 1);
    }

    entry.turn_count = 1;

    s_count++;
    s_dirty = true;

    Serial.println("[CONV_MEM] Recorded conversation #" + String(s_count)
                   + " tone=" + String(entry.emotional_tone));

    // Auto-save
    save();
}

bool save() {
    if (s_count == 0) return true;

    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();

    for (uint8_t i = 0; i < s_count; i++) {
        JsonObject entry = arr.add<JsonObject>();
        entry["ts"] = s_memories[i].timestamp;
        entry["sum"] = s_memories[i].summary;
        entry["tone"] = s_memories[i].emotional_tone;
        entry["topics"] = s_memories[i].topics;
        entry["words"] = s_memories[i].new_words;
        entry["turns"] = s_memories[i].turn_count;
    }

    String json;
    serializeJson(doc, json);

    bool ok = HAL::SDStorage::writeFileString(MEMORY_PATH, json);
    if (ok) {
        s_dirty = false;
    } else {
        Serial.println("[CONV_MEM] Failed to save to SD");
    }
    return ok;
}

bool load() {
    String content = HAL::SDStorage::readFileString(MEMORY_PATH);
    if (content.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, content);
    if (err) {
        Serial.println("[CONV_MEM] JSON parse error: " + String(err.c_str()));
        return false;
    }

    JsonArray arr = doc.as<JsonArray>();
    s_count = 0;

    for (JsonObject entry : arr) {
        if (s_count >= MAX_MEMORIES) break;

        s_memories[s_count].timestamp = entry["ts"] | 0;

        const char* sum = entry["sum"] | "";
        strncpy(s_memories[s_count].summary, sum, sizeof(s_memories[s_count].summary) - 1);

        const char* tone = entry["tone"] | "neutral";
        strncpy(s_memories[s_count].emotional_tone, tone,
                sizeof(s_memories[s_count].emotional_tone) - 1);

        const char* topics = entry["topics"] | "";
        strncpy(s_memories[s_count].topics, topics, sizeof(s_memories[s_count].topics) - 1);

        const char* words = entry["words"] | "";
        strncpy(s_memories[s_count].new_words, words, sizeof(s_memories[s_count].new_words) - 1);

        s_memories[s_count].turn_count = entry["turns"] | 1;

        s_count++;
    }

    s_dirty = false;
    return true;
}

uint8_t getCount() {
    return s_count;
}

String buildPromptBlock(uint8_t max_entries) {
    if (s_count == 0) return "";

    String block;
    block.reserve(512);
    block += "[LONG_MEMORY_SUMMARY]\n";
    block += "Past conversations you remember:\n";

    // Show last N entries
    uint8_t start_idx = (s_count > max_entries) ? (s_count - max_entries) : 0;

    for (uint8_t i = start_idx; i < s_count; i++) {
        block += "- [";
        block += String(s_memories[i].timestamp);
        block += "] ";
        block += s_memories[i].summary;

        if (strlen(s_memories[i].emotional_tone) > 0) {
            block += " (";
            block += s_memories[i].emotional_tone;
            block += ")";
        }

        if (strlen(s_memories[i].new_words) > 0) {
            block += " [learned: ";
            block += s_memories[i].new_words;
            block += "]";
        }

        block += "\n";
    }

    return block;
}

bool getEntry(uint8_t index, MemoryEntry& out) {
    if (index >= s_count) return false;
    memcpy(&out, &s_memories[index], sizeof(MemoryEntry));
    return true;
}

void clear() {
    s_count = 0;
    s_dirty = true;
    memset(s_memories, 0, sizeof(s_memories));
    HAL::SDStorage::deleteFile(MEMORY_PATH);
    Serial.println("[CONV_MEM] All memories cleared");
}

} // namespace ConversationMemory
} // namespace AI
