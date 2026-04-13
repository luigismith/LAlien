/**
 * touch.h — Capacitive touchscreen HAL for GIGA Display Shield
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {

struct TouchEvent {
    enum Type { NONE, PRESS, RELEASE, DRAG, LONG_PRESS };
    Type type = NONE;
    int16_t x = 0;
    int16_t y = 0;
    uint32_t duration_ms = 0; // for long press detection
};

namespace Touch {

    /// Initialize touch controller. Call once in setup().
    void init();

    /// Poll touch state. Call at ~60 Hz.
    void poll();

    /// Returns true if a new event is available.
    bool hasEvent();

    /// Consume and return the current event.
    TouchEvent getEvent();

    /// Long press threshold in ms.
    static constexpr uint32_t LONG_PRESS_MS = 1500;

} // namespace Touch
} // namespace HAL
