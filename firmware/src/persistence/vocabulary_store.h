/**
 * vocabulary_store.h — Learned vocabulary persistence on SD card
 * Stores up to 500 word entries with meaning, frequency, and stage info.
 * Atomic write with .tmp/.bak pattern for power-loss safety.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace VocabularyStore {

    static constexpr uint16_t MAX_ENTRIES = 500;

    struct VocabEntry {
        char word[32];
        char meaning[64];
        uint32_t first_seen;    // timestamp (seconds since boot/epoch)
        uint16_t frequency;     // usage count
        uint8_t  stage_learned; // evolution stage when first learned
    };

    /// Initialize vocabulary store (load from SD if present).
    bool init();

    /// Add or update a word. If word exists, increments frequency.
    /// Returns false if at capacity and word is new.
    bool add(const char* word, const char* meaning, uint8_t stage);

    /// Lookup a word by string. Returns false if not found.
    bool lookup(const char* word, VocabEntry& out);

    /// Get entry by index (0-based). Returns false if out of range.
    bool getEntry(uint16_t index, VocabEntry& out);

    /// Get all entries for a given evolution stage.
    /// Fills out array up to max_count. Returns actual count found.
    uint16_t getByStage(uint8_t stage, VocabEntry* out, uint16_t max_count);

    /// Get current word count.
    uint16_t getCount();

    /// Save vocabulary to SD card (atomic write). Returns false on failure.
    bool save();

    /// Returns true if in-memory state differs from last save.
    bool isDirty();

    /// Mark vocabulary as dirty (external mutation happened).
    void markDirty();

} // namespace VocabularyStore
} // namespace Persistence
