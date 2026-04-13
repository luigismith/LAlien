/**
 * status_bar.h -- Top status bar shown on all screens (except egg)
 * Displays pet name, stage icon, WiFi signal, time, and need indicator dots.
 * Tap to expand detailed needs overlay.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "lvgl.h"
#include "../../pet/needs.h"

namespace UI {
namespace StatusBar {

    /// Create the status bar on the given parent screen.
    void create(lv_obj_t* parent);

    /// Destroy and free resources.
    void destroy();

    /// Update displayed values (call at ~1-5Hz).
    void update(const char* pet_name, uint8_t stage,
                int32_t wifi_rssi, const char* time_str,
                const Pet::NeedsState& needs);

    /// Show or hide the status bar.
    void show();
    void hide();

    /// Toggle the expanded needs overlay.
    void toggleNeedsExpand();

    /// Returns true if the needs overlay is currently visible.
    bool isNeedsExpanded();

    /// Get the status bar height (for layout calculations).
    int16_t getHeight();

    /// Get the LVGL container object.
    lv_obj_t* getContainer();

} // namespace StatusBar
} // namespace UI
