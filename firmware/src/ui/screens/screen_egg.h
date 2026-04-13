/**
 * screen_egg.h — Egg waiting screen
 *
 * Pulsating egg sprite centered with Italian flavor text below.
 * Shown before the pet is born.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

namespace UI {
namespace ScreenEgg {

    void create();
    void show();
    void hide();
    void update();
    void handleTouch(const HAL::TouchEvent& event);

    lv_obj_t* getScreen();

} // namespace ScreenEgg
} // namespace UI
