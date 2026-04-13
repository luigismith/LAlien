/**
 * ui_manager.cpp — Central UI manager implementation
 *
 * Initializes all screens, manages transitions, bridges HAL::Touch
 * to LVGL input device, and dispatches updates at ~30Hz.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "ui_manager.h"
#include "sprite_engine.h"
#include "speech_bubble.h"
#include "theme.h"
#include "../hal/display.h"
#include "../hal/touch.h"
#include "../hal/light.h"
#include "screens/screen_main.h"
#include "screens/screen_egg.h"
#include "screens/screen_conversation.h"
#include "screens/screen_diary.h"
#include "screens/screen_settings.h"
#include "screens/screen_graveyard.h"
#include "screens/screen_minigame.h"
#include "screens/screen_lexicon.h"
#include "lvgl.h"

// ---- State ----
static UI::Manager::Screen current_screen = UI::Manager::Screen::EGG;
static bool initialized = false;

// ---- LVGL touch input device ----
static lv_indev_t* touch_indev = nullptr;
static int16_t last_touch_x = 0;
static int16_t last_touch_y = 0;
static bool    touch_pressed = false;

/// LVGL input device read callback — bridges HAL::Touch to LVGL.
static void touch_read_cb(lv_indev_t* indev, lv_indev_data_t* data) {
    (void)indev;

    // Poll the HAL touch driver
    HAL::Touch::poll();

    if (HAL::Touch::hasEvent()) {
        HAL::TouchEvent evt = HAL::Touch::getEvent();
        last_touch_x = evt.x;
        last_touch_y = evt.y;

        if (evt.type == HAL::TouchEvent::PRESS ||
            evt.type == HAL::TouchEvent::DRAG ||
            evt.type == HAL::TouchEvent::LONG_PRESS) {
            touch_pressed = true;
        } else if (evt.type == HAL::TouchEvent::RELEASE) {
            touch_pressed = false;
        }
    }

    data->point.x = last_touch_x;
    data->point.y = last_touch_y;
    data->state = touch_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

// ---- Public API ----

namespace UI {
namespace Manager {

void init() {
    // 1. Initialize theme (applies LVGL styles globally)
    Theme::init();

    // 2. Initialize sprite engine (allocates render buffer in SDRAM)
    SpriteEngine::init();

    // 3. Initialize speech bubble (creates LVGL objects on active screen)
    SpeechBubble::init();

    // 4. Register LVGL touch input device
    touch_indev = lv_indev_create();
    lv_indev_set_type(touch_indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(touch_indev, touch_read_cb);

    // 5. Create all screens
    ScreenEgg::create();
    ScreenMain::create();
    ScreenConversation::create();
    ScreenDiary::create();
    ScreenSettings::create();
    ScreenGraveyard::create();
    ScreenMiniGame::create();
    ScreenLexicon::create();

    // 6. Show the egg screen by default
    current_screen = Screen::EGG;
    ScreenEgg::show();

    initialized = true;
    Serial.println("[UI] Manager initialized — all screens created, touch input registered");
}

void update() {
    if (!initialized) return;

    // Let LVGL process its timers, animations, and rendering
    lv_timer_handler();

    // Update the active screen
    switch (current_screen) {
        case Screen::MAIN:
            ScreenMain::update();
            break;
        case Screen::EGG:
            ScreenEgg::update();
            break;
        case Screen::CONVERSATION:
            ScreenConversation::update();
            break;
        case Screen::DIARY:
            ScreenDiary::update();
            break;
        case Screen::SETTINGS:
            ScreenSettings::update();
            break;
        case Screen::GRAVEYARD:
            ScreenGraveyard::update();
            break;
        case Screen::MINIGAME:
            ScreenMiniGame::update();
            break;
        case Screen::LEXICON:
            ScreenLexicon::update();
            break;
        default:
            break;
    }

    // Update speech bubble typewriter effect (active on any screen)
    SpeechBubble::update();
}

void handleTouch(const HAL::TouchEvent& event) {
    if (!initialized) return;

    // Dispatch to the current screen's touch handler
    switch (current_screen) {
        case Screen::MAIN:
            ScreenMain::handleTouch(event);
            break;
        case Screen::EGG:
            ScreenEgg::handleTouch(event);
            break;
        case Screen::CONVERSATION:
            ScreenConversation::handleTouch(event);
            break;
        case Screen::DIARY:
            ScreenDiary::handleTouch(event);
            break;
        case Screen::SETTINGS:
            ScreenSettings::handleTouch(event);
            break;
        case Screen::GRAVEYARD:
            ScreenGraveyard::handleTouch(event);
            break;
        case Screen::MINIGAME:
            ScreenMiniGame::handleTouch(event);
            break;
        case Screen::LEXICON:
            ScreenLexicon::handleTouch(event);
            break;
        default:
            break;
    }

    // If speech bubble is animating and user taps, skip the typewriter
    if (SpeechBubble::isAnimating() && event.type == HAL::TouchEvent::PRESS) {
        SpeechBubble::skipAnimation();
    }
}

void showScreen(Screen screen) {
    if (screen == current_screen) return;

    Screen prev = current_screen;
    current_screen = screen;

    Serial.print("[UI] Screen transition: ");
    Serial.print((int)prev);
    Serial.print(" -> ");
    Serial.println((int)screen);

    // Hide speech bubble on screen transitions
    SpeechBubble::hide();

    switch (screen) {
        case Screen::MAIN:
            ScreenMain::show();
            break;
        case Screen::EGG:
            ScreenEgg::show();
            break;
        case Screen::CONVERSATION:
            ScreenConversation::show();
            break;
        case Screen::DIARY:
            ScreenDiary::show();
            break;
        case Screen::SETTINGS:
            ScreenSettings::show();
            break;
        case Screen::GRAVEYARD:
            ScreenGraveyard::show();
            break;
        case Screen::MINIGAME:
            // show() is called by screen_main with the game type;
            // this handles the screen enum transition only
            break;
        case Screen::LEXICON:
            ScreenLexicon::show();
            break;
        default:
            Serial.println("[UI] Unknown screen requested");
            break;
    }
}

void showMainScreen() {
    showScreen(Screen::MAIN);
}

Screen getCurrentScreen() {
    return current_screen;
}

} // namespace Manager
} // namespace UI
