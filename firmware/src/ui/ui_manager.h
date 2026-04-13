/**
 * ui_manager.h — Central UI manager, screen transitions, LVGL tick
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../hal/touch.h"

namespace UI {
namespace Manager {

    enum class Screen : uint8_t {
        MAIN,
        CONVERSATION,
        DIARY,
        GRAVEYARD,
        LEXICON,
        SETTINGS,
        CAPTIVE_PORTAL,
        EVOLUTION,
        DEATH,
        MEMORIAL,
        EGG,
        MINIGAME,
    };

    void init();
    void update(); // call at ~30Hz — LVGL tick + animations
    void handleTouch(const HAL::TouchEvent& event);
    void showScreen(Screen screen);
    void showMainScreen();
    Screen getCurrentScreen();

} // namespace Manager
} // namespace UI
