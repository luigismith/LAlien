/**
 * light.cpp — APDS-9660 ambient light sensor implementation
 * Author: Claude Code | Date: 2026-04-13
 */
#include "light.h"
#include <Arduino_APDS9960.h>

static HAL::Light::LightReading current_reading = {};
static bool initialized = false;

namespace HAL {
namespace Light {

void init() {
    if (APDS.begin()) {
        initialized = true;
        Serial.println("[LIGHT] OK — APDS-9960 ready");
    } else {
        Serial.println("[LIGHT] FAIL — APDS-9960 init failed");
    }
}

void poll() {
    if (!initialized) return;

    if (APDS.colorAvailable()) {
        int r, g, b, a;
        APDS.readColor(r, g, b, a);
        current_reading.ambient = (uint16_t)a;
        current_reading.r = (uint16_t)r;
        current_reading.g = (uint16_t)g;
        current_reading.b = (uint16_t)b;
    }
}

LightReading getReading() {
    return current_reading;
}

bool isDark(uint16_t threshold) {
    return current_reading.ambient < threshold;
}

uint16_t getDominantHue() {
    float r = current_reading.r;
    float g = current_reading.g;
    float b = current_reading.b;
    float max_c = max(r, max(g, b));
    float min_c = min(r, min(g, b));
    float delta = max_c - min_c;

    if (delta < 1.0f) return 0;

    float hue = 0;
    if (max_c == r) {
        hue = 60.0f * fmodf((g - b) / delta, 6.0f);
    } else if (max_c == g) {
        hue = 60.0f * ((b - r) / delta + 2.0f);
    } else {
        hue = 60.0f * ((r - g) / delta + 4.0f);
    }
    if (hue < 0) hue += 360.0f;
    return (uint16_t)hue;
}

} // namespace Light
} // namespace HAL
