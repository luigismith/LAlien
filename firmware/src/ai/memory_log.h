/**
 * memory_log.h --- Conversation memory beyond the 5-turn sliding window
 * Stores condensed summaries of past conversations with emotional tone,
 * topics discussed, and new words learned. Feeds relevant memories into
 * system prompt for continuity. Max 20 entries, FIFO when full.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace ConversationMemory {

    static constexpr uint8_t MAX_MEMORIES = 20;

    struct MemoryEntry {
        uint32_t timestamp;         // millis()/1000
        char summary[128];         // condensed conversation summary
        char emotional_tone[24];   // e.g. "happy", "curious", "sad"
        char topics[64];           // comma-separated topics
        char new_words[64];        // comma-separated new words learned
        uint8_t turn_count;        // how many turns in this conversation
    };

    /// Initialize: loads memories from SD if available.
    void init();

    /// Record a completed conversation summary.
    /// user_msg and assistant_msg are the last turn; mood is current pet mood.
    void recordConversation(const String& user_msg, const String& assistant_msg,
                            const char* mood, const char* new_words_csv);

    /// Save memories to SD card.
    bool save();

    /// Load memories from SD card.
    bool load();

    /// Get total stored memory count.
    uint8_t getCount();

    /// Build a block of relevant memories for the system prompt.
    /// Returns last N memories formatted as text.
    String buildPromptBlock(uint8_t max_entries = 5);

    /// Get a specific memory entry by index. Returns false if out of range.
    bool getEntry(uint8_t index, MemoryEntry& out);

    /// Clear all stored memories.
    void clear();

} // namespace ConversationMemory
} // namespace AI
