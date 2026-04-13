/**
 * imu.cpp — IMU HAL implementation using Arduino_LSM6DSOX
 * Author: Claude Code | Date: 2026-04-13
 */
#include "imu.h"
#include <Arduino_LSM6DSOX.h>

static HAL::IMUEvent current_event;
static float ax = 0, ay = 0, az = 0;
static float gx = 0, gy = 0, gz = 0;

// Smoothing: track recent magnitudes for shake detection
static constexpr int HISTORY_LEN = 8;
static float accel_mag_history[HISTORY_LEN] = {};
static int history_idx = 0;

namespace HAL {
namespace IMU {

void init() {
    if (::IMU.begin()) {
        Serial.println("[IMU] OK — LSM6DSOX ready");
    } else {
        Serial.println("[IMU] FAIL — LSM6DSOX init failed");
    }
}

void poll() {
    current_event.type = IMUEventType::NONE;

    if (::IMU.accelerationAvailable()) {
        ::IMU.readAcceleration(ax, ay, az);
    }
    if (::IMU.gyroscopeAvailable()) {
        ::IMU.readGyroscope(gx, gy, gz);
    }

    float accel_mag = sqrtf(ax * ax + ay * ay + az * az);
    float gyro_mag = sqrtf(gx * gx + gy * gy + gz * gz);

    // Store history for shake detection
    accel_mag_history[history_idx] = accel_mag;
    history_idx = (history_idx + 1) % HISTORY_LEN;

    // Impact: single high spike
    if (accel_mag > IMPACT_THRESHOLD_G) {
        current_event = { IMUEventType::IMPACT, accel_mag };
        return;
    }

    // Shake: sustained high acceleration (check variance in history)
    float sum = 0, sum_sq = 0;
    for (int i = 0; i < HISTORY_LEN; i++) {
        sum += accel_mag_history[i];
        sum_sq += accel_mag_history[i] * accel_mag_history[i];
    }
    float mean = sum / HISTORY_LEN;
    float variance = (sum_sq / HISTORY_LEN) - (mean * mean);
    if (variance > 0.5f && mean > SHAKE_THRESHOLD_G) {
        current_event = { IMUEventType::SHAKE, mean };
        return;
    }

    // Gentle tilt: moderate gyro, low accel
    if (gyro_mag > TILT_THRESHOLD_DPS && accel_mag < SHAKE_THRESHOLD_G) {
        current_event = { IMUEventType::GENTLE_TILT, gyro_mag };
    }
}

IMUEvent getEvent() {
    return current_event;
}

float getAccelX() { return ax; }
float getAccelY() { return ay; }
float getAccelZ() { return az; }
float getGyroX() { return gx; }
float getGyroY() { return gy; }
float getGyroZ() { return gz; }

} // namespace IMU
} // namespace HAL
