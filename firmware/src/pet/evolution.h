/**
 * evolution.h — Stage evolution triggers and visual regression
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include "pet.h"
#include "needs.h"

namespace Pet {
namespace Evolution {

    struct EvolutionRequirements {
        uint32_t min_age_hours;
        uint32_t max_age_hours;
        float min_avg_needs;         // average of all needs
        uint16_t min_voice_interactions;
        uint16_t min_vocabulary;
        uint8_t min_diary_entries;
        float min_bond;
        float min_cosmic;
    };

    /// Check if pet is ready to evolve to next stage.
    bool canEvolve(Stage current, uint32_t age_hours, const NeedsState& needs,
                   uint16_t voice_interactions, uint16_t vocabulary_size,
                   uint8_t diary_entries);

    /// Get requirements for a given stage.
    EvolutionRequirements getRequirements(Stage stage);

    /// Get visual regression factor (0.0 = normal, 1.0 = max regression).
    /// Based on current needs. Affects posture and palette desaturation.
    float getVisualRegression(const NeedsState& needs);

} // namespace Evolution
} // namespace Pet
