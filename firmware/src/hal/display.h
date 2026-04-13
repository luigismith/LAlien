/**
 * display.h — Display HAL for Arduino GIGA Display Shield (800x480 TFT)
 * Wraps Arduino_H7_Video + LVGL initialization
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {
namespace Display {

    static constexpr uint16_t WIDTH  = 800;
    static constexpr uint16_t HEIGHT = 480;

    /// Initialize display + LVGL driver. Call once in setup().
    void init();

    /// Get LVGL-ready framebuffer pointer (in SDRAM).
    uint16_t* getFramebuffer();

    /// Set backlight brightness (0-255). 0 = off.
    void setBacklight(uint8_t brightness);

    /// Returns true if display hardware initialized successfully.
    bool isReady();

} // namespace Display
} // namespace HAL
