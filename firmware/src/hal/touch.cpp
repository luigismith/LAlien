/**
 * touch.cpp — Capacitive touch HAL implementation
 * Uses Arduino_GigaDisplayTouch
 * Author: Claude Code | Date: 2026-04-13
 */
#include "touch.h"
#include "Arduino_GigaDisplayTouch.h"

static Arduino_GigaDisplayTouch touchDetector;
static HAL::TouchEvent current_event;
static bool event_pending = false;

// Touch state tracking
static bool was_touching = false;
static uint32_t touch_start_ms = 0;
static int16_t touch_start_x = 0;
static int16_t touch_start_y = 0;
static bool long_press_fired = false;

namespace HAL {
namespace Touch {

void init() {
    if (touchDetector.begin()) {
        Serial.println("[TOUCH] OK — capacitive touch ready");
    } else {
        Serial.println("[TOUCH] FAIL — touch init failed");
    }
}

void poll() {
    uint8_t contacts = 0;
    GDTpoint_t points[5];
    contacts = touchDetector.getTouchPoints(points);

    uint32_t now = millis();

    if (contacts > 0) {
        int16_t x = points[0].x;
        int16_t y = points[0].y;

        if (!was_touching) {
            // New press
            was_touching = true;
            touch_start_ms = now;
            touch_start_x = x;
            touch_start_y = y;
            long_press_fired = false;

            current_event = { TouchEvent::PRESS, x, y, 0 };
            event_pending = true;
        } else {
            // Continued touch — check for long press
            uint32_t dur = now - touch_start_ms;
            if (!long_press_fired && dur >= LONG_PRESS_MS) {
                long_press_fired = true;
                current_event = { TouchEvent::LONG_PRESS, x, y, dur };
                event_pending = true;
            }
            // Check for drag (>10px movement)
            int16_t dx = x - touch_start_x;
            int16_t dy = y - touch_start_y;
            if (dx * dx + dy * dy > 100) {
                current_event = { TouchEvent::DRAG, x, y, dur };
                event_pending = true;
            }
        }
    } else {
        if (was_touching) {
            // Release
            uint32_t dur = now - touch_start_ms;
            current_event = { TouchEvent::RELEASE, touch_start_x, touch_start_y, dur };
            event_pending = true;
            was_touching = false;
        }
    }
}

bool hasEvent() {
    return event_pending;
}

TouchEvent getEvent() {
    event_pending = false;
    return current_event;
}

} // namespace Touch
} // namespace HAL
