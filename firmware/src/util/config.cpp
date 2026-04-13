/**
 * config.cpp — Configuration management
 * Author: Claude Code | Date: 2026-04-13
 */
#include "config.h"
#include "../hal/sd_storage.h"
#include <ArduinoJson.h>

static bool config_loaded = false;
static bool config_dirty = false;

// Config storage
static char ssid[64] = "";
static char password[64] = "";
static char api_key[128] = "";
static char stt_api_key[128] = "";
static char provider[16] = "anthropic";
static char language[4] = "it";
static char pet_name[32] = "";
static uint16_t llm_max_calls = 200;
static float llm_min_interval = 4.0f;
static float time_multiplier = DEBUG_TIME_MULTIPLIER;

namespace Config {

bool load() {
    String json = HAL::SDStorage::readFileString("/lalien/config.json");
    if (json.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, json);
    if (err) {
        LOG_ERROR("Config parse error");
        return false;
    }

    strlcpy(ssid, doc["ssid"] | "", sizeof(ssid));
    strlcpy(password, doc["password"] | "", sizeof(password));
    // API key is encrypted on disk — decrypt here
    strlcpy(api_key, doc["api_key"] | "", sizeof(api_key)); // TODO: decrypt
    strlcpy(stt_api_key, doc["stt_api_key"] | "", sizeof(stt_api_key));
    strlcpy(provider, doc["provider"] | "anthropic", sizeof(provider));
    strlcpy(language, doc["language"] | "it", sizeof(language));
    strlcpy(pet_name, doc["pet_name"] | "", sizeof(pet_name));
    llm_max_calls = doc["llm_max_calls"] | 200;
    llm_min_interval = doc["llm_min_interval"] | 4.0f;
    time_multiplier = doc["time_multiplier"] | DEBUG_TIME_MULTIPLIER;

    config_loaded = true;
    config_dirty = false;
    LOG_INFO("Config loaded");
    return true;
}

bool save() {
    JsonDocument doc;
    doc["ssid"] = ssid;
    doc["password"] = password;
    doc["api_key"] = api_key; // TODO: encrypt
    doc["stt_api_key"] = stt_api_key;
    doc["provider"] = provider;
    doc["language"] = language;
    doc["pet_name"] = pet_name;
    doc["llm_max_calls"] = llm_max_calls;
    doc["llm_min_interval"] = llm_min_interval;
    doc["time_multiplier"] = time_multiplier;

    String json;
    serializeJsonPretty(doc, json);
    bool ok = HAL::SDStorage::writeFileString("/lalien/config.json", json);
    if (ok) config_dirty = false;
    return ok;
}

bool isLoaded() { return config_loaded; }

const char* getSSID()           { return ssid; }
const char* getPassword()       { return password; }
const char* getAPIKey()         { return api_key; }
const char* getSTTAPIKey()      { return stt_api_key; }
const char* getProvider()       { return provider; }
const char* getLanguage()       { return language; }
const char* getPetName()        { return pet_name; }
uint16_t getLLMMaxCallsPerDay() { return llm_max_calls; }
float getLLMMinIntervalSec()    { return llm_min_interval; }
float getTimeMultiplier()       { return time_multiplier; }

void setSSID(const char* s)       { strlcpy(ssid, s, sizeof(ssid)); config_dirty = true; }
void setPassword(const char* p)   { strlcpy(password, p, sizeof(password)); config_dirty = true; }
void setAPIKey(const char* k)     { strlcpy(api_key, k, sizeof(api_key)); config_dirty = true; }
void setSTTAPIKey(const char* k)  { strlcpy(stt_api_key, k, sizeof(stt_api_key)); config_dirty = true; }
void setProvider(const char* p)   { strlcpy(provider, p, sizeof(provider)); config_dirty = true; }
void setLanguage(const char* l)   { strlcpy(language, l, sizeof(language)); config_dirty = true; }
void setPetName(const char* n)    { strlcpy(pet_name, n, sizeof(pet_name)); config_dirty = true; }

} // namespace Config
