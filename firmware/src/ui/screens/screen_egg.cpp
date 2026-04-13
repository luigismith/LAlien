/**
 * screen_egg.cpp — Egg waiting screen implementation
 *
 * Pulsating egg sprite centered with Italian flavor text below.
 * A gentle scale animation makes the egg "breathe."
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_egg.h"
#include "../sprite_engine.h"
#include "../theme.h"
#include "lvgl.h"

// ---- LVGL objects ----
static lv_obj_t* screen       = nullptr;
static lv_obj_t* egg_label    = nullptr;
static lv_obj_t* subtitle_lbl = nullptr;

// Pulsation state
static uint32_t pulse_timer  = 0;
static bool     pulse_grow   = true;
static uint8_t  pulse_phase  = 0;

// Subtitle text
static const char* EGG_TEXT = "Un seme di lingua pulsa nell'oscurita...";

namespace UI {
namespace ScreenEgg {

void create() {
    screen = lv_obj_create(nullptr);
    lv_obj_set_size(screen, 800, 480);
    lv_obj_set_style_bg_color(screen, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // Egg sprite will be rendered by the sprite engine at center.
    // We just create the text label below.

    // Subtitle label
    subtitle_lbl = lv_label_create(screen);
    lv_label_set_text(subtitle_lbl, EGG_TEXT);
    lv_obj_set_style_text_color(subtitle_lbl,
        lv_color_make(212, 165, 52), LV_PART_MAIN); // gold
    lv_obj_set_style_text_font(subtitle_lbl,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_set_style_text_opa(subtitle_lbl, LV_OPA_80, LV_PART_MAIN);
    lv_obj_align(subtitle_lbl, LV_ALIGN_BOTTOM_MID, 0, -60);

    // Decorative dots or ellipsis label for visual pulsation feedback
    egg_label = lv_label_create(screen);
    lv_label_set_text(egg_label, ".");
    lv_obj_set_style_text_color(egg_label,
        lv_color_make(240, 230, 211), LV_PART_MAIN);
    lv_obj_set_style_text_font(egg_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(egg_label, LV_ALIGN_BOTTOM_MID, 0, -35);

    Serial.println("[EGG] Screen created");
}

void show() {
    if (screen) {
        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_FADE_IN, 500, 0, false);
    }
    pulse_timer = millis();
    pulse_phase = 0;
}

void hide() {
    // Implicit when another screen loads
}

void update() {
    uint32_t now = millis();

    // Pulsating dots animation (every 800ms cycle through ., .., ...)
    if (now - pulse_timer > 800) {
        pulse_timer = now;
        pulse_phase = (pulse_phase + 1) % 4;
        if (egg_label) {
            const char* dots[] = { ".", "..", "...", ".." };
            lv_label_set_text(egg_label, dots[pulse_phase]);
        }
    }

    // Pulsate subtitle opacity
    if (subtitle_lbl) {
        // Sine-ish opacity: oscillate between 50% and 100%
        uint8_t phase_val = (uint8_t)((now / 20) % 256);
        // Simple triangle wave
        int16_t tri = (phase_val < 128) ? phase_val : (255 - phase_val);
        lv_opa_t opa = (lv_opa_t)(LV_OPA_50 + (tri * (LV_OPA_COVER - LV_OPA_50)) / 128);
        lv_obj_set_style_text_opa(subtitle_lbl, opa, LV_PART_MAIN);
    }
}

void handleTouch(const HAL::TouchEvent& event) {
    // Tapping the egg could speed up hatching — handled by game logic
    if (event.type == HAL::TouchEvent::PRESS) {
        Serial.println("[EGG] Egg tapped");
    }
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenEgg
} // namespace UI
