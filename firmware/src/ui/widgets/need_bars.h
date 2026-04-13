/**
 * need_bars.h -- Detailed needs display overlay with 10 horizontal bars
 * Color gradient: green (>70%) -> yellow (30-70%) -> red (<30%)
 * Animated fill transitions when values change.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "lvgl.h"
#include "../../pet/needs.h"

namespace UI {
namespace NeedBars {

    /// Create the needs overlay on the given parent.
    void create(lv_obj_t* parent);

    /// Destroy and free resources.
    void destroy();

    /// Update all bar values with animation.
    void update(const Pet::NeedsState& needs);

    /// Show the overlay with fade-in animation.
    void show();

    /// Hide the overlay with fade-out animation.
    void hide();

    /// Returns true if currently visible.
    bool isVisible();

    /// Get the LVGL container object.
    lv_obj_t* getContainer();

} // namespace NeedBars
} // namespace UI
