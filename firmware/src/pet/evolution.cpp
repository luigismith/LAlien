/**
 * evolution.cpp — Stage evolution triggers and visual regression
 * Defines requirements per stage and checks readiness to evolve.
 * 8 stages with progressive requirements:
 *   EGG -> LARVA: 24h + touch > 10
 *   LARVA -> PUPA: 72h + vocab > 5 + avg needs > 50%
 *   PUPA -> JUVENILE: 168h + vocab > 15
 *   JUVENILE -> ADOLESCENT: 336h + vocab > 30 + bond > 60%
 *   ADOLESCENT -> ADULT: 672h + vocab > 60 + conversations > 50
 *   ADULT -> ELDER: 1344h + vocab > 100
 *   ELDER -> TRANSCENDENT: vocab > 100 + bond > 90% + all needs > 80% sustained
 * Author: Claude Code | Date: 2026-04-13
 */
#include "evolution.h"

namespace Pet {
namespace Evolution {

// --- Evolution animation state ---
static bool s_is_evolving = false;
static Stage s_evolve_from = Stage::SYRMA;
static Stage s_evolve_to   = Stage::SYRMA;

// Stage requirements table (index = current stage, requirements to evolve TO next)
//                                 age    avg   touch voice vocab convs diary bond  cosmic sustain
static const EvolutionRequirements REQUIREMENTS[] = {
    // Stage 0 (EGG) -> 1 (LARVA): 24h + touch > 10
    { 24,   0.0f,  10, 0,  0,   0, 0, 0.0f,  0.0f,  false },
    // Stage 1 (LARVA) -> 2 (PUPA): 72h + vocab > 5 + avg needs > 50%
    { 72,   50.0f,  0, 0,  5,   0, 0, 0.0f,  0.0f,  false },
    // Stage 2 (PUPA) -> 3 (JUVENILE): 168h (1 week) + vocab > 15
    { 168,  50.0f,  0, 0,  15,  0, 0, 0.0f,  0.0f,  false },
    // Stage 3 (JUVENILE) -> 4 (ADOLESCENT): 336h (2 weeks) + vocab > 30 + bond > 60%
    { 336,  50.0f,  0, 0,  30,  0, 0, 60.0f, 0.0f,  false },
    // Stage 4 (ADOLESCENT) -> 5 (ADULT): 672h (4 weeks) + vocab > 60 + conversations > 50
    { 672,  50.0f,  0, 0,  60,  50, 0, 0.0f,  0.0f,  false },
    // Stage 5 (ADULT) -> 6 (ELDER): 1344h (8 weeks) + vocab > 100
    { 1344, 55.0f,  0, 0,  100, 0, 0, 0.0f,  0.0f,  false },
    // Stage 6 (ELDER) -> 7 (TRANSCENDENT): vocab > 100 + bond > 90% + all needs > 80% sustained
    { 2160, 80.0f,  0, 0,  100, 0, 0, 90.0f, 60.0f, true  },
};

static constexpr uint8_t NUM_STAGES = sizeof(REQUIREMENTS) / sizeof(REQUIREMENTS[0]);

EvolutionRequirements getRequirements(Stage stage) {
    uint8_t idx = (uint8_t)stage;
    if (idx < NUM_STAGES) {
        return REQUIREMENTS[idx];
    }
    // Return impossible requirements for invalid stages
    return { 99999, 100.0f, 9999, 9999, 9999, 9999, 255, 100.0f, 100.0f, true };
}

bool canEvolve(Stage current, uint32_t age_hours, const NeedsState& needs,
               uint16_t touch_interactions, uint16_t voice_interactions,
               uint16_t vocabulary_size, uint16_t conversations,
               uint8_t diary_entries) {
    uint8_t idx = (uint8_t)current;
    if (idx >= NUM_STAGES) return false; // Already at max or invalid

    const auto& req = REQUIREMENTS[idx];

    // Age check
    if (age_hours < req.min_age_hours) return false;

    // Needs average check
    float avg = Needs::getOverallWellness(needs);
    if (req.min_avg_needs > 0.0f && avg < req.min_avg_needs) return false;

    // Touch interactions check (primarily for egg hatching)
    if (req.min_touch_interactions > 0 && touch_interactions < req.min_touch_interactions)
        return false;

    // Voice interactions check
    if (req.min_voice_interactions > 0 && voice_interactions < req.min_voice_interactions)
        return false;

    // Vocabulary check
    if (req.min_vocabulary > 0 && vocabulary_size < req.min_vocabulary) return false;

    // Conversations check
    if (req.min_conversations > 0 && conversations < req.min_conversations) return false;

    // Diary entries check
    if (req.min_diary_entries > 0 && diary_entries < req.min_diary_entries) return false;

    // Affection (bond) check
    if (req.min_bond > 0.0f && needs.get(NeedType::AFFECTION) < req.min_bond) return false;

    // Cosmic connection check
    if (req.min_cosmic > 0.0f && needs.get(NeedType::COSMIC) < req.min_cosmic) return false;

    // Sustained needs check — for transcendence, all needs must be above threshold
    // The actual sustained-time check is handled by Death::checkDeathTriggers
    // (transcendence tracker). Here we just check the instantaneous condition.
    if (req.needs_sustain) {
        for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
            if (needs.values[i] < req.min_avg_needs) return false;
        }
    }

    return true;
}

float getVisualRegression(const NeedsState& needs) {
    float avg = Needs::getOverallWellness(needs);

    if (avg > 60.0f) return 0.0f;
    if (avg < 20.0f) return 1.0f;

    // Linear interpolation: 60 -> 0.0, 20 -> 1.0
    return (60.0f - avg) / 40.0f;
}

// --- Evolution animation state ---

bool isEvolving() {
    return s_is_evolving;
}

void setEvolving(bool evolving) {
    s_is_evolving = evolving;
}

Stage getEvolutionFromStage() {
    return s_evolve_from;
}

void setEvolutionFromStage(Stage stage) {
    s_evolve_from = stage;
}

Stage getEvolutionToStage() {
    return s_evolve_to;
}

void setEvolutionToStage(Stage stage) {
    s_evolve_to = stage;
}

void clearEvolutionState() {
    s_is_evolving = false;
    s_evolve_from = Stage::SYRMA;
    s_evolve_to   = Stage::SYRMA;
}

} // namespace Evolution
} // namespace Pet
