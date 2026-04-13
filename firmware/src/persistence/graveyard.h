/**
 * graveyard.h — Dead pet graveyard management
 * Atomic move of current/ to graveyard/pet_<timestamp>_<name>/
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace Graveyard {

    struct GraveEntry {
        char name[32];
        char cause[32];
        uint32_t age_hours;
        uint8_t stage_reached;
        uint16_t words_learned;
        uint32_t timestamp;
    };

    /// Move current pet to graveyard. Called on death.
    bool buryPet(const char* cause, const char* final_words);

    /// Get count of buried pets.
    uint8_t getCount();

    /// Get grave entry by index (0 = oldest).
    bool getEntry(uint8_t index, GraveEntry& out);

    /// Delete a grave entry (with double confirmation from UI).
    bool deleteEntry(uint8_t index);

} // namespace Graveyard
} // namespace Persistence
