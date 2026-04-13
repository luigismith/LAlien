/**
 * evolution.h — Stage evolution triggers and visual regression
 * 8 stages: egg through transcendent, each with specific requirements.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include "pet.h"
#include "needs.h"

namespace Pet {
namespace Evolution {

    struct EvolutionRequirements {
        uint32_t min_age_hours;
        float min_avg_needs;              // average of all needs
        uint16_t min_touch_interactions;   // for egg hatching
        uint16_t min_voice_interactions;
        uint16_t min_vocabulary;
        uint16_t min_conversations;        // total conversation count
        uint8_t min_diary_entries;
        float min_bond;                    // affection need threshold
        float min_cosmic;                  // cosmic connection threshold
        bool needs_sustain;                // requires sustained high needs
    };

    /// Check if pet is ready to evolve to next stage.
    bool canEvolve(Stage current, uint32_t age_hours, const NeedsState& needs,
                   uint16_t touch_interactions, uint16_t voice_interactions,
                   uint16_t vocabulary_size, uint16_t conversations,
                   uint8_t diary_entries);

    /// Get requirements for evolving FROM a given stage to the next.
    EvolutionRequirements getRequirements(Stage stage);

    /// Get visual regression factor (0.0 = normal, 1.0 = max regression).
    /// Based on current needs. Affects posture and palette desaturation.
    float getVisualRegression(const NeedsState& needs);

    /// Check/set evolution animation flag (read by UI to play animation).
    bool isEvolving();
    void setEvolving(bool evolving);

    /// Get the stage the pet just evolved FROM (for animation context).
    Stage getEvolutionFromStage();
    void setEvolutionFromStage(Stage stage);

    /// Get the stage the pet just evolved TO.
    Stage getEvolutionToStage();
    void setEvolutionToStage(Stage stage);

    /// Clear evolution animation state (called by UI after animation plays).
    void clearEvolutionState();

} // namespace Evolution
} // namespace Pet
