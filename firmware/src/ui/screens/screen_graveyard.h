/**
 * screen_graveyard.h — Graveyard browser screen
 *
 * Browse memorial entries of past pets. Scrollable list of tombstones
 * with tap-to-view memorial detail. Transcended pets shown with
 * golden glow treatment.
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

    /// Refresh the graveyard list (call when returning to this screen).
    void refresh();

} // namespace ScreenGraveyard
} // namespace UI
