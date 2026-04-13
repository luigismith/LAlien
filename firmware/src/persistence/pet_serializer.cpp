/**
 * pet_serializer.cpp — Serialize/deserialize pet state to/from JSON
 * Uses ArduinoJson 7.x for JSON handling and HAL::SDStorage for SD access.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "pet_serializer.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"
#include "../pet/pet.h"
#include "../pet/pet_internal.h"
#include "../pet/needs.h"
#include "../pet/dna.h"

namespace Persistence {
namespace PetSerializer {

static const char* PET_PATH        = "/lalien/pets/current/pet.json";
static const char* VOCAB_PATH      = "/lalien/pets/current/vocabulary.json";
static const char* MILESTONES_PATH = "/lalien/pets/current/milestones.json";

// Helper: convert DNA hash bytes to hex string
static String hashToHex(const uint8_t* hash, uint8_t len) {
    String hex;
    hex.reserve(len * 2);
    for (uint8_t i = 0; i < len; i++) {
        if (hash[i] < 0x10) hex += '0';
        hex += String(hash[i], HEX);
    }
    return hex;
}

// Helper: convert hex string back to bytes
static bool hexToHash(const char* hex, uint8_t* hash, uint8_t len) {
    if (strlen(hex) != len * 2) return false;
    for (uint8_t i = 0; i < len; i++) {
        char hi = hex[i * 2];
        char lo = hex[i * 2 + 1];

        auto hexVal = [](char c) -> int8_t {
            if (c >= '0' && c <= '9') return c - '0';
            if (c >= 'a' && c <= 'f') return c - 'a' + 10;
            if (c >= 'A' && c <= 'F') return c - 'A' + 10;
            return -1;
        };

        int8_t h = hexVal(hi);
        int8_t l = hexVal(lo);
        if (h < 0 || l < 0) return false;
        hash[i] = (uint8_t)((h << 4) | l);
    }
    return true;
}

bool save() {
    JsonDocument doc;

    doc["name"] = Pet::getName();
    doc["stage"] = (uint8_t)Pet::getStage();
    doc["age_seconds"] = Pet::Internal::getAgeSeconds();
    doc["alive"] = Pet::isAlive();
    doc["death_type"] = (uint8_t)Pet::getDeathType();
    doc["birth_timestamp"] = Pet::Internal::getBirthTimestamp();
    doc["last_evolution_stage"] = Pet::Internal::getLastEvolutionStage();

    // DNA hash
    Pet::DNA::DNAData& dna = Pet::Internal::getDNA();
    doc["dna_hash"] = hashToHex(dna.hash, Pet::DNA::DNA_HASH_LEN);

    // Needs
    Pet::NeedsState& needs = Pet::Internal::getNeeds();
    JsonObject needsObj = doc["needs"].to<JsonObject>();
    needsObj["kora"]      = needs.get(Pet::NeedType::KORA);
    needsObj["moko"]      = needs.get(Pet::NeedType::MOKO);
    needsObj["miska"]     = needs.get(Pet::NeedType::MISKA);
    needsObj["nashi"]     = needs.get(Pet::NeedType::NASHI);
    needsObj["health"]    = needs.get(Pet::NeedType::HEALTH);
    needsObj["cognition"] = needs.get(Pet::NeedType::COGNITION);
    needsObj["affection"] = needs.get(Pet::NeedType::AFFECTION);
    needsObj["curiosity"] = needs.get(Pet::NeedType::CURIOSITY);
    needsObj["cosmic"]    = needs.get(Pet::NeedType::COSMIC);
    needsObj["security"]  = needs.get(Pet::NeedType::SECURITY);

    // Mood
    doc["mood"] = Pet::Internal::getMoodString();

    // Interactions
    JsonObject inter = doc["interactions"].to<JsonObject>();
    inter["voice"] = Pet::Internal::getVoiceInteractions();
    inter["touch"] = Pet::Internal::getTouchInteractions();
    inter["play"]  = Pet::Internal::getPlayInteractions();

    // Pathological state timers
    doc["morak_start"] = Pet::Internal::getMorakStart();
    doc["velin_start"] = Pet::Internal::getVelinStart();
    doc["rena_start"]  = Pet::Internal::getRenaStart();

    // Serialize to string
    String json;
    serializeJsonPretty(doc, json);

    return HAL::SDStorage::writeFileString(PET_PATH, json);
}

bool load() {
    String json = HAL::SDStorage::readFileString(PET_PATH);
    if (json.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return false;

    // Name
    const char* name = doc["name"] | "";
    Pet::Internal::setName(name);

    // Stage
    Pet::Internal::setStage((Pet::Stage)(doc["stage"] | 0));

    // Age
    Pet::Internal::setAgeSeconds(doc["age_seconds"] | 0);

    // Alive / death
    Pet::Internal::setAlive(doc["alive"] | true);
    Pet::Internal::setDeathType((Pet::DeathType)(doc["death_type"] | 0));

    // Timestamps
    Pet::Internal::setBirthTimestamp(doc["birth_timestamp"] | 0);
    Pet::Internal::setLastEvolutionStage(doc["last_evolution_stage"] | 0);

    // DNA hash
    const char* dna_hex = doc["dna_hash"] | "";
    if (strlen(dna_hex) == Pet::DNA::DNA_HASH_LEN * 2) {
        uint8_t hash[Pet::DNA::DNA_HASH_LEN];
        if (hexToHash(dna_hex, hash, Pet::DNA::DNA_HASH_LEN)) {
            Pet::DNA::DNAData dna = Pet::DNA::fromHash(hash);
            Pet::Internal::setDNA(dna);
        }
    }

    // Needs
    Pet::NeedsState needs;
    JsonObject needsObj = doc["needs"];
    if (needsObj) {
        needs.set(Pet::NeedType::KORA,      needsObj["kora"]      | 50.0f);
        needs.set(Pet::NeedType::MOKO,      needsObj["moko"]      | 50.0f);
        needs.set(Pet::NeedType::MISKA,     needsObj["miska"]     | 50.0f);
        needs.set(Pet::NeedType::NASHI,     needsObj["nashi"]     | 50.0f);
        needs.set(Pet::NeedType::HEALTH,    needsObj["health"]    | 50.0f);
        needs.set(Pet::NeedType::COGNITION, needsObj["cognition"] | 50.0f);
        needs.set(Pet::NeedType::AFFECTION, needsObj["affection"] | 50.0f);
        needs.set(Pet::NeedType::CURIOSITY, needsObj["curiosity"] | 50.0f);
        needs.set(Pet::NeedType::COSMIC,    needsObj["cosmic"]    | 50.0f);
        needs.set(Pet::NeedType::SECURITY,  needsObj["security"]  | 50.0f);
    }
    Pet::Internal::setNeeds(needs);

    // Interactions
    JsonObject inter = doc["interactions"];
    if (inter) {
        Pet::Internal::setVoiceInteractions(inter["voice"] | 0);
        Pet::Internal::setTouchInteractions(inter["touch"] | 0);
        Pet::Internal::setPlayInteractions(inter["play"]   | 0);
    }

    // Pathological state timers
    Pet::Internal::setMorakStart(doc["morak_start"] | 0);
    Pet::Internal::setVelinStart(doc["velin_start"] | 0);
    Pet::Internal::setRenaStart(doc["rena_start"]   | 0);

    return true;
}

bool saveVocabulary() {
    // Vocabulary is stored as a JSON array of words
    // The actual vocabulary is managed elsewhere; this provides the persistence interface
    // For now, write an empty array if no vocabulary exists
    if (!HAL::SDStorage::fileExists(VOCAB_PATH)) {
        return HAL::SDStorage::writeFileString(VOCAB_PATH, "[]");
    }
    return true;
}

bool loadVocabulary() {
    if (!HAL::SDStorage::fileExists(VOCAB_PATH)) return false;

    String json = HAL::SDStorage::readFileString(VOCAB_PATH);
    if (json.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return false;

    // Count vocabulary entries
    JsonArray arr = doc.as<JsonArray>();
    Pet::Internal::setVocabularySize((uint16_t)arr.size());

    return true;
}

bool saveMilestones() {
    // Milestones stored as JSON array of {type, timestamp, description}
    if (!HAL::SDStorage::fileExists(MILESTONES_PATH)) {
        return HAL::SDStorage::writeFileString(MILESTONES_PATH, "[]");
    }
    return true;
}

bool loadMilestones() {
    if (!HAL::SDStorage::fileExists(MILESTONES_PATH)) return false;

    String json = HAL::SDStorage::readFileString(MILESTONES_PATH);
    if (json.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) return false;

    return true;
}

} // namespace PetSerializer
} // namespace Persistence
