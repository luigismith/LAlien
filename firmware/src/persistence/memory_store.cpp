/**
 * memory_store.cpp — Conversation memory summaries persistence
 * Manages a FIFO ring of up to 20 MemoryEntry structs, serialized as a
 * JSON array to /data/memories.json with atomic .tmp/.bak writes.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "memory_store.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"
#include "../util/debug.h"

namespace Persistence {
namespace MemoryStore {

static const char* MEM_PATH = "/data/memories.json";
static const char* MEM_TMP  = "/data/memories.json.tmp";
static const char* MEM_BAK  = "/data/memories.json.bak";

static MemoryEntry s_entries[MAX_ENTRIES];
static uint8_t     s_count = 0;
static bool         s_dirty = false;
static bool         s_initialized = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Atomic write helper: write .tmp, rename current to .bak, rename .tmp to .json
static bool atomicWrite(const String& json) {
    if (!HAL::SDStorage::writeFileString(MEM_TMP, json)) {
        LOG_ERROR("MemoryStore: failed to write .tmp");
        return false;
    }

    if (HAL::SDStorage::fileExists(MEM_PATH)) {
        HAL::SDStorage::deleteFile(MEM_BAK);
        HAL::SDStorage::renameFile(MEM_PATH, MEM_BAK);
    }

    if (!HAL::SDStorage::renameFile(MEM_TMP, MEM_PATH)) {
        LOG_ERROR("MemoryStore: rename .tmp -> .json failed");
        if (HAL::SDStorage::fileExists(MEM_BAK)) {
            HAL::SDStorage::renameFile(MEM_BAK, MEM_PATH);
        }
        return false;
    }

    return true;
}

/// Evict oldest entry by shifting array left
static void evictOldest() {
    if (s_count == 0) return;
    memmove(&s_entries[0], &s_entries[1],
            sizeof(MemoryEntry) * (s_count - 1));
    s_count--;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

bool init() {
    s_count = 0;
    s_dirty = false;
    s_initialized = true;

    HAL::SDStorage::mkdir("/data");

    String json = HAL::SDStorage::readFileString(MEM_PATH);

    if (json.length() == 0 && HAL::SDStorage::fileExists(MEM_BAK)) {
        DEBUG_LOG("MemoryStore: primary missing, trying .bak");
        json = HAL::SDStorage::readFileString(MEM_BAK);
    }

    if (json.length() == 0) {
        DEBUG_LOG("MemoryStore: no saved memories found");
        return true;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        LOG_ERROR("MemoryStore: JSON parse error");
        return false;
    }

    JsonArray arr = doc.as<JsonArray>();
    for (JsonVariant v : arr) {
        if (s_count >= MAX_ENTRIES) break;

        MemoryEntry& e = s_entries[s_count];
        e.timestamp = v["timestamp"] | (uint32_t)0;

        const char* sum = v["summary"] | "";
        strncpy(e.summary, sum, sizeof(e.summary) - 1);
        e.summary[sizeof(e.summary) - 1] = '\0';

        const char* emo = v["emotion"] | "";
        strncpy(e.emotion, emo, sizeof(e.emotion) - 1);
        e.emotion[sizeof(e.emotion) - 1] = '\0';

        // Topics array
        e.topic_count = 0;
        JsonArray topics = v["topics"];
        if (topics) {
            for (JsonVariant t : topics) {
                if (e.topic_count >= MAX_TOPICS) break;
                const char* topic = t.as<const char*>();
                if (topic) {
                    strncpy(e.topics[e.topic_count], topic,
                            sizeof(e.topics[0]) - 1);
                    e.topics[e.topic_count][sizeof(e.topics[0]) - 1] = '\0';
                    e.topic_count++;
                }
            }
        }

        // Words learned array
        e.words_learned_count = 0;
        JsonArray words = v["words_learned"];
        if (words) {
            for (JsonVariant w : words) {
                if (e.words_learned_count >= MAX_WORDS_LEARNED) break;
                const char* word = w.as<const char*>();
                if (word) {
                    strncpy(e.words_learned[e.words_learned_count], word,
                            sizeof(e.words_learned[0]) - 1);
                    e.words_learned[e.words_learned_count]
                        [sizeof(e.words_learned[0]) - 1] = '\0';
                    e.words_learned_count++;
                }
            }
        }

        s_count++;
    }

    DEBUG_LOGF("MemoryStore: loaded %u entries", s_count);
    return true;
}

bool add(const MemoryEntry& entry) {
    if (!s_initialized) return false;

    // FIFO eviction if at capacity
    if (s_count >= MAX_ENTRIES) {
        evictOldest();
    }

    s_entries[s_count] = entry;
    s_count++;
    s_dirty = true;

    DEBUG_LOGF("MemoryStore: added entry (%u total)", s_count);
    return true;
}

bool add(const char* summary, const char* emotion,
         const char** topics, uint8_t topic_count,
         const char** words_learned, uint8_t words_count) {
    MemoryEntry e;
    memset(&e, 0, sizeof(e));

    e.timestamp = millis() / 1000;

    strncpy(e.summary, summary ? summary : "", sizeof(e.summary) - 1);
    e.summary[sizeof(e.summary) - 1] = '\0';

    strncpy(e.emotion, emotion ? emotion : "", sizeof(e.emotion) - 1);
    e.emotion[sizeof(e.emotion) - 1] = '\0';

    e.topic_count = (topic_count > MAX_TOPICS) ? MAX_TOPICS : topic_count;
    for (uint8_t i = 0; i < e.topic_count; i++) {
        strncpy(e.topics[i], topics[i], sizeof(e.topics[0]) - 1);
        e.topics[i][sizeof(e.topics[0]) - 1] = '\0';
    }

    e.words_learned_count = (words_count > MAX_WORDS_LEARNED)
                                ? MAX_WORDS_LEARNED : words_count;
    for (uint8_t i = 0; i < e.words_learned_count; i++) {
        strncpy(e.words_learned[i], words_learned[i],
                sizeof(e.words_learned[0]) - 1);
        e.words_learned[i][sizeof(e.words_learned[0]) - 1] = '\0';
    }

    return add(e);
}

bool getEntry(uint8_t index, MemoryEntry& out) {
    if (index >= s_count) return false;
    out = s_entries[index];
    return true;
}

uint8_t getCount() {
    return s_count;
}

String buildContextSummary() {
    if (s_count == 0) return "No conversation memories yet.";

    String ctx;
    ctx.reserve(512);
    ctx += "Conversation memories:\n";

    for (uint8_t i = 0; i < s_count; i++) {
        const MemoryEntry& e = s_entries[i];
        ctx += "- [";
        ctx += String(e.timestamp);
        ctx += "] (";
        ctx += e.emotion;
        ctx += ") ";
        ctx += e.summary;

        if (e.topic_count > 0) {
            ctx += " [topics: ";
            for (uint8_t t = 0; t < e.topic_count; t++) {
                if (t > 0) ctx += ", ";
                ctx += e.topics[t];
            }
            ctx += "]";
        }

        if (e.words_learned_count > 0) {
            ctx += " [learned: ";
            for (uint8_t w = 0; w < e.words_learned_count; w++) {
                if (w > 0) ctx += ", ";
                ctx += e.words_learned[w];
            }
            ctx += "]";
        }

        ctx += "\n";
    }

    return ctx;
}

bool save() {
    if (!s_initialized) return false;

    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();

    for (uint8_t i = 0; i < s_count; i++) {
        JsonObject obj = arr.add<JsonObject>();
        obj["timestamp"] = s_entries[i].timestamp;
        obj["summary"]   = s_entries[i].summary;
        obj["emotion"]   = s_entries[i].emotion;

        JsonArray topics = obj["topics"].to<JsonArray>();
        for (uint8_t t = 0; t < s_entries[i].topic_count; t++) {
            topics.add(s_entries[i].topics[t]);
        }

        JsonArray words = obj["words_learned"].to<JsonArray>();
        for (uint8_t w = 0; w < s_entries[i].words_learned_count; w++) {
            words.add(s_entries[i].words_learned[w]);
        }
    }

    String json;
    serializeJson(doc, json);

    if (atomicWrite(json)) {
        s_dirty = false;
        DEBUG_LOGF("MemoryStore: saved %u entries", s_count);
        return true;
    }
    return false;
}

bool isDirty() {
    return s_dirty;
}

void markDirty() {
    s_dirty = true;
}

} // namespace MemoryStore
} // namespace Persistence
