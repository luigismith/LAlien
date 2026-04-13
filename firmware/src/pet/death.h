/**
 * death.h — Death triggers, sequences, and types
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include "pet.h"
#include "needs.h"

namespace Pet {
namespace Death {

    /// Check all death conditions. Returns NONE if pet is safe.
    DeathType checkDeathTriggers(Stage stage, uint32_t age_hours,
                                  const NeedsState& needs,
                                  uint32_t morak_duration_s,
                                  uint32_t rena_thishi_duration_s);

    /// Returns true if the death sequence animation is currently playing.
    bool isSequencePlaying();

    /// Start death sequence (animation + last words generation).
    void startSequence(DeathType type);

    /// Update death sequence (call in main loop). Returns true when complete.
    bool updateSequence();

    /// Get the animation name for this death type.
    const char* getAnimationName(DeathType type);

    /// Get LLM prompt for generating last words.
    String buildLastWordsPrompt(DeathType type, const char* pet_name,
                                 uint32_t age_days, Stage stage,
                                 const char* top_words, const char* milestones);

} // namespace Death
} // namespace Pet
