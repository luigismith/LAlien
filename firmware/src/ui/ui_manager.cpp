/**
 * ui_manager.cpp — UI manager stub
 * Author: Claude Code | Date: 2026-04-13
 */
#include "ui_manager.h"
#include "lvgl.h"

static UI::Manager::Screen current_screen = UI::Manager::Screen::EGG;

namespace UI {
namespace Manager {

void init() {
    // LVGL objects, styles, screens created here
    Serial.println("[UI] Manager initialized");
}

void update() {
    lv_timer_handler(); // LVGL tick
}

void handleTouch(const HAL::TouchEvent& event) {
    // Dispatch to current screen's touch handler
    (void)event;
}

void showScreen(Screen screen) {
    current_screen = screen;
    // Load appropriate LVGL screen
}

void showMainScreen() {
    showScreen(Screen::MAIN);
}

Screen getCurrentScreen() {
    return current_screen;
}

} // namespace Manager
} // namespace UI
