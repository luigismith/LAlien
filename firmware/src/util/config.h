/**
 * config.h — Global configuration and runtime settings
 * Loaded from SD card /lalien/config.json, with compile-time defaults
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

// Compile-time defaults
#define LALIEN_VERSION "0.1.0"

// Debug time multiplier: set to 100.0 for accelerated testing
#ifndef DEBUG_TIME_MULTIPLIER
#define DEBUG_TIME_MULTIPLIER 1.0f
#endif

namespace Config {

    /// Load config from SD card. Returns false if not found (first boot).
    bool load();

    /// Save current config to SD card (encrypted where needed).
    bool save();

    /// Returns true if config has been loaded successfully.
    bool isLoaded();

    // --- Accessors ---

    const char* getSSID();
    const char* getPassword();
    const char* getAPIKey();        // decrypted
    const char* getSTTAPIKey();     // OpenAI key for Whisper (may be empty)
    const char* getProvider();      // "anthropic" or "openai"
    const char* getLanguage();      // "it", "en", "es", "fr", "de"
    const char* getPetName();       // may be empty until hatching

    uint16_t getLLMMaxCallsPerDay();
    float getLLMMinIntervalSec();
    float getTimeMultiplier();      // DEBUG_TIME_MULTIPLIER from config or compile-time

    // --- Setters (mark config as dirty) ---

    void setSSID(const char* ssid);
    void setPassword(const char* pass);
    void setAPIKey(const char* key);
    void setSTTAPIKey(const char* key);
    void setProvider(const char* provider);
    void setLanguage(const char* lang);
    void setPetName(const char* name);

} // namespace Config
