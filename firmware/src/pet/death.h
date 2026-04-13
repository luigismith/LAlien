/**
 * death.h — Death triggers, sequences, and types
 * Full 7-death-type system with duration tracking, last-words generation,
 * and graveyard integration.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include "pet.h"
#include "needs.h"

namespace Pet {
namespace Death {

    /// Duration thresholds for death conditions (in game-time seconds)
    static constexpr uint32_t STARVATION_THRESHOLD_S   = 48 * 3600;  // 48h at 0 hunger
    static constexpr uint32_t NEGLECT_THRESHOLD_S      = 24 * 3600;  // 24h with 3+ critical needs
    static constexpr uint32_t LONELINESS_THRESHOLD_S   = 72 * 3600;  // 72h at 0 social, no interactions
    static constexpr uint32_t SICKNESS_THRESHOLD_S     = 24 * 3600;  // 24h at 0 health
    static constexpr uint32_t BOREDOM_THRESHOLD_S      = 48 * 3600;  // 48h at 0 fun+curiosity
    static constexpr uint32_t HEARTBREAK_WINDOW_S      = 12 * 3600;  // bond drop window (12h)

    /// Critical threshold: need value below this counts as critical
    static constexpr float CRITICAL_THRESHOLD = 10.0f;

    /// Heartbreak thresholds
    static constexpr float HEARTBREAK_HIGH = 80.0f;
    static constexpr float HEARTBREAK_LOW  = 20.0f;

    /// Old age threshold (hours) for elder stage
    static constexpr uint32_t OLD_AGE_THRESHOLD_HOURS = 2500;

    /// Transcendence requirements
    static constexpr float TRANSCEND_BOND_MIN    = 90.0f;
    static constexpr float TRANSCEND_COSMIC_MIN  = 80.0f;
    static constexpr float TRANSCEND_ALL_MIN     = 80.0f;
    static constexpr uint32_t TRANSCEND_SUSTAIN_S = 48 * 3600; // 48h sustained

    /// Internal state for duration tracking (managed by death.cpp)
    struct DeathTrackers {
        uint32_t starvation_start;    // when hunger first hit 0
        uint32_t neglect_start;       // when 3+ needs went critical
        uint32_t loneliness_start;    // when social hit 0 with no interactions
        uint32_t sickness_start;      // when health hit 0
        uint32_t boredom_start;       // when fun+curiosity hit 0
        uint32_t heartbreak_bond_high_time; // last time bond was > 80
        float    heartbreak_last_bond; // last known bond value
        uint32_t transcend_sustain_start; // when all needs went > 80
        uint32_t last_interaction_time;   // last interaction timestamp
    };

    /// Initialize death tracking system.
    void init();

    /// Check all death conditions. Returns NONE if pet is safe.
    DeathType checkDeathTriggers(Stage stage, uint32_t age_hours,
                                  const NeedsState& needs,
                                  uint32_t game_time_seconds,
                                  uint32_t total_interactions);

    /// Record an interaction (resets loneliness timer).
    void recordInteraction(uint32_t game_time_seconds);

    /// Returns true if the death sequence animation is currently playing.
    bool isSequencePlaying();

    /// Returns true if the death sequence is fully complete.
    bool isSequenceComplete();

    /// Start death sequence (animation + last words generation).
    void startSequence(DeathType type);

    /// Update death sequence (call in main loop). Returns true when complete.
    bool updateSequence();

    /// Get the animation name for this death type.
    const char* getAnimationName(DeathType type);

    /// Get the cause string for graveyard storage.
    const char* getCauseString(DeathType type);

    /// Get LLM prompt for generating last words.
    String buildLastWordsPrompt(DeathType type, const char* pet_name,
                                 uint32_t age_days, Stage stage,
                                 const char* top_words, const char* milestones);

    /// Get the death trackers for serialization.
    const DeathTrackers& getTrackers();

    /// Set death trackers (for deserialization).
    void setTrackers(const DeathTrackers& t);

} // namespace Death
} // namespace Pet
