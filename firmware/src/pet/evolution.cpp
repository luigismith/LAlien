/**
 * evolution.cpp — Stage evolution triggers and visual regression
 * Defines requirements per stage and checks readiness to evolve.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "evolution.h"

namespace Pet {
namespace Evolution {

// Stage requirements table
static const EvolutionRequirements REQUIREMENTS[] = {
    // Stage 0→1: age >= 12h, any interactions
    { 12, 0, 0.0f, 0, 0, 0, 0.0f, 0.0f },
    // Stage 1→2: age >= 72h, needs avg > 50
    { 72, 0, 50.0f, 0, 0, 0, 0.0f, 0.0f },
    // Stage 2→3: age >= 168h, needs avg > 50, voice_interactions >= 30
    { 168, 0, 50.0f, 30, 0, 0, 0.0f, 0.0f },
    // Stage 3→4: age >= 336h, needs avg > 50, vocabulary >= 20
    { 336, 0, 50.0f, 0, 20, 0, 0.0f, 0.0f },
    // Stage 4→5: age >= 600h, needs avg > 50, diary_entries >= 7
    { 600, 0, 50.0f, 0, 0, 7, 0.0f, 0.0f },
    // Stage 5→6: age >= 1200h, needs avg > 55, affection > 70
    { 1200, 0, 55.0f, 0, 0, 0, 70.0f, 0.0f },
    // Stage 6→7: age >= 2160h, needs avg > 60, affection > 80, cosmic > 60
    { 2160, 0, 60.0f, 0, 0, 0, 80.0f, 60.0f },
};

static constexpr uint8_t NUM_STAGES = sizeof(REQUIREMENTS) / sizeof(REQUIREMENTS[0]);

EvolutionRequirements getRequirements(Stage stage) {
    uint8_t idx = (uint8_t)stage;
    if (idx < NUM_STAGES) {
        return REQUIREMENTS[idx];
    }
    // Return impossible requirements for invalid stages
    return { 99999, 0, 100.0f, 9999, 9999, 255, 100.0f, 100.0f };
}

bool canEvolve(Stage current, uint32_t age_hours, const NeedsState& needs,
               uint16_t voice_interactions, uint16_t vocabulary_size,
               uint8_t diary_entries) {
    uint8_t idx = (uint8_t)current;
    if (idx >= NUM_STAGES) return false; // Already at max or invalid

    const auto& req = REQUIREMENTS[idx];

    // Age check
    if (age_hours < req.min_age_hours) return false;

    // Needs average check
    float avg = Needs::getOverallWellness(needs);
    if (req.min_avg_needs > 0.0f && avg <= req.min_avg_needs) return false;

    // Voice interactions check
    if (req.min_voice_interactions > 0 && voice_interactions < req.min_voice_interactions) return false;

    // Vocabulary check
    if (req.min_vocabulary > 0 && vocabulary_size < req.min_vocabulary) return false;

    // Diary entries check
    if (req.min_diary_entries > 0 && diary_entries < req.min_diary_entries) return false;

    // Affection check
    if (req.min_bond > 0.0f && needs.get(NeedType::AFFECTION) <= req.min_bond) return false;

    // Cosmic connection check
    if (req.min_cosmic > 0.0f && needs.get(NeedType::COSMIC) <= req.min_cosmic) return false;

    return true;
}

float getVisualRegression(const NeedsState& needs) {
    float avg = Needs::getOverallWellness(needs);

    if (avg > 60.0f) return 0.0f;
    if (avg < 20.0f) return 1.0f;

    // Linear interpolation: 60 → 0.0, 20 → 1.0
    return (60.0f - avg) / 40.0f;
}

} // namespace Evolution
} // namespace Pet
