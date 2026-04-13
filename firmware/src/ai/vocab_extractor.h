/**
 * vocab_extractor.h --- Vocabulary extraction from user messages
 * After each LLM response, extracts significant words (nouns, verbs,
 * adjectives) from the user's message and updates the creature's known
 * vocabulary list. Vocabulary size drives evolution triggers.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace VocabExtractor {

    /// Maximum tracked vocabulary entries.
    static constexpr uint16_t MAX_VOCAB = 200;

    /// Maximum words included in system prompt.
    static constexpr uint8_t MAX_PROMPT_WORDS = 30;

    struct VocabEntry {
        char word[32];
        uint16_t frequency;
        uint32_t first_seen;    // millis()/1000 at first encounter
        uint32_t last_seen;     // millis()/1000 at last encounter
        char emotion[16];       // emotional context when first learned
    };

    /// Initialize: loads vocabulary from SD if available.
    void init();

    /// Extract vocabulary from a user message. Call after each conversation turn.
    /// mood is the pet's current mood string (e.g. "happy", "sad").
    void extractFromMessage(const String& user_message, const char* mood);

    /// Save vocabulary to SD card.
    bool save();

    /// Load vocabulary from SD card.
    bool load();

    /// Get the total number of unique words learned.
    uint16_t getCount();

    /// Build a summary string of top N words for inclusion in system prompt.
    String buildPromptBlock(uint8_t max_words = MAX_PROMPT_WORDS);

    /// Get a specific entry by index. Returns false if out of range.
    bool getEntry(uint16_t index, VocabEntry& out);

} // namespace VocabExtractor
} // namespace AI
