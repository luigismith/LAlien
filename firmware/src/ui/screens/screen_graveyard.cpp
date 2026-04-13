/**
 * screen_graveyard.cpp — Graveyard browser screen (stub)
 *
 * Will display memorial entries for past pets in a scrollable grid.
 * Placeholder for now.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_graveyard.h"
#include "../theme.h"
#include "lvgl.h"

static lv_obj_t* screen      = nullptr;
static lv_obj_t* title_label = nullptr;
static lv_obj_t* back_btn    = nullptr;

static void back_btn_cb(lv_event_t* e) {
    (void)e;
    Serial.println("[GRAVEYARD] Back pressed");
}

namespace UI {
namespace ScreenGraveyard {

void create() {
    screen = lv_obj_create(nullptr);
    lv_obj_set_size(screen, 800, 480);
    lv_obj_set_style_bg_color(screen, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // Title
    title_label = lv_label_create(screen);
    lv_label_set_text(title_label, "Cimitero dei Ricordi");
    lv_obj_set_style_text_color(title_label,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(title_label,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_align(title_label, LV_ALIGN_TOP_MID, 0, 16);

    // Back button
    back_btn = lv_button_create(screen);
    lv_obj_set_size(back_btn, 60, 36);
    lv_obj_align(back_btn, LV_ALIGN_TOP_LEFT, 10, 10);
    lv_obj_add_event_cb(back_btn, back_btn_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* back_lbl = lv_label_create(back_btn);
    lv_label_set_text(back_lbl, LV_SYMBOL_LEFT);
    lv_obj_center(back_lbl);

    // Placeholder
    lv_obj_t* placeholder = lv_label_create(screen);
    lv_label_set_text(placeholder, "Nessun ricordo ancora...\n(in sviluppo)");
    lv_obj_set_style_text_color(placeholder,
        lv_color_make(156, 211, 200), LV_PART_MAIN);
    lv_obj_set_style_text_font(placeholder,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(placeholder, LV_ALIGN_CENTER, 0, 0);

    Serial.println("[GRAVEYARD] Screen created (stub)");
}

void show() {
    if (screen) {
        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
    }
}

void hide() {}

void update() {}

void handleTouch(const HAL::TouchEvent& event) {
    (void)event;
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenGraveyard
} // namespace UI
