/**
 * screen_conversation.h — Chat/conversation screen
 *
 * Displays conversation history and text input for chatting with the pet.
 * Stub implementation for now.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "../../hal/touch.h"

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
