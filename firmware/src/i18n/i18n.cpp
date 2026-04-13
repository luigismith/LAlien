/**
 * i18n.cpp — Internationalization: load UI strings from SD card lang packs
 *
 * Reads /lang/{locale}.json from SD card, parses key-value pairs into
 * a flat lookup table. Provides get(key) for O(n) lookup (fast enough
 * for ~100 keys on ESP32 / GIGA R1).
 *
 * Supports: it (default), en, es, fr, de
 * Falls back to English if a key is missing, then to the raw key string.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "i18n.h"
#include "../hal/sd_card.h"
#include <ArduinoJson.h>

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

/// Maximum number of translatable keys we support.
static constexpr size_t MAX_KEYS = 128;

/// Maximum total characters across all values.
static constexpr size_t VALUE_POOL_SIZE = 8192;

struct I18nEntry {
    const char* key;    // points into keyPool
    const char* value;  // points into valuePool
};

static I18nEntry entries[MAX_KEYS];
static size_t    entryCount = 0;

// Static pools — avoids heap fragmentation on embedded targets.
static char keyPool[4096];
static char valuePool[VALUE_POOL_SIZE];
static size_t keyPoolUsed   = 0;
static size_t valuePoolUsed = 0;

static char currentLang[4] = "en";  // default fallback

// English fallback table (loaded if primary lang != en)
static I18nEntry fallbackEntries[MAX_KEYS];
static size_t    fallbackCount = 0;
static char      fallbackKeyPool[4096];
static char      fallbackValuePool[VALUE_POOL_SIZE];
static size_t    fallbackKeyPoolUsed   = 0;
static size_t    fallbackValuePoolUsed = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Copy a string into a pool, return pointer to the copy.
static const char* poolCopy(const char* src,
                            char* pool, size_t poolSize, size_t& poolUsed) {
    size_t len = strlen(src);
    if (poolUsed + len + 1 > poolSize) {
        Serial.println("[I18N] Pool overflow — string skipped");
        return nullptr;
    }
    char* dst = pool + poolUsed;
    memcpy(dst, src, len + 1);
    poolUsed += len + 1;
    return dst;
}

/// Load a JSON lang file into the given entry table.
static bool loadFile(const char* path,
                     I18nEntry* table, size_t& count, size_t maxEntries,
                     char* kPool, size_t kPoolSize, size_t& kPoolUsed,
                     char* vPool, size_t vPoolSize, size_t& vPoolUsed) {

    // Reset
    count = 0;
    kPoolUsed = 0;
    vPoolUsed = 0;

    // Read file from SD
    String content = HAL::SDCard::readFile(path);
    if (content.length() == 0) {
        Serial.print("[I18N] Failed to read: ");
        Serial.println(path);
        return false;
    }

    // Parse JSON — use a filter to only grab string values
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, content);
    if (err) {
        Serial.print("[I18N] JSON parse error in ");
        Serial.print(path);
        Serial.print(": ");
        Serial.println(err.c_str());
        return false;
    }

    // Iterate all key-value pairs
    JsonObject root = doc.as<JsonObject>();
    for (JsonPair kv : root) {
        if (count >= maxEntries) {
            Serial.println("[I18N] Max keys reached — some strings skipped");
            break;
        }
        if (!kv.value().is<const char*>()) continue;

        const char* k = poolCopy(kv.key().c_str(), kPool, kPoolSize, kPoolUsed);
        const char* v = poolCopy(kv.value().as<const char*>(), vPool, vPoolSize, vPoolUsed);
        if (!k || !v) continue;

        table[count].key   = k;
        table[count].value = v;
        count++;
    }

    Serial.print("[I18N] Loaded ");
    Serial.print(count);
    Serial.print(" strings from ");
    Serial.println(path);
    return true;
}

/// Search a table for a key, return value or nullptr.
static const char* findInTable(const char* key,
                               const I18nEntry* table, size_t count) {
    for (size_t i = 0; i < count; i++) {
        if (strcmp(table[i].key, key) == 0) {
            return table[i].value;
        }
    }
    return nullptr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

namespace I18n {

bool load(const char* lang) {
    if (!lang || strlen(lang) == 0) lang = "it";

    // Clamp to supported locales
    bool supported = (strcmp(lang, "it") == 0 ||
                      strcmp(lang, "en") == 0 ||
                      strcmp(lang, "es") == 0 ||
                      strcmp(lang, "fr") == 0 ||
                      strcmp(lang, "de") == 0);
    if (!supported) {
        Serial.print("[I18N] Unsupported locale '");
        Serial.print(lang);
        Serial.println("' — falling back to 'en'");
        lang = "en";
    }

    strncpy(currentLang, lang, sizeof(currentLang) - 1);
    currentLang[sizeof(currentLang) - 1] = '\0';

    // Build path: /lang/xx.json
    char path[32];
    snprintf(path, sizeof(path), "/lang/%s.json", lang);

    bool ok = loadFile(path,
                       entries, entryCount, MAX_KEYS,
                       keyPool, sizeof(keyPool), keyPoolUsed,
                       valuePool, sizeof(valuePool), valuePoolUsed);

    // If primary lang is not English, load English as fallback
    if (strcmp(lang, "en") != 0) {
        loadFile("/lang/en.json",
                 fallbackEntries, fallbackCount, MAX_KEYS,
                 fallbackKeyPool, sizeof(fallbackKeyPool), fallbackKeyPoolUsed,
                 fallbackValuePool, sizeof(fallbackValuePool), fallbackValuePoolUsed);
    } else {
        fallbackCount = 0;
    }

    return ok;
}

const char* get(const char* key) {
    if (!key) return "";

    // Search primary language
    const char* val = findInTable(key, entries, entryCount);
    if (val) return val;

    // Search English fallback
    if (fallbackCount > 0) {
        val = findInTable(key, fallbackEntries, fallbackCount);
        if (val) return val;
    }

    // Last resort: return the key itself (useful for debugging)
    return key;
}

const char* getCurrentLang() {
    return currentLang;
}

} // namespace I18n
