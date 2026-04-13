/**
 * graveyard.h — Dead pet graveyard management
 * Stores up to 50 memorial entries for past pets.
 * Each entry preserves: name, DNA, stage, age, vocabulary, death cause,
 * last words, timestamp, personality traits, and transcendence status.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace Graveyard {

    static constexpr uint8_t MAX_ENTRIES = 50;

    struct GraveEntry {
        char name[32];
        char cause[32];
        char last_words[300];
        char personality[64];     // personality traits summary
        uint32_t age_hours;
        uint8_t stage_reached;
        uint16_t words_learned;
        uint32_t timestamp;
        uint8_t dna_variant;      // sprite variant for tombstone icon
        uint16_t core_hue;        // DNA core hue for color accent
        bool transcended;         // true if pet achieved transcendence
    };

    /// Move current pet to graveyard. Called on death.
    /// Saves full epitaph with last words, personality, DNA data.
    bool buryPet(const char* cause, const char* final_words);

    /// Get count of buried pets.
    uint8_t getCount();

    /// Get grave entry by index (0 = oldest).
    bool getEntry(uint8_t index, GraveEntry& out);

    /// Get the directory path for a grave entry (for accessing archived files).
    bool getEntryPath(uint8_t index, String& out_path);

    /// Delete a grave entry (with double confirmation from UI).
    bool deleteEntry(uint8_t index);

    /// Enforce max entry limit. Removes oldest non-transcended entries
    /// when count exceeds MAX_ENTRIES.
    void enforceLimit();

} // namespace Graveyard
} // namespace Persistence
