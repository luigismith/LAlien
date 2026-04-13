/**
 * vocabulary_store.cpp — Learned vocabulary persistence on SD card
 * Manages an in-memory array of up to 500 VocabEntry structs, serialized
 * as a JSON array to /data/vocabulary.json with atomic .tmp/.bak writes.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "vocabulary_store.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"
#include "../util/debug.h"

namespace Persistence {
namespace VocabularyStore {

static const char* VOCAB_PATH = "/data/vocabulary.json";
static const char* VOCAB_TMP  = "/data/vocabulary.json.tmp";
static const char* VOCAB_BAK  = "/data/vocabulary.json.bak";

static VocabEntry s_entries[MAX_ENTRIES];
static uint16_t   s_count = 0;
static bool        s_dirty = false;
static bool        s_initialized = false;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Find index of word in s_entries. Returns -1 if not found.
static int16_t findWord(const char* word) {
    for (uint16_t i = 0; i < s_count; i++) {
        if (strcasecmp(s_entries[i].word, word) == 0) {
            return (int16_t)i;
        }
    }
    return -1;
}

/// Atomic write helper: write to .tmp, rename current to .bak, rename .tmp to .json
static bool atomicWrite(const String& json) {
    // 1. Write to .tmp
    if (!HAL::SDStorage::writeFileString(VOCAB_TMP, json)) {
        LOG_ERROR("VocabularyStore: failed to write .tmp");
        return false;
    }

    // 2. Backup current file
    if (HAL::SDStorage::fileExists(VOCAB_PATH)) {
        HAL::SDStorage::deleteFile(VOCAB_BAK);
        HAL::SDStorage::renameFile(VOCAB_PATH, VOCAB_BAK);
    }

    // 3. Promote .tmp to live
    if (!HAL::SDStorage::renameFile(VOCAB_TMP, VOCAB_PATH)) {
        LOG_ERROR("VocabularyStore: rename .tmp -> .json failed");
        // Try to restore from .bak
        if (HAL::SDStorage::fileExists(VOCAB_BAK)) {
            HAL::SDStorage::renameFile(VOCAB_BAK, VOCAB_PATH);
        }
        return false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

bool init() {
    s_count = 0;
    s_dirty = false;
    s_initialized = true;

    HAL::SDStorage::mkdir("/data");

    // Try primary file
    String json = HAL::SDStorage::readFileString(VOCAB_PATH);

    // Fall back to .bak if primary is missing or empty
    if (json.length() == 0 && HAL::SDStorage::fileExists(VOCAB_BAK)) {
        DEBUG_LOG("VocabularyStore: primary missing, trying .bak");
        json = HAL::SDStorage::readFileString(VOCAB_BAK);
    }

    if (json.length() == 0) {
        DEBUG_LOG("VocabularyStore: no saved vocabulary found");
        return true; // Not an error — just empty
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        LOG_ERROR("VocabularyStore: JSON parse error");
        return false;
    }

    JsonArray arr = doc.as<JsonArray>();
    for (JsonVariant v : arr) {
        if (s_count >= MAX_ENTRIES) break;

        VocabEntry& e = s_entries[s_count];
        const char* w = v["word"] | "";
        const char* m = v["meaning"] | "";
        strncpy(e.word, w, sizeof(e.word) - 1);
        e.word[sizeof(e.word) - 1] = '\0';
        strncpy(e.meaning, m, sizeof(e.meaning) - 1);
        e.meaning[sizeof(e.meaning) - 1] = '\0';
        e.first_seen    = v["first_seen"]    | (uint32_t)0;
        e.frequency     = v["frequency"]     | (uint16_t)0;
        e.stage_learned = v["stage_learned"] | (uint8_t)0;
        s_count++;
    }

    DEBUG_LOGF("VocabularyStore: loaded %u entries", s_count);
    return true;
}

bool add(const char* word, const char* meaning, uint8_t stage) {
    if (!s_initialized) return false;

    int16_t idx = findWord(word);
    if (idx >= 0) {
        // Word already exists — increment frequency, update meaning if non-empty
        s_entries[idx].frequency++;
        if (meaning && meaning[0] != '\0') {
            strncpy(s_entries[idx].meaning, meaning,
                    sizeof(s_entries[idx].meaning) - 1);
            s_entries[idx].meaning[sizeof(s_entries[idx].meaning) - 1] = '\0';
        }
        s_dirty = true;
        return true;
    }

    // New word
    if (s_count >= MAX_ENTRIES) {
        LOG_ERROR("VocabularyStore: at capacity (500)");
        return false;
    }

    VocabEntry& e = s_entries[s_count];
    strncpy(e.word, word, sizeof(e.word) - 1);
    e.word[sizeof(e.word) - 1] = '\0';
    strncpy(e.meaning, meaning ? meaning : "", sizeof(e.meaning) - 1);
    e.meaning[sizeof(e.meaning) - 1] = '\0';
    e.first_seen    = millis() / 1000;
    e.frequency     = 1;
    e.stage_learned = stage;

    s_count++;
    s_dirty = true;

    DEBUG_LOGF("VocabularyStore: added \"%s\" (%u total)", word, s_count);
    return true;
}

bool lookup(const char* word, VocabEntry& out) {
    int16_t idx = findWord(word);
    if (idx < 0) return false;
    out = s_entries[idx];
    return true;
}

bool getEntry(uint16_t index, VocabEntry& out) {
    if (index >= s_count) return false;
    out = s_entries[index];
    return true;
}

uint16_t getByStage(uint8_t stage, VocabEntry* out, uint16_t max_count) {
    uint16_t found = 0;
    for (uint16_t i = 0; i < s_count && found < max_count; i++) {
        if (s_entries[i].stage_learned == stage) {
            out[found] = s_entries[i];
            found++;
        }
    }
    return found;
}

uint16_t getCount() {
    return s_count;
}

bool save() {
    if (!s_initialized) return false;

    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();

    for (uint16_t i = 0; i < s_count; i++) {
        JsonObject obj = arr.add<JsonObject>();
        obj["word"]          = s_entries[i].word;
        obj["meaning"]       = s_entries[i].meaning;
        obj["first_seen"]    = s_entries[i].first_seen;
        obj["frequency"]     = s_entries[i].frequency;
        obj["stage_learned"] = s_entries[i].stage_learned;
    }

    String json;
    serializeJson(doc, json);

    if (atomicWrite(json)) {
        s_dirty = false;
        DEBUG_LOGF("VocabularyStore: saved %u entries", s_count);
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

} // namespace VocabularyStore
} // namespace Persistence
