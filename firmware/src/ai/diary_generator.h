/**
 * diary_generator.h --- Diary entry generation via LLM
 * After N conversations, triggers a dedicated LLM call to produce a short
 * diary entry from the creature's POV, mixing Lalien vocabulary based on
 * evolution stage. Stores result via persistence layer.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace DiaryGenerator {

    /// Initialize diary generator state.
    void init();

    /// Call after each successful conversation turn.
    /// Increments internal counter; when threshold is reached and diary is due,
    /// begins async diary generation via LLM.
    void onConversationComplete();

    /// Advance the async diary generation state machine.
    /// Call at 10Hz alongside LLMClient::poll().
    void poll();

    /// Returns true if a diary generation is currently in progress.
    bool isBusy();

    /// Set the number of conversations required before generating a diary entry.
    /// Default: 5.
    void setConversationThreshold(uint8_t threshold);

    /// Get current conversation count since last diary entry.
    uint8_t getConversationCount();

    /// Force a diary generation now (ignores threshold, still respects isDue()).
    void forceGenerate();

} // namespace DiaryGenerator
} // namespace AI
