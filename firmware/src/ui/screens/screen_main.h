/**
 * screen_main.h — Main pet view screen
 *
 * Displays the pet sprite centered with toolbar on right side.
 * Background varies with day/night ambient light.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

namespace UI {
namespace ScreenMain {

    /// Create all LVGL objects for the main screen.
    void create();

    /// Show this screen (load it as active).
    void show();

    /// Hide this screen.
    void hide();

    /// Called at ~30Hz to update animations, day/night, etc.
    void update();

    /// Handle touch events.
    void handleTouch(const HAL::TouchEvent& event);

    /// Set the current evolution stage (affects which toolbar buttons appear).
    void setStage(uint8_t stage);

    /// Get the toolbar container (for external layout queries).
    lv_obj_t* getToolbar();

    /// Get the LVGL screen object.
    lv_obj_t* getScreen();

} // namespace ScreenMain
} // namespace UI
