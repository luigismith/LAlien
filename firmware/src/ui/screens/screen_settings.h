/**
 * screen_settings.h — Settings menu screen
 *
 * System settings: volume, brightness, WiFi, language, reset.
 * Stub implementation for now.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

namespace UI {
namespace ScreenSettings {

    void create();
    void show();
    void hide();
    void update();
    void handleTouch(const HAL::TouchEvent& event);

    lv_obj_t* getScreen();

} // namespace ScreenSettings
} // namespace UI
