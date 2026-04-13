/**
 * screen_diary.h — Diary list screen
 *
 * Shows a scrollable list of diary entries written by the pet.
 * Stub implementation for now.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

namespace UI {
namespace ScreenDiary {

    void create();
    void show();
    void hide();
    void update();
    void handleTouch(const HAL::TouchEvent& event);

    lv_obj_t* getScreen();

} // namespace ScreenDiary
} // namespace UI
