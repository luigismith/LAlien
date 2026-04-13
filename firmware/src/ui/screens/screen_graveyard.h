/**
 * screen_graveyard.h — Graveyard browser screen
 *
 * Browse memorial entries of past pets. Scrollable grid of tombstones.
 * Stub implementation for now.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

namespace UI {
namespace ScreenGraveyard {

    void create();
    void show();
    void hide();
    void update();
    void handleTouch(const HAL::TouchEvent& event);

    lv_obj_t* getScreen();

} // namespace ScreenGraveyard
} // namespace UI
