/**
 * needs.cpp — 10-need system with decay and care mechanics
 * Implements per-second decay, care actions, and pathological state detection.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "needs.h"
#include "../hal/light.h"
#include "../pet/pet.h"

namespace Pet {
namespace Needs {

// --- Decay rates (per second at 1x time multiplier) ---
static constexpr float DECAY_KORA       = 0.015f;
static constexpr float DECAY_MOKO_DAY   = 0.008f;
static constexpr float DECAY_MOKO_STIM  = 0.025f;
static constexpr float DECAY_MISKA      = 0.005f;
static constexpr float DECAY_NASHI      = 0.012f;
static constexpr float DECAY_NASHI_CRASH = 0.030f;
static constexpr float DECAY_HEALTH     = 0.003f;
static constexpr float DECAY_COGNITION  = 0.010f;
static constexpr float DECAY_AFFECTION  = 0.003f;
static constexpr float DECAY_CURIOSITY  = 0.010f;
static constexpr float DECAY_CURIOSITY_ROUTINE = 0.005f;
static constexpr float DECAY_COSMIC     = 0.002f;
static constexpr float RECOVERY_SECURITY = 0.005f;

// --- Pathological state tracking (game-time seconds) ---
static uint32_t s_miska_low_start   = 0; // timestamp when miska went below 20
static uint32_t s_security_low_start = 0;
static uint32_t s_velin_start       = 0;
static uint32_t s_rena_start        = 0;
static uint32_t s_nashi_ignored_start = 0; // when nashi started being ignored

// Game-time accumulator for pathological checks
static uint32_t s_game_time_seconds = 0;

// Routine detection: track last N action types
static constexpr uint8_t ROUTINE_HISTORY = 10;
static uint8_t s_action_history[ROUTINE_HISTORY] = {0};
static uint8_t s_action_index = 0;
static bool s_is_stimulated = false; // set by play/talk, cleared by decay

void init() {
    s_miska_low_start = 0;
    s_security_low_start = 0;
    s_velin_start = 0;
    s_rena_start = 0;
    s_nashi_ignored_start = 0;
    s_game_time_seconds = 0;
    memset(s_action_history, 0, sizeof(s_action_history));
    s_action_index = 0;
    s_is_stimulated = false;
}

// Helper: check if recent actions are repetitive
static bool isRoutine() {
    if (s_game_time_seconds < ROUTINE_HISTORY) return false;
    uint8_t first = s_action_history[0];
    uint8_t same_count = 0;
    for (uint8_t i = 0; i < ROUTINE_HISTORY; i++) {
        if (s_action_history[i] == first) same_count++;
    }
    return same_count >= 7; // 70% same action = routine
}

static void recordAction(uint8_t action_id) {
    s_action_history[s_action_index % ROUTINE_HISTORY] = action_id;
    s_action_index++;
}

// Helper: average of non-health needs
static float needsAvgExcludingHealth(const NeedsState& state) {
    float sum = 0;
    uint8_t count = 0;
    for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
        if ((NeedType)i == NeedType::HEALTH) continue;
        sum += state.values[i];
        count++;
    }
    return (count > 0) ? (sum / count) : 0.0f;
}

void decay(NeedsState& state, float time_multiplier) {
    s_game_time_seconds++;

    // Korá (hunger)
    state.add(NeedType::KORA, -DECAY_KORA * time_multiplier);

    // Mokó (rest) — faster decay if stimulated
    float moko_rate = s_is_stimulated ? DECAY_MOKO_STIM : DECAY_MOKO_DAY;
    state.add(NeedType::MOKO, -moko_rate * time_multiplier);
    s_is_stimulated = false; // reset each tick

    // Miská (hygiene)
    state.add(NeedType::MISKA, -DECAY_MISKA * time_multiplier);

    // Nashi (happiness) — crash rate if ignored > 2h
    float nashi_rate = DECAY_NASHI;
    if (state.get(NeedType::NASHI) < 30.0f) {
        if (s_nashi_ignored_start == 0) {
            s_nashi_ignored_start = s_game_time_seconds;
        } else if ((s_game_time_seconds - s_nashi_ignored_start) > 7200) {
            nashi_rate = DECAY_NASHI_CRASH;
        }
    } else {
        s_nashi_ignored_start = 0;
    }
    state.add(NeedType::NASHI, -nashi_rate * time_multiplier);

    // Health (derived) — average of others * 0.3 + own decay, recovers if others > 60
    float others_avg = needsAvgExcludingHealth(state);
    float health_target = others_avg * 0.3f;
    float current_health = state.get(NeedType::HEALTH);
    if (others_avg > 60.0f) {
        // Recover toward target
        float recovery = 0.01f * time_multiplier;
        if (current_health < health_target) {
            state.add(NeedType::HEALTH, recovery);
        }
    }
    state.add(NeedType::HEALTH, -DECAY_HEALTH * time_multiplier);

    // Cognition
    state.add(NeedType::COGNITION, -DECAY_COGNITION * time_multiplier);

    // Affection (bond)
    state.add(NeedType::AFFECTION, -DECAY_AFFECTION * time_multiplier);

    // Curiosity — extra decay if routine
    float curiosity_rate = DECAY_CURIOSITY;
    if (isRoutine()) {
        curiosity_rate += DECAY_CURIOSITY_ROUTINE;
    }
    state.add(NeedType::CURIOSITY, -curiosity_rate * time_multiplier);

    // Cosmic connection
    state.add(NeedType::COSMIC, -DECAY_COSMIC * time_multiplier);

    // Security — recovers slowly (no active decay, only drops from events)
    if (state.get(NeedType::SECURITY) < 100.0f) {
        state.add(NeedType::SECURITY, RECOVERY_SECURITY * time_multiplier);
    }

    // --- Pathological state tracking ---

    // Miská low timer (for zevol)
    if (state.get(NeedType::MISKA) < 20.0f) {
        if (s_miska_low_start == 0) s_miska_low_start = s_game_time_seconds;
    } else {
        s_miska_low_start = 0;
    }

    // Security low timer (for morak)
    if (state.get(NeedType::SECURITY) < 15.0f) {
        if (s_security_low_start == 0) s_security_low_start = s_game_time_seconds;
    } else {
        s_security_low_start = 0;
    }

    // Velin timer
    if (state.get(NeedType::NASHI) < 10.0f &&
        state.get(NeedType::AFFECTION) < 10.0f &&
        state.get(NeedType::COSMIC) < 10.0f) {
        if (s_velin_start == 0) s_velin_start = s_game_time_seconds;
    } else {
        s_velin_start = 0;
    }

    // Rena-thishi timer
    if (state.get(NeedType::COGNITION) < 5.0f &&
        state.get(NeedType::CURIOSITY) < 5.0f) {
        if (s_rena_start == 0) s_rena_start = s_game_time_seconds;
    } else {
        s_rena_start = 0;
    }
}

// --- Care actions ---

void feed(NeedsState& state) {
    state.add(NeedType::KORA, 30.0f);
    state.add(NeedType::NASHI, 5.0f);
    recordAction(1);
}

void sleep(NeedsState& state) {
    if (HAL::Light::isDark()) {
        state.add(NeedType::MOKO, 40.0f);
    }
    // No effect if not dark — pet cannot sleep in light
    recordAction(2);
}

void clean(NeedsState& state) {
    state.add(NeedType::MISKA, 35.0f);
    recordAction(3);
}

void play(NeedsState& state) {
    state.add(NeedType::NASHI, 20.0f);
    state.add(NeedType::CURIOSITY, 10.0f);
    state.add(NeedType::MOKO, -5.0f);
    s_is_stimulated = true;
    s_nashi_ignored_start = 0; // reset ignored timer
    recordAction(4);
}

void talk(NeedsState& state) {
    state.add(NeedType::COGNITION, 25.0f);
    state.add(NeedType::AFFECTION, 5.0f);
    state.add(NeedType::CURIOSITY, 5.0f);
    s_is_stimulated = true;
    recordAction(5);
}

void caress(NeedsState& state) {
    state.add(NeedType::AFFECTION, 15.0f);
    state.add(NeedType::NASHI, 10.0f);
    state.add(NeedType::SECURITY, 10.0f);
    recordAction(6);
}

void meditate(NeedsState& state) {
    // Only effective at stage 6+
    if ((uint8_t)Pet::getStage() >= 6) {
        state.add(NeedType::COSMIC, 20.0f);
        state.add(NeedType::AFFECTION, 5.0f);
    }
    recordAction(7);
}

// --- Pathological state checks ---

bool isZevol(const NeedsState& state) {
    // Disease: miská < 20 for > 24h game-time OR health < 15
    if (state.get(NeedType::HEALTH) < 15.0f) return true;
    if (s_miska_low_start > 0 &&
        (s_game_time_seconds - s_miska_low_start) > 86400) { // 24h in seconds
        return true;
    }
    return false;
}

bool isMorak(const NeedsState& state) {
    // Chronic fear: security < 15 for > 1h game-time
    if (s_security_low_start > 0 &&
        (s_game_time_seconds - s_security_low_start) > 3600) {
        return true;
    }
    return false;
}

bool isVelin(const NeedsState& state) {
    // Depression: nashi < 10 AND affection < 10 AND cosmic < 10 for > 48h
    if (s_velin_start > 0 &&
        (s_game_time_seconds - s_velin_start) > 172800) { // 48h
        return true;
    }
    return false;
}

bool isRenaThishi(const NeedsState& state) {
    // Home calling: cognition < 5 AND curiosity < 5 for > 72h
    if (s_rena_start > 0 &&
        (s_game_time_seconds - s_rena_start) > 259200) { // 72h
        return true;
    }
    return false;
}

float getOverallWellness(const NeedsState& state) {
    float sum = 0;
    for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
        sum += state.values[i];
    }
    return sum / (uint8_t)NeedType::COUNT;
}

} // namespace Needs
} // namespace Pet
