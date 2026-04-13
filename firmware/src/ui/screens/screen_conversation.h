/**
 * screen_conversation.h -- Chat/conversation screen with push-to-talk
 *
 * Full conversation UI with message history, text input, virtual keyboard,
 * and push-to-talk microphone button with STT integration.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

// Forward declare for LVGL
struct _lv_obj_t;
typedef _lv_obj_t lv_obj_t;

namespace UI {
namespace ScreenConversation {

    void create();
    void show();
    void hide();
    void update();
    void handleTouch(const HAL::TouchEvent& event);

    lv_obj_t* getScreen();

} // namespace ScreenConversation
} // namespace UI
