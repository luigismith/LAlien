/**
 * imu.h — IMU HAL for LSM6DSOX (6-axis accel+gyro) on GIGA Display Shield
 * Detects: shakes (play/disturb), gentle tilts (cradle), impacts (trauma)
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {

enum class IMUEventType : uint8_t {
    NONE,
    SHAKE,          // vigorous shaking → play or disturb
    GENTLE_TILT,    // slow rocking → cradle/soothe
    IMPACT,         // sudden hit → trauma
};

struct IMUEvent {
    IMUEventType type = IMUEventType::NONE;
    float magnitude = 0.0f; // g-force or deg/s depending on type
};

namespace IMU {

    void init();
    void poll();
    IMUEvent getEvent();

    // Raw access for DNA generation
    float getAccelX();
    float getAccelY();
    float getAccelZ();
    float getGyroX();
    float getGyroY();
    float getGyroZ();

    // Thresholds (configurable)
    static constexpr float SHAKE_THRESHOLD_G    = 2.0f;
    static constexpr float IMPACT_THRESHOLD_G   = 4.0f;
    static constexpr float TILT_THRESHOLD_DPS   = 30.0f;

} // namespace IMU
} // namespace HAL
