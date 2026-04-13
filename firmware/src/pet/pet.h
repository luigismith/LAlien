/**
 * pet.h — Main pet state machine
 * Manages lifecycle: egg -> 8 stages -> death/transcendence
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../hal/imu.h"

namespace Pet {

    enum class Stage : uint8_t {
        SYRMA = 0,       // egg
        LALI_NA = 1,     // newborn (larva)
        LALI_SHI = 2,    // infant (pupa)
        LALI_KO = 3,     // child (juvenile)
        LALI_REN = 4,    // teen (adolescent)
        LALI_VOX = 5,    // adult
        LALI_MERE = 6,   // elder sage
        LALI_THISHI = 7, // transcendent
    };

    enum class DeathType : uint8_t {
        NONE,
        VELIN,           // despair / starvation / neglect
        ZEVOL,           // disease / sickness
        MORAK,           // trauma / heartbreak
        RENA_THISHI,     // home calling / loneliness / boredom
        OLD_AGE,         // natural
        TRANSCENDENCE,   // best ending
        FAREWELL,        // keeper chose to say goodbye
    };

    /// Initialize pet system. Loads from SD or creates egg state.
    void init();

    /// Main update (call at 1Hz). Decays needs, checks evolution/death.
    void update();

    /// Handle IMU event (shake, tilt, impact).
    void handleIMUEvent(const HAL::IMUEvent& event);

    /// Trigger keeper farewell (voluntary goodbye).
    void triggerFarewell();

    // --- Accessors ---
    Stage getStage();
    const char* getStageName();
    const char* getStageNameFor(Stage stage);
    DeathType getDeathType();
    bool isAlive();
    bool isEgg();
    bool isTranscended();
    uint32_t getAgeHours();
    uint32_t getAgeDays();
    const char* getName();
    uint8_t getDNAVariantIndex(); // for sprite selection

    /// Get total interaction count (voice + touch + play).
    uint32_t getTotalInteractions();

    /// Get conversation count (for evolution checks).
    uint16_t getConversationCount();

    /// Increment conversation count (called by AI layer after a conversation).
    void addConversation();

    /// Get last words (set during death sequence, stored for graveyard).
    const char* getLastWords();

    /// Set last words (called by LLM response handler during death).
    void setLastWords(const char* words);

    /// Apply mini-game results to pet needs, vocabulary, and evolution.
    /// Called by screen_minigame after endGame(). This is the bridge
    /// between bonding rituals and actual creature growth.
    void applyGameResult();

} // namespace Pet
