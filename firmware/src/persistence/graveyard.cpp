/**
 * graveyard.cpp — Dead pet graveyard management
 * Moves current pet files to a timestamped graveyard directory and writes
 * epitaph and final words. Provides browsing and deletion of grave entries.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "graveyard.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"
#include "../pet/pet.h"
#include "../pet/pet_internal.h"

namespace Persistence {
namespace Graveyard {

static const char* GRAVEYARD_DIR = "/lalien/graveyard";
static const char* CURRENT_DIR   = "/lalien/pets/current";

// Files to move from current pet to graveyard
static const char* PET_FILES[] = {
    "pet.json",
    "vocabulary.json",
    "diary.jsonl",
    "memory.jsonl",
    "milestones.json"
};
static constexpr uint8_t NUM_PET_FILES = sizeof(PET_FILES) / sizeof(PET_FILES[0]);

// Helper: build grave directory path
static String buildGravePath(uint32_t timestamp, const char* name) {
    String path = GRAVEYARD_DIR;
    path += "/pet_";
    path += String(timestamp);
    path += "_";
    // Sanitize name for filesystem
    for (const char* p = name; *p; p++) {
        char c = *p;
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-') {
            path += c;
        } else {
            path += '_';
        }
    }
    return path;
}

// Helper: list graveyard directories by scanning for epitaph.json
// Returns count and fills paths array (up to max_count)
static uint8_t listGraves(String* paths, uint8_t max_count) {
    // Since HAL::SDStorage doesn't have a directory listing API,
    // we maintain a graveyard index file
    static const char* INDEX_PATH = "/lalien/graveyard/index.json";

    String json = HAL::SDStorage::readFileString(INDEX_PATH);
    if (json.length() == 0) return 0;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return 0;

    JsonArray arr = doc.as<JsonArray>();
    uint8_t count = 0;
    for (JsonVariant v : arr) {
        if (count >= max_count) break;
        paths[count] = v.as<String>();
        count++;
    }
    return count;
}

// Helper: update graveyard index file
static bool updateIndex(const String& new_path, bool add) {
    static const char* INDEX_PATH = "/lalien/graveyard/index.json";

    JsonDocument doc;

    String json = HAL::SDStorage::readFileString(INDEX_PATH);
    if (json.length() > 0) {
        deserializeJson(doc, json);
    }

    JsonArray arr = doc.is<JsonArray>() ? doc.as<JsonArray>() : doc.to<JsonArray>();

    if (add) {
        arr.add(new_path);
    } else {
        // Remove entry
        JsonDocument new_doc;
        JsonArray new_arr = new_doc.to<JsonArray>();
        for (JsonVariant v : arr) {
            if (v.as<String>() != new_path) {
                new_arr.add(v);
            }
        }
        String out;
        serializeJson(new_doc, out);
        return HAL::SDStorage::writeFileString(INDEX_PATH, out);
    }

    String out;
    serializeJson(doc, out);
    return HAL::SDStorage::writeFileString(INDEX_PATH, out);
}

bool buryPet(const char* cause, const char* final_words) {
    uint32_t timestamp = millis() / 1000;
    const char* name = Pet::getName();

    // 1. Create graveyard directory
    String grave_path = buildGravePath(timestamp, name);
    HAL::SDStorage::mkdir(GRAVEYARD_DIR);
    HAL::SDStorage::mkdir(grave_path.c_str());

    // 2. Move current pet files to graveyard
    for (uint8_t i = 0; i < NUM_PET_FILES; i++) {
        String src = String(CURRENT_DIR) + "/" + PET_FILES[i];
        String dst = grave_path + "/" + PET_FILES[i];
        if (HAL::SDStorage::fileExists(src.c_str())) {
            // Copy then delete (move via rename may fail across dirs)
            String content = HAL::SDStorage::readFileString(src.c_str());
            if (content.length() > 0) {
                HAL::SDStorage::writeFileString(dst.c_str(), content);
            }
            HAL::SDStorage::deleteFile(src.c_str());
        }
    }

    // 3. Write epitaph.json
    {
        JsonDocument doc;
        doc["name"] = name;
        doc["cause"] = cause;
        doc["age_hours"] = Pet::getAgeHours();
        doc["stage_reached"] = (uint8_t)Pet::getStage();
        doc["words_learned"] = Pet::Internal::getVocabularySize();
        doc["timestamp"] = timestamp;

        String epitaph_json;
        serializeJsonPretty(doc, epitaph_json);

        String epitaph_path = grave_path + "/epitaph.json";
        HAL::SDStorage::writeFileString(epitaph_path.c_str(), epitaph_json);
    }

    // 4. Write final_words.txt
    {
        String words_path = grave_path + "/final_words.txt";
        HAL::SDStorage::writeFileString(words_path.c_str(), String(final_words));
    }

    // 5. Delete backup files from current
    String bak_path = String(CURRENT_DIR) + "/pet.json.bak";
    if (HAL::SDStorage::fileExists(bak_path.c_str())) {
        HAL::SDStorage::deleteFile(bak_path.c_str());
    }
    String tmp_path = String(CURRENT_DIR) + "/pet.json.tmp";
    if (HAL::SDStorage::fileExists(tmp_path.c_str())) {
        HAL::SDStorage::deleteFile(tmp_path.c_str());
    }

    // 6. Update graveyard index
    updateIndex(grave_path, true);

    return true;
}

uint8_t getCount() {
    String paths[32];
    return listGraves(paths, 32);
}

bool getEntry(uint8_t index, GraveEntry& out) {
    String paths[32];
    uint8_t count = listGraves(paths, 32);

    if (index >= count) return false;

    String epitaph_path = paths[index] + "/epitaph.json";
    String json = HAL::SDStorage::readFileString(epitaph_path.c_str());
    if (json.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return false;

    const char* name = doc["name"] | "";
    strncpy(out.name, name, sizeof(out.name) - 1);
    out.name[sizeof(out.name) - 1] = '\0';

    const char* cause_str = doc["cause"] | "";
    strncpy(out.cause, cause_str, sizeof(out.cause) - 1);
    out.cause[sizeof(out.cause) - 1] = '\0';

    out.age_hours = doc["age_hours"] | 0;
    out.stage_reached = doc["stage_reached"] | 0;
    out.words_learned = doc["words_learned"] | 0;
    out.timestamp = doc["timestamp"] | 0;

    return true;
}

bool deleteEntry(uint8_t index) {
    String paths[32];
    uint8_t count = listGraves(paths, 32);

    if (index >= count) return false;

    String grave_path = paths[index];

    // Delete all files in the graveyard entry directory
    const char* all_files[] = {
        "pet.json", "vocabulary.json", "diary.jsonl",
        "memory.jsonl", "milestones.json", "epitaph.json",
        "final_words.txt"
    };
    for (const char* f : all_files) {
        String fpath = grave_path + "/" + f;
        if (HAL::SDStorage::fileExists(fpath.c_str())) {
            HAL::SDStorage::deleteFile(fpath.c_str());
        }
    }

    // Note: SD library typically can't delete directories directly,
    // but the directory should be empty now. Some implementations
    // allow rmdir on empty dirs via deleteFile.
    HAL::SDStorage::deleteFile(grave_path.c_str());

    // Update index
    updateIndex(grave_path, false);

    return true;
}

} // namespace Graveyard
} // namespace Persistence
