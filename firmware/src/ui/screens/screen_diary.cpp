/**
 * screen_diary.cpp --- Diary list and detail view
 * Shows a scrollable list of diary entries written by the pet.
 * Tapping an entry opens a detail view with full text.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_diary.h"
#include "../theme.h"
#include "../../persistence/diary.h"
#include "../../pet/pet.h"
#include "lvgl.h"

// ---------------------------------------------------------------------------
// View mode
// ---------------------------------------------------------------------------

enum class ViewMode : uint8_t {
    LIST,
    DETAIL
};

// ---------------------------------------------------------------------------
// Static UI state
// ---------------------------------------------------------------------------

static lv_obj_t* screen          = nullptr;
static lv_obj_t* title_label     = nullptr;
static lv_obj_t* back_btn        = nullptr;
static lv_obj_t* list_container  = nullptr;
static lv_obj_t* detail_panel    = nullptr;
static lv_obj_t* detail_text     = nullptr;
static lv_obj_t* detail_date     = nullptr;
static lv_obj_t* detail_back_btn = nullptr;
static lv_obj_t* empty_label     = nullptr;

static ViewMode s_view_mode = ViewMode::LIST;
static uint16_t s_selected_index = 0;

// Stage names for diary entries
static const char* stageName(uint8_t stage) {
    switch (stage) {
        case 0: return "Syrma";
        case 1: return "Lali-Na";
        case 2: return "Lali-Shi";
        case 3: return "Lali-Ko";
        case 4: return "Lali-Ren";
        case 5: return "Lali-Vox";
        case 6: return "Lali-Mere";
        case 7: return "Lali-Thishi";
        default: return "???";
    }
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

static void back_btn_cb(lv_event_t* e) {
    (void)e;
    Serial.println("[DIARY] Back pressed");
    // Navigation handled by UI manager
}

static void detail_back_cb(lv_event_t* e) {
    (void)e;
    // Switch back to list view
    if (detail_panel) lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);
    if (list_container) lv_obj_remove_flag(list_container, LV_OBJ_FLAG_HIDDEN);
    if (empty_label) {
        if (Persistence::Diary::getCount() == 0) {
            lv_obj_remove_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
        }
    }
    s_view_mode = ViewMode::LIST;
    Serial.println("[DIARY] Back to list");
}

static void entry_clicked_cb(lv_event_t* e) {
    uint32_t idx = (uint32_t)(uintptr_t)lv_event_get_user_data(e);

    Persistence::Diary::DiaryEntry entry;
    if (!Persistence::Diary::getEntry((uint16_t)idx, entry)) {
        Serial.println("[DIARY] Failed to load entry " + String(idx));
        return;
    }

    s_selected_index = (uint16_t)idx;

    // Populate detail view
    if (detail_date) {
        String date_str = "Day ";
        date_str += String(entry.timestamp / 86400);
        date_str += " - ";
        date_str += stageName(entry.stage);
        lv_label_set_text(detail_date, date_str.c_str());
    }

    if (detail_text) {
        lv_label_set_text(detail_text, entry.text);
    }

    // Show detail, hide list
    if (list_container) lv_obj_add_flag(list_container, LV_OBJ_FLAG_HIDDEN);
    if (empty_label) lv_obj_add_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
    if (detail_panel) lv_obj_remove_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);
    s_view_mode = ViewMode::DETAIL;
    Serial.println("[DIARY] Showing entry " + String(idx));
}

// ---------------------------------------------------------------------------
// Build the scrollable list of entries
// ---------------------------------------------------------------------------

static void rebuildList() {
    if (!list_container) return;

    // Clear existing children
    lv_obj_clean(list_container);

    uint16_t count = Persistence::Diary::getCount();

    if (count == 0) {
        if (empty_label) lv_obj_remove_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
        return;
    }

    if (empty_label) lv_obj_add_flag(empty_label, LV_OBJ_FLAG_HIDDEN);

    // Show entries in reverse chronological order (newest first)
    for (int i = (int)count - 1; i >= 0; i--) {
        Persistence::Diary::DiaryEntry entry;
        if (!Persistence::Diary::getEntry((uint16_t)i, entry)) continue;

        // Create entry row button
        lv_obj_t* row = lv_button_create(list_container);
        lv_obj_set_size(row, 760, 56);
        lv_obj_set_style_bg_color(row, lv_color_make(20, 20, 30), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(row, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(row, 8, LV_PART_MAIN);
        lv_obj_set_style_border_width(row, 1, LV_PART_MAIN);
        lv_obj_set_style_border_color(row, lv_color_make(60, 60, 80), LV_PART_MAIN);
        lv_obj_set_style_pad_all(row, 8, LV_PART_MAIN);

        // Stage indicator
        lv_obj_t* stage_lbl = lv_label_create(row);
        String stage_str = stageName(entry.stage);
        stage_str += " - Day ";
        stage_str += String(entry.timestamp / 86400);
        lv_label_set_text(stage_lbl, stage_str.c_str());
        lv_obj_set_style_text_color(stage_lbl, lv_color_make(212, 165, 52), LV_PART_MAIN);
        lv_obj_set_style_text_font(stage_lbl, &lv_font_montserrat_12, LV_PART_MAIN);
        lv_obj_align(stage_lbl, LV_ALIGN_TOP_LEFT, 0, 0);

        // Preview text (first ~60 chars)
        lv_obj_t* preview_lbl = lv_label_create(row);
        String preview = entry.text;
        if (preview.length() > 60) {
            preview = preview.substring(0, 57) + "...";
        }
        lv_label_set_text(preview_lbl, preview.c_str());
        lv_obj_set_style_text_color(preview_lbl, lv_color_make(156, 211, 200), LV_PART_MAIN);
        lv_obj_set_style_text_font(preview_lbl, &lv_font_montserrat_12, LV_PART_MAIN);
        lv_obj_align(preview_lbl, LV_ALIGN_BOTTOM_LEFT, 0, 0);

        // Click handler with entry index as user data
        lv_obj_add_event_cb(row, entry_clicked_cb, LV_EVENT_CLICKED,
                            (void*)(uintptr_t)i);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

namespace UI {
namespace ScreenDiary {

void create() {
    screen = lv_obj_create(nullptr);
    lv_obj_set_size(screen, 800, 480);
    lv_obj_set_style_bg_color(screen, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // Title
    title_label = lv_label_create(screen);
    lv_label_set_text(title_label, "Diario");
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

    // Empty state label
    empty_label = lv_label_create(screen);
    lv_label_set_text(empty_label, "Le pagine del diario sono vuote...\nParla con il tuo Lalien per ispirare le sue prime parole.");
    lv_obj_set_style_text_color(empty_label,
        lv_color_make(100, 100, 120), LV_PART_MAIN);
    lv_obj_set_style_text_font(empty_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_align(empty_label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_align(empty_label, LV_ALIGN_CENTER, 0, 0);

    // Scrollable list container
    list_container = lv_obj_create(screen);
    lv_obj_set_size(list_container, 780, 410);
    lv_obj_align(list_container, LV_ALIGN_BOTTOM_MID, 0, -10);
    lv_obj_set_style_bg_opa(list_container, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(list_container, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(list_container, 4, LV_PART_MAIN);
    lv_obj_set_flex_flow(list_container, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(list_container, LV_FLEX_ALIGN_START,
                          LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(list_container, 6, LV_PART_MAIN);
    lv_obj_add_flag(list_container, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(list_container, LV_DIR_VER);

    // Detail panel (hidden by default)
    detail_panel = lv_obj_create(screen);
    lv_obj_set_size(detail_panel, 780, 410);
    lv_obj_align(detail_panel, LV_ALIGN_BOTTOM_MID, 0, -10);
    lv_obj_set_style_bg_color(detail_panel, lv_color_make(10, 10, 20), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(detail_panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(detail_panel, 12, LV_PART_MAIN);
    lv_obj_set_style_border_width(detail_panel, 1, LV_PART_MAIN);
    lv_obj_set_style_border_color(detail_panel, lv_color_make(60, 60, 80), LV_PART_MAIN);
    lv_obj_set_style_pad_all(detail_panel, 16, LV_PART_MAIN);
    lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(detail_panel, LV_DIR_VER);
    lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);

    // Detail: back button
    detail_back_btn = lv_button_create(detail_panel);
    lv_obj_set_size(detail_back_btn, 50, 30);
    lv_obj_align(detail_back_btn, LV_ALIGN_TOP_LEFT, 0, 0);
    lv_obj_add_event_cb(detail_back_btn, detail_back_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* det_back_lbl = lv_label_create(detail_back_btn);
    lv_label_set_text(det_back_lbl, LV_SYMBOL_LEFT);
    lv_obj_center(det_back_lbl);

    // Detail: date/stage label
    detail_date = lv_label_create(detail_panel);
    lv_label_set_text(detail_date, "");
    lv_obj_set_style_text_color(detail_date, lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_date, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(detail_date, LV_ALIGN_TOP_MID, 0, 4);

    // Detail: diary text
    detail_text = lv_label_create(detail_panel);
    lv_label_set_text(detail_text, "");
    lv_obj_set_width(detail_text, 740);
    lv_label_set_long_mode(detail_text, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_color(detail_text, lv_color_make(200, 220, 210), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_text, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_line_space(detail_text, 6, LV_PART_MAIN);
    lv_obj_align(detail_text, LV_ALIGN_TOP_LEFT, 0, 40);

    Serial.println("[DIARY] Screen created with list + detail views");
}

void show() {
    if (screen) {
        // Rebuild the list each time the screen is shown
        rebuildList();
        s_view_mode = ViewMode::LIST;

        // Reset visibility
        if (list_container) lv_obj_remove_flag(list_container, LV_OBJ_FLAG_HIDDEN);
        if (detail_panel) lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);

        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
    }
}

void hide() {
    s_view_mode = ViewMode::LIST;
}

void update() {
    // No periodic updates needed; list is rebuilt on show()
}

void handleTouch(const HAL::TouchEvent& event) {
    (void)event;
    // Touch events handled by LVGL callbacks
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenDiary
} // namespace UI
