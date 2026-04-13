/**
 * screen_minigame.h -- Mini-game screen (LVGL rendering)
 *
 * Renders all three Lalien bonding rituals:
 *   - Thishi-Revosh (Echo Memory)
 *   - Miska-Vythi (Light Cleansing)
 *   - Selath-Nashi (Star Joy)
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"
#include "../../pet/minigames.h"

namespace UI {
namespace ScreenMiniGame {

    /// Create all LVGL objects (pre-allocated, hidden until show).
    void create();

    /// Show the screen and start the specified game.
    void show(Pet::MiniGames::GameType type);

    /// Hide the screen, clean up game state.
    void hide();

    /// Called at ~30Hz to update animations and game visuals.
    void update();

    /// Handle touch events.
    void handleTouch(const HAL::TouchEvent& event);

    /// Get the LVGL screen object.
    lv_obj_t* getScreen();

} // namespace ScreenMiniGame
} // namespace UI
