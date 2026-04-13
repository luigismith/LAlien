/**
 * graveyard.cpp — Dead pet graveyard management
 * Moves current pet files to a timestamped graveyard directory and writes
 * a full epitaph with last words, personality traits, DNA data, and
 * transcendence status. Supports up to 50 entries with automatic pruning.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "graveyard.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"
#include "../pet/pet.h"
#include "../pet/pet_internal.h"
#include "../pet/personality.h"
#include "../pet/dna.h"

namespace Persistence {
namespace Graveyard {

static const char* GRAVEYARD_DIR = "/lalien/graveyard";
static const char* CURRENT_DIR   = "/lalien/pets/current";
static const char* INDEX_PATH    = "/lalien/graveyard/index.json";

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

// Helper: list graveyard directories from index file
static uint8_t listGraves(String* paths, uint8_t max_count) {
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
static bool updateIndex(const String& path, bool add) {
    JsonDocument doc;

    String json = HAL::SDStorage::readFileString(INDEX_PATH);
    if (json.length() > 0) {
        deserializeJson(doc, json);
    }

    JsonArray arr = doc.is<JsonArray>() ? doc.as<JsonArray>() : doc.to<JsonArray>();

    if (add) {
        arr.add(path);
    } else {
        // Remove entry — rebuild array without the target path
        JsonDocument new_doc;
        JsonArray new_arr = new_doc.to<JsonArray>();
        for (JsonVariant v : arr) {
            if (v.as<String>() != path) {
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
    // Enforce limit before adding
    enforceLimit();

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
            String content = HAL::SDStorage::readFileString(src.c_str());
            if (content.length() > 0) {
                HAL::SDStorage::writeFileString(dst.c_str(), content);
            }
            HAL::SDStorage::deleteFile(src.c_str());
        }
    }

    // 3. Build personality traits string
    const Pet::DNA::DNAData& dna = Pet::Internal::getDNA();
    String personality_str = "";
    if (Pet::Personality::hasTrait(dna, Pet::Personality::CURIOUS))
        personality_str += "curioso ";
    if (Pet::Personality::hasTrait(dna, Pet::Personality::AFFECTIONATE))
        personality_str += "affettuoso ";
    if (Pet::Personality::hasTrait(dna, Pet::Personality::RESERVED))
        personality_str += "riservato ";
    if (Pet::Personality::hasTrait(dna, Pet::Personality::PLAYFUL))
        personality_str += "giocoso ";
    if (Pet::Personality::hasTrait(dna, Pet::Personality::CONTEMPLATIVE))
        personality_str += "contemplativo ";
    personality_str.trim();

    // 4. Write full epitaph.json
    {
        JsonDocument doc;
        doc["name"]           = name;
        doc["cause"]          = cause;
        doc["age_hours"]      = Pet::getAgeHours();
        doc["stage_reached"]  = (uint8_t)Pet::getStage();
        doc["words_learned"]  = Pet::Internal::getVocabularySize();
        doc["timestamp"]      = timestamp;
        doc["last_words"]     = final_words;
        doc["personality"]    = personality_str;
        doc["dna_variant"]    = dna.variant_index;
        doc["core_hue"]       = dna.core_hue;
        doc["transcended"]    = Pet::isTranscended();

        // Save DNA hash as hex string for potential future resurrection
        String dna_hex = "";
        for (uint8_t i = 0; i < Pet::DNA::DNA_HASH_LEN; i++) {
            if (dna.hash[i] < 0x10) dna_hex += "0";
            dna_hex += String(dna.hash[i], HEX);
        }
        doc["dna_hash"] = dna_hex;

        String epitaph_json;
        serializeJsonPretty(doc, epitaph_json);

        String epitaph_path = grave_path + "/epitaph.json";
        HAL::SDStorage::writeFileString(epitaph_path.c_str(), epitaph_json);
    }

    // 5. Write final_words.txt (plain text for easy reading)
    {
        String words_path = grave_path + "/final_words.txt";
        HAL::SDStorage::writeFileString(words_path.c_str(), String(final_words));
    }

    // 6. Delete backup and temp files from current
    String bak_path = String(CURRENT_DIR) + "/pet.json.bak";
    if (HAL::SDStorage::fileExists(bak_path.c_str())) {
        HAL::SDStorage::deleteFile(bak_path.c_str());
    }
    String tmp_path = String(CURRENT_DIR) + "/pet.json.tmp";
    if (HAL::SDStorage::fileExists(tmp_path.c_str())) {
        HAL::SDStorage::deleteFile(tmp_path.c_str());
    }

    // 7. Update graveyard index
    updateIndex(grave_path, true);

    Serial.print("[GRAVEYARD] Buried pet: ");
    Serial.println(name);

    return true;
}

uint8_t getCount() {
    String paths[MAX_ENTRIES];
    return listGraves(paths, MAX_ENTRIES);
}

bool getEntry(uint8_t index, GraveEntry& out) {
    String paths[MAX_ENTRIES];
    uint8_t count = listGraves(paths, MAX_ENTRIES);

    if (index >= count) return false;

    String epitaph_path = paths[index] + "/epitaph.json";
    String json = HAL::SDStorage::readFileString(epitaph_path.c_str());
    if (json.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return false;

    // Name
    const char* name = doc["name"] | "";
    strncpy(out.name, name, sizeof(out.name) - 1);
    out.name[sizeof(out.name) - 1] = '\0';

    // Cause
    const char* cause_str = doc["cause"] | "";
    strncpy(out.cause, cause_str, sizeof(out.cause) - 1);
    out.cause[sizeof(out.cause) - 1] = '\0';

    // Last words
    const char* words = doc["last_words"] | "...";
    strncpy(out.last_words, words, sizeof(out.last_words) - 1);
    out.last_words[sizeof(out.last_words) - 1] = '\0';

    // Personality
    const char* pers = doc["personality"] | "";
    strncpy(out.personality, pers, sizeof(out.personality) - 1);
    out.personality[sizeof(out.personality) - 1] = '\0';

    // Numeric fields
    out.age_hours      = doc["age_hours"] | 0;
    out.stage_reached  = doc["stage_reached"] | 0;
    out.words_learned  = doc["words_learned"] | 0;
    out.timestamp      = doc["timestamp"] | 0;
    out.dna_variant    = doc["dna_variant"] | 0;
    out.core_hue       = doc["core_hue"] | 0;
    out.transcended    = doc["transcended"] | false;

    return true;
}

bool getEntryPath(uint8_t index, String& out_path) {
    String paths[MAX_ENTRIES];
    uint8_t count = listGraves(paths, MAX_ENTRIES);
    if (index >= count) return false;
    out_path = paths[index];
    return true;
}

bool deleteEntry(uint8_t index) {
    String paths[MAX_ENTRIES];
    uint8_t count = listGraves(paths, MAX_ENTRIES);

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

    // Try to remove empty directory
    HAL::SDStorage::deleteFile(grave_path.c_str());

    // Update index
    updateIndex(grave_path, false);

    Serial.print("[GRAVEYARD] Deleted entry: ");
    Serial.println(grave_path);

    return true;
}

void enforceLimit() {
    uint8_t count = getCount();
    if (count < MAX_ENTRIES) return;

    // Find oldest non-transcended entry and remove it
    for (uint8_t i = 0; i < count; i++) {
        GraveEntry entry;
        if (getEntry(i, entry) && !entry.transcended) {
            deleteEntry(i);
            Serial.println("[GRAVEYARD] Pruned oldest non-transcended entry");
            return;
        }
    }

    // If all entries are transcended, remove the absolute oldest
    if (count >= MAX_ENTRIES) {
        deleteEntry(0);
        Serial.println("[GRAVEYARD] Pruned oldest entry (all transcended)");
    }
}

} // namespace Graveyard
} // namespace Persistence
