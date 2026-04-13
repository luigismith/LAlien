/**
 * pet_serializer.cpp — Serialize/deserialize pet state to/from JSON
 * Uses ArduinoJson 7.x for JSON handling and HAL::SDStorage for SD access.
 * Saves all pet state including death trackers, conversation count,
 * transcendence status, and last words.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "pet_serializer.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"
#include "../pet/pet.h"
#include "../pet/pet_internal.h"
#include "../pet/needs.h"
#include "../pet/dna.h"
#include "../pet/death.h"

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
    doc["transcended"] = Pet::Internal::getTranscended();
    doc["buried"] = Pet::Internal::getBuried();
    doc["death_type"] = (uint8_t)Pet::getDeathType();
    doc["birth_timestamp"] = Pet::Internal::getBirthTimestamp();
    doc["last_evolution_stage"] = Pet::Internal::getLastEvolutionStage();

    // Last words (preserved for graveyard if death sequence interrupted)
    doc["last_words"] = Pet::getLastWords();

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
    inter["voice"]         = Pet::Internal::getVoiceInteractions();
    inter["touch"]         = Pet::Internal::getTouchInteractions();
    inter["play"]          = Pet::Internal::getPlayInteractions();
    inter["conversations"] = Pet::Internal::getConversations();

    // Pathological state timers
    doc["morak_start"] = Pet::Internal::getMorakStart();
    doc["velin_start"] = Pet::Internal::getVelinStart();
    doc["rena_start"]  = Pet::Internal::getRenaStart();

    // Death trackers (for duration-based death conditions)
    const Pet::Death::DeathTrackers& dt = Pet::Death::getTrackers();
    JsonObject death_t = doc["death_trackers"].to<JsonObject>();
    death_t["starvation_start"]         = dt.starvation_start;
    death_t["neglect_start"]            = dt.neglect_start;
    death_t["loneliness_start"]         = dt.loneliness_start;
    death_t["sickness_start"]           = dt.sickness_start;
    death_t["boredom_start"]            = dt.boredom_start;
    death_t["heartbreak_bond_high_time"] = dt.heartbreak_bond_high_time;
    death_t["heartbreak_last_bond"]     = dt.heartbreak_last_bond;
    death_t["transcend_sustain_start"]  = dt.transcend_sustain_start;
    death_t["last_interaction_time"]    = dt.last_interaction_time;

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

    // Alive / death / transcendence
    Pet::Internal::setAlive(doc["alive"] | true);
    Pet::Internal::setTranscended(doc["transcended"] | false);
    Pet::Internal::setBuried(doc["buried"] | false);
    Pet::Internal::setDeathType((Pet::DeathType)(doc["death_type"] | 0));

    // Last words
    const char* last_words = doc["last_words"] | "";
    Pet::Internal::setLastWords(last_words);

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
        Pet::Internal::setConversations(inter["conversations"] | 0);
    }

    // Pathological state timers
    Pet::Internal::setMorakStart(doc["morak_start"] | 0);
    Pet::Internal::setVelinStart(doc["velin_start"] | 0);
    Pet::Internal::setRenaStart(doc["rena_start"]   | 0);

    // Death trackers
    JsonObject death_t = doc["death_trackers"];
    if (death_t) {
        Pet::Death::DeathTrackers dt = {};
        dt.starvation_start         = death_t["starvation_start"] | 0;
        dt.neglect_start            = death_t["neglect_start"] | 0;
        dt.loneliness_start         = death_t["loneliness_start"] | 0;
        dt.sickness_start           = death_t["sickness_start"] | 0;
        dt.boredom_start            = death_t["boredom_start"] | 0;
        dt.heartbreak_bond_high_time = death_t["heartbreak_bond_high_time"] | 0;
        dt.heartbreak_last_bond     = death_t["heartbreak_last_bond"] | 0.0f;
        dt.transcend_sustain_start  = death_t["transcend_sustain_start"] | 0;
        dt.last_interaction_time    = death_t["last_interaction_time"] | 0;
        Pet::Death::setTrackers(dt);
    }

    return true;
}

bool saveVocabulary() {
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

    JsonArray arr = doc.as<JsonArray>();
    Pet::Internal::setVocabularySize((uint16_t)arr.size());

    return true;
}

bool saveMilestones() {
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
