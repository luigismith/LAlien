/**
 * screen_main.cpp — Main pet view screen implementation
 *
 * Pet sprite (256x256) centered, background panel varies with day/night,
 * toolbar on the right side with 8 icon buttons.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_main.h"
#include "screen_minigame.h"
#include "../sprite_engine.h"
#include "../theme.h"
#include "../speech_bubble.h"
#include "../ui_manager.h"
#include "../../hal/light.h"
#include "../../hal/audio.h"
#include "../../pet/minigames.h"
#include "lvgl.h"

// ---- Layout ----
static constexpr int16_t TOOLBAR_WIDTH   = 64;
static constexpr int16_t TOOLBAR_X       = 800 - TOOLBAR_WIDTH; // 736
static constexpr int16_t BTN_SIZE        = 48;
static constexpr int16_t BTN_PAD         = 6;
static constexpr uint8_t TOOLBAR_BTN_COUNT = 8;

// ---- Button definitions ----
struct ToolbarButton {
    const char* icon;       // UTF-8 emoji or symbol
    const char* label;      // tooltip text
    uint8_t min_stage;      // minimum stage to show (0 = always)
};

static const ToolbarButton toolbar_btns[TOOLBAR_BTN_COUNT] = {
    { LV_SYMBOL_HOME,     "Feed",     0 },  // Feed
    { LV_SYMBOL_PAUSE,    "Sleep",    0 },  // Sleep
    { LV_SYMBOL_REFRESH,  "Clean",    0 },  // Clean
    { LV_SYMBOL_PLAY,     "Play",     0 },  // Play
    { LV_SYMBOL_ENVELOPE, "Chat",     0 },  // Chat
    { LV_SYMBOL_FILE,     "Diary",    0 },  // Diary
    { LV_SYMBOL_SETTINGS, "Settings", 0 },  // Settings
    { LV_SYMBOL_EYE_OPEN, "Meditate", 6 },  // Meditate (stage 6+)
};

// ---- LVGL objects ----
static lv_obj_t* screen         = nullptr;
static lv_obj_t* bg_panel       = nullptr;
static lv_obj_t* toolbar        = nullptr;
static lv_obj_t* btn_objs[TOOLBAR_BTN_COUNT] = {nullptr};

static uint8_t current_stage = 0;
static bool    is_night      = false;

// Night/day background colors
static lv_color_t day_bg   = lv_color_make(0, 0, 0);       // black
static lv_color_t night_bg = lv_color_make(2, 5, 15);      // very dark blue

// ---- Game selection popup ----
static lv_obj_t* game_popup      = nullptr;
static lv_obj_t* game_popup_bg   = nullptr; // dimming overlay
static bool game_popup_visible   = false;

static void close_game_popup() {
    if (game_popup) lv_obj_add_flag(game_popup, LV_OBJ_FLAG_HIDDEN);
    if (game_popup_bg) lv_obj_add_flag(game_popup_bg, LV_OBJ_FLAG_HIDDEN);
    game_popup_visible = false;
}

static void game_popup_bg_cb(lv_event_t* e) {
    (void)e;
    close_game_popup();
}

static void game_btn_echo_cb(lv_event_t* e) {
    (void)e;
    close_game_popup();
    UI::Manager::showScreen(UI::Manager::Screen::MINIGAME);
    UI::ScreenMiniGame::show(Pet::MiniGames::GameType::ECHO_MEMORY);
}

static void game_btn_clean_cb(lv_event_t* e) {
    (void)e;
    close_game_popup();
    UI::Manager::showScreen(UI::Manager::Screen::MINIGAME);
    UI::ScreenMiniGame::show(Pet::MiniGames::GameType::LIGHT_CLEANSING);
}

static void game_btn_star_cb(lv_event_t* e) {
    (void)e;
    close_game_popup();
    UI::Manager::showScreen(UI::Manager::Screen::MINIGAME);
    UI::ScreenMiniGame::show(Pet::MiniGames::GameType::STAR_JOY);
}

static void show_game_popup() {
    if (!game_popup) return;
    lv_obj_remove_flag(game_popup_bg, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(game_popup, LV_OBJ_FLAG_HIDDEN);
    game_popup_visible = true;
}

static void create_game_popup(lv_obj_t* parent) {
    // Semi-transparent overlay
    game_popup_bg = lv_obj_create(parent);
    lv_obj_remove_style_all(game_popup_bg);
    lv_obj_set_size(game_popup_bg, 800, 480);
    lv_obj_set_pos(game_popup_bg, 0, 0);
    lv_obj_set_style_bg_color(game_popup_bg, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(game_popup_bg, LV_OPA_50, LV_PART_MAIN);
    lv_obj_add_flag(game_popup_bg, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(game_popup_bg, game_popup_bg_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_add_flag(game_popup_bg, LV_OBJ_FLAG_HIDDEN);

    // Popup card
    game_popup = lv_obj_create(parent);
    lv_obj_set_size(game_popup, 380, 300);
    lv_obj_center(game_popup);
    lv_obj_set_style_bg_color(game_popup, lv_color_make(8, 16, 28), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(game_popup, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_color(game_popup, lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_border_width(game_popup, 2, LV_PART_MAIN);
    lv_obj_set_style_border_opa(game_popup, LV_OPA_60, LV_PART_MAIN);
    lv_obj_set_style_radius(game_popup, 16, LV_PART_MAIN);
    lv_obj_set_style_pad_all(game_popup, 16, LV_PART_MAIN);
    lv_obj_set_style_pad_row(game_popup, 12, LV_PART_MAIN);
    lv_obj_set_flex_flow(game_popup, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(game_popup, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_remove_flag(game_popup, LV_OBJ_FLAG_SCROLLABLE);

    // Title
    lv_obj_t* popup_title = lv_label_create(game_popup);
    lv_label_set_text(popup_title, "Rituali di legame");
    lv_obj_set_style_text_color(popup_title,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(popup_title,
        &lv_font_montserrat_18, LV_PART_MAIN);

    // Game buttons: name + subtitle
    struct GameEntry {
        const char* name;
        const char* subtitle;
        lv_event_cb_t cb;
    };
    static const GameEntry entries[3] = {
        { "Thish\xc3\xad-R\xc3\xa8vosh",   "Eco della Memoria",    game_btn_echo_cb  },
        { "Misk\xc3\xa1-V\xc3\xbfthi",      "Pulizia di Luce",     game_btn_clean_cb },
        { "S\xc3\xa8lath-Nashi",             "Gioia delle Stelle",  game_btn_star_cb  },
    };

    for (uint8_t i = 0; i < 3; i++) {
        lv_obj_t* btn = lv_button_create(game_popup);
        lv_obj_set_size(btn, 340, 60);
        lv_obj_set_style_bg_color(btn, lv_color_make(12, 30, 50), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_border_color(btn,
            lv_color_make(62, 207, 207), LV_PART_MAIN);
        lv_obj_set_style_border_width(btn, 1, LV_PART_MAIN);
        lv_obj_set_style_border_opa(btn, LV_OPA_40, LV_PART_MAIN);
        lv_obj_set_style_radius(btn, 10, LV_PART_MAIN);
        lv_obj_set_style_bg_color(btn,
            lv_color_make(212, 165, 52), LV_STATE_PRESSED);
        lv_obj_set_style_bg_opa(btn, LV_OPA_70, LV_STATE_PRESSED);
        lv_obj_set_flex_flow(btn, LV_FLEX_FLOW_COLUMN);
        lv_obj_set_flex_align(btn, LV_FLEX_ALIGN_CENTER,
                              LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

        lv_obj_t* name_lbl = lv_label_create(btn);
        lv_label_set_text(name_lbl, entries[i].name);
        lv_obj_set_style_text_color(name_lbl,
            lv_color_make(240, 230, 211), LV_PART_MAIN);
        lv_obj_set_style_text_font(name_lbl,
            &lv_font_montserrat_16, LV_PART_MAIN);

        lv_obj_t* sub_lbl = lv_label_create(btn);
        lv_label_set_text(sub_lbl, entries[i].subtitle);
        lv_obj_set_style_text_color(sub_lbl,
            lv_color_make(140, 140, 160), LV_PART_MAIN);
        lv_obj_set_style_text_font(sub_lbl,
            &lv_font_montserrat_12, LV_PART_MAIN);

        lv_obj_add_event_cb(btn, entries[i].cb, LV_EVENT_CLICKED, nullptr);
    }

    lv_obj_add_flag(game_popup, LV_OBJ_FLAG_HIDDEN);
}

// Toolbar button event callback
static void toolbar_btn_cb(lv_event_t* e) {
    lv_obj_t* btn = (lv_obj_t*)lv_event_get_target(e);
    // Find which button index
    for (uint8_t i = 0; i < TOOLBAR_BTN_COUNT; i++) {
        if (btn_objs[i] == btn) {
            Serial.print("[MAIN] Toolbar button pressed: ");
            Serial.println(toolbar_btns[i].label);

            // Play a short feedback blip
            if (HAL::Audio::isAvailable()) {
                HAL::Audio::playBlip();
            }

            // Dispatch actions
            switch (i) {
                case 0: // Feed
                    UI::SpriteEngine::setAnimation("eat");
                    break;
                case 1: // Sleep
                    UI::SpriteEngine::setAnimation("sleep");
                    break;
                case 2: // Clean
                    UI::SpriteEngine::setAnimation("happy");
                    break;
                case 3: // Play -- show game selection popup
                    show_game_popup();
                    break;
                case 4: // Chat — will be handled by UI manager
                    break;
                case 5: // Diary
                    break;
                case 6: // Settings
                    break;
                case 7: // Meditate
                    UI::SpriteEngine::setAnimation("sing");
                    break;
            }
            break;
        }
    }
}

// Pet tap callback (tap the main area)
static void pet_area_cb(lv_event_t* e) {
    (void)e;
    Serial.println("[MAIN] Pet area tapped");
    // Default: show happy animation briefly
    UI::SpriteEngine::setAnimation("happy");
}

namespace UI {
namespace ScreenMain {

void create() {
    screen = lv_obj_create(nullptr); // new screen (not parented to active)
    lv_obj_set_size(screen, 800, 480);
    lv_obj_set_style_bg_color(screen, day_bg, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // --- Background panel (fills area left of toolbar) ---
    bg_panel = lv_obj_create(screen);
    lv_obj_remove_style_all(bg_panel);
    lv_obj_set_size(bg_panel, 800 - TOOLBAR_WIDTH, 480);
    lv_obj_set_pos(bg_panel, 0, 0);
    lv_obj_set_style_bg_color(bg_panel, day_bg, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(bg_panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(bg_panel, LV_OBJ_FLAG_SCROLLABLE);
    // Make the main area tappable
    lv_obj_add_flag(bg_panel, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(bg_panel, pet_area_cb, LV_EVENT_CLICKED, nullptr);

    // --- Toolbar on the right ---
    toolbar = lv_obj_create(screen);
    lv_obj_remove_style_all(toolbar);
    lv_obj_set_size(toolbar, TOOLBAR_WIDTH, 480);
    lv_obj_set_pos(toolbar, TOOLBAR_X, 0);
    lv_obj_set_style_bg_color(toolbar, lv_color_make(5, 12, 20), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(toolbar, LV_OPA_90, LV_PART_MAIN);
    lv_obj_set_style_border_color(toolbar,
        lv_color_make(212, 165, 52), LV_PART_MAIN); // gold
    lv_obj_set_style_border_width(toolbar, 1, LV_PART_MAIN);
    lv_obj_set_style_border_opa(toolbar, LV_OPA_30, LV_PART_MAIN);
    lv_obj_set_style_border_side(toolbar, LV_BORDER_SIDE_LEFT, LV_PART_MAIN);
    lv_obj_set_style_pad_all(toolbar, BTN_PAD, LV_PART_MAIN);
    lv_obj_set_style_pad_row(toolbar, BTN_PAD, LV_PART_MAIN);
    lv_obj_set_flex_flow(toolbar, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(toolbar, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_remove_flag(toolbar, LV_OBJ_FLAG_SCROLLABLE);

    // --- Create toolbar buttons ---
    for (uint8_t i = 0; i < TOOLBAR_BTN_COUNT; i++) {
        lv_obj_t* btn = lv_button_create(toolbar);
        lv_obj_set_size(btn, BTN_SIZE, BTN_SIZE);
        lv_obj_set_style_bg_color(btn, lv_color_make(10, 25, 41), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_border_color(btn,
            lv_color_make(212, 165, 52), LV_PART_MAIN);
        lv_obj_set_style_border_width(btn, 1, LV_PART_MAIN);
        lv_obj_set_style_border_opa(btn, LV_OPA_60, LV_PART_MAIN);
        lv_obj_set_style_radius(btn, 10, LV_PART_MAIN);
        // Pressed style
        lv_obj_set_style_bg_color(btn, lv_color_make(212, 165, 52), LV_STATE_PRESSED);
        lv_obj_set_style_bg_opa(btn, LV_OPA_80, LV_STATE_PRESSED);

        // Icon label
        lv_obj_t* lbl = lv_label_create(btn);
        lv_label_set_text(lbl, toolbar_btns[i].icon);
        lv_obj_set_style_text_color(lbl,
            lv_color_make(240, 230, 211), LV_PART_MAIN);
        lv_obj_center(lbl);

        lv_obj_add_event_cb(btn, toolbar_btn_cb, LV_EVENT_CLICKED, nullptr);

        // Hide if stage requirement not met
        if (toolbar_btns[i].min_stage > current_stage) {
            lv_obj_add_flag(btn, LV_OBJ_FLAG_HIDDEN);
        }

        btn_objs[i] = btn;
    }

    // Game selection popup (must be last to overlay everything)
    create_game_popup(screen);

    Serial.println("[MAIN] Screen created");
}

void show() {
    if (screen) {
        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_FADE_IN, 300, 0, false);
    }
}

void hide() {
    // Screen hide is implicit when another screen is loaded
}

void update() {
    // Update day/night background based on ambient light
    bool dark = HAL::Light::isDark();
    if (dark != is_night) {
        is_night = dark;
        lv_color_t bg = dark ? night_bg : day_bg;
        if (bg_panel) {
            lv_obj_set_style_bg_color(bg_panel, bg, LV_PART_MAIN);
        }
        if (screen) {
            lv_obj_set_style_bg_color(screen, bg, LV_PART_MAIN);
        }
    }

    // Tick the sprite engine (advances animation frame + renders)
    UI::SpriteEngine::tick();
}

void handleTouch(const HAL::TouchEvent& event) {
    // LVGL handles button events via its own input device driver.
    // This is for additional gesture handling if needed.
    if (event.type == HAL::TouchEvent::LONG_PRESS) {
        // Long press on pet area: could trigger special interaction
        Serial.println("[MAIN] Long press detected");
    }
    (void)event;
}

void setStage(uint8_t stage) {
    current_stage = stage;
    // Show/hide stage-dependent buttons
    for (uint8_t i = 0; i < TOOLBAR_BTN_COUNT; i++) {
        if (btn_objs[i]) {
            if (toolbar_btns[i].min_stage > stage) {
                lv_obj_add_flag(btn_objs[i], LV_OBJ_FLAG_HIDDEN);
            } else {
                lv_obj_remove_flag(btn_objs[i], LV_OBJ_FLAG_HIDDEN);
            }
        }
    }
}

lv_obj_t* getToolbar() {
    return toolbar;
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenMain
} // namespace UI
