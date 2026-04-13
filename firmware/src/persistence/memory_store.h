/**
 * memory_store.h — Conversation memory summaries persistence
 * Stores up to 20 conversation summaries on SD card with FIFO eviction.
 * Atomic write with .tmp/.bak pattern for power-loss safety.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace MemoryStore {

    static constexpr uint8_t MAX_ENTRIES = 20;
    static constexpr uint8_t MAX_TOPICS = 8;
    static constexpr uint8_t MAX_WORDS_LEARNED = 8;

    struct MemoryEntry {
        uint32_t timestamp;
        char summary[256];
        char emotion[24];
        char topics[MAX_TOPICS][32];
        uint8_t topic_count;
        char words_learned[MAX_WORDS_LEARNED][32];
        uint8_t words_learned_count;
    };

    /// Initialize memory store (load from SD if present).
    bool init();

    /// Add a new memory entry. If at capacity, evicts the oldest.
    bool add(const MemoryEntry& entry);

    /// Convenience: add with simple parameters.
    bool add(const char* summary, const char* emotion,
             const char** topics, uint8_t topic_count,
             const char** words_learned, uint8_t words_count);

    /// Get entry by index (0 = oldest). Returns false if out of range.
    bool getEntry(uint8_t index, MemoryEntry& out);

    /// Get current entry count.
    uint8_t getCount();

    /// Build a summary string of all memories for LLM context.
    String buildContextSummary();

    /// Save memories to SD card (atomic write). Returns false on failure.
    bool save();

    /// Returns true if in-memory state differs from last save.
    bool isDirty();

    /// Mark memories as dirty.
    void markDirty();

} // namespace MemoryStore
} // namespace Persistence
