/**
 * personality.h — Personality traits derived from DNA, woven into LLM system prompt
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "dna.h"

namespace Pet {
namespace Personality {

    enum Trait : uint8_t {
        CURIOUS        = 0x01,
        AFFECTIONATE   = 0x02,
        RESERVED       = 0x04,
        PLAYFUL        = 0x08,
        CONTEMPLATIVE  = 0x10,
    };

    /// Check if DNA has a specific trait.
    bool hasTrait(const DNA::DNAData& dna, Trait trait);

    /// Get food preferences (derived from DNA). Returns indices into food types.
    void getFoodPreferences(const DNA::DNAData& dna, uint8_t* prefs, uint8_t& count);

    /// Get preferred time of day (0=morning, 1=afternoon, 2=evening, 3=night).
    uint8_t getPreferredTimeOfDay(const DNA::DNAData& dna);

    /// Build personality block for LLM system prompt.
    String buildPromptBlock(const DNA::DNAData& dna);

} // namespace Personality
} // namespace Pet
