/**
 * light.h — Ambient light + RGB sensor HAL (APDS-9660 on GIGA Display Shield)
 * Provides: ambient brightness for day/night cycle, RGB for mood influence
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {
namespace Light {

    struct LightReading {
        uint16_t ambient;   // 0-65535 lux (approximate)
        uint16_t r, g, b;   // RGB components (raw)
    };

    void init();
    void poll();

    LightReading getReading();

    /// Returns true if ambient light is below threshold (pet should sleep).
    bool isDark(uint16_t threshold = 50);

    /// Returns dominant color as hue (0-360) for environmental mood.
    uint16_t getDominantHue();

} // namespace Light
} // namespace HAL
