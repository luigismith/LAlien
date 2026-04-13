/**
 * screen_lexicon.h — Lalien Lexicon screen
 *
 * Scrollable list of all alien words the creature has learned.
 * Shows word, meaning in current locale, stage learned, frequency.
 * Tap a word for detail view with phonetic hint.
 * Filter by category or stage.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

namespace UI {
namespace ScreenLexicon {

    void create();
    void show();
    void hide();
    void update();
    void handleTouch(const HAL::TouchEvent& event);

    lv_obj_t* getScreen();

} // namespace ScreenLexicon
} // namespace UI
