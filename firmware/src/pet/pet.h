/**
 * pet.h — Main pet state machine
 * Manages lifecycle: egg → 8 stages → death/transcendence
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../hal/imu.h"

namespace Pet {

    enum class Stage : uint8_t {
        SYRMA = 0,       // egg
        LALI_NA = 1,     // newborn
        LALI_SHI = 2,    // infant
        LALI_KO = 3,     // child
        LALI_REN = 4,    // teen
        LALI_VOX = 5,    // adult
        LALI_MERE = 6,   // elder sage
        LALI_THISHI = 7, // transcendence
    };

    enum class DeathType : uint8_t {
        NONE,
        VELIN,           // despair
        ZEVOL,           // disease
        MORAK,           // trauma
        RENA_THISHI,     // home calling (escape)
        OLD_AGE,         // natural
        TRANSCENDENCE,   // best ending
        FAREWELL,        // keeper changed API key
    };

    /// Initialize pet system. Loads from SD or creates egg state.
    void init();

    /// Main update (call at 1Hz). Decays needs, checks evolution/death.
    void update();

    /// Handle IMU event (shake, tilt, impact).
    void handleIMUEvent(const HAL::IMUEvent& event);

    // --- Accessors ---
    Stage getStage();
    const char* getStageName();
    DeathType getDeathType();
    bool isAlive();
    bool isEgg();
    uint32_t getAgeHours();
    const char* getName();
    uint8_t getDNAVariantIndex(); // for sprite selection

} // namespace Pet
