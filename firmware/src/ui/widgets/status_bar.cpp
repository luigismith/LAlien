/**
 * status_bar.cpp -- Top status bar for all screens
 *
 * Layout (800 x 32 pixels):
 *   [stage_icon] [pet_name]  [need_dots x10]  [wifi_icon] [time]
 *
 * Need dots: 10 tiny colored circles showing need levels.
 * Tap the bar to expand/collapse the detailed NeedBars overlay.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "status_bar.h"
#include "need_bars.h"
#include "../theme.h"
#include "lvgl.h"

// ---- Layout ----
static constexpr int16_t BAR_WIDTH   = 800;
static constexpr int16_t BAR_HEIGHT  = 32;
static constexpr int16_t DOT_SIZE    = 8;
static constexpr int16_t DOT_GAP     = 4;
static constexpr int16_t DOT_START_X = 280;
static constexpr int16_t ICON_PAD    = 8;

static constexpr uint8_t NEED_COUNT = (uint8_t)Pet::NeedType::COUNT;

// Stage icon symbols (one per stage)
static const char* const STAGE_ICONS[] = {
    LV_SYMBOL_CHARGE,     // Syrma (egg)
    LV_SYMBOL_EYE_OPEN,   // Lali-na (newborn)
    LV_SYMBOL_EYE_OPEN,   // Lali-shi (infant)
    LV_SYMBOL_PLAY,       // Lali-ko (child)
    LV_SYMBOL_SHUFFLE,    // Lali-ren (teen)
    LV_SYMBOL_BELL,       // Lali-vox (adult)
    LV_SYMBOL_EYE_OPEN,   // Lali-mere (elder)
    LV_SYMBOL_GPS,        // Lali-thishi (transcendence)
};

// WiFi signal level icons
static const char* wifi_icon_for_rssi(int32_t rssi) {
    if (rssi == 0)    return LV_SYMBOL_WARNING;  // disconnected
    if (rssi > -50)   return LV_SYMBOL_WIFI;     // excellent
    if (rssi > -70)   return LV_SYMBOL_WIFI;     // good
    return LV_SYMBOL_WIFI;                        // weak (same icon, dimmed)
}

// ---- LVGL objects ----
static lv_obj_t* s_bar_container = nullptr;
static lv_obj_t* s_stage_icon    = nullptr;
static lv_obj_t* s_name_label    = nullptr;
static lv_obj_t* s_wifi_icon     = nullptr;
static lv_obj_t* s_time_label    = nullptr;
static lv_obj_t* s_need_dots[NEED_COUNT] = {nullptr};

static bool s_needs_expanded = false;

// ---- Helpers ----

/// Map need value (0-100) to dot color
static lv_color_t dot_color(float value) {
    if (value > 70.0f) {
        return lv_color_make(40, 200, 60);   // green
    } else if (value > 30.0f) {
        return lv_color_make(220, 180, 30);  // yellow
    } else {
        return lv_color_make(200, 40, 40);   // red
    }
}

// Tap callback
static void bar_tap_cb(lv_event_t* e) {
    (void)e;
    UI::StatusBar::toggleNeedsExpand();
}

// ---- Public API ----

namespace UI {
namespace StatusBar {

void create(lv_obj_t* parent) {
    // Container bar
    s_bar_container = lv_obj_create(parent);
    lv_obj_remove_style_all(s_bar_container);
    lv_obj_set_size(s_bar_container, BAR_WIDTH, BAR_HEIGHT);
    lv_obj_set_pos(s_bar_container, 0, 0);
    lv_obj_set_style_bg_color(s_bar_container,
        lv_color_make(3, 8, 16), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_bar_container, LV_OPA_80, LV_PART_MAIN);
    lv_obj_set_style_border_color(s_bar_container,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_border_width(s_bar_container, 1, LV_PART_MAIN);
    lv_obj_set_style_border_opa(s_bar_container, LV_OPA_20, LV_PART_MAIN);
    lv_obj_set_style_border_side(s_bar_container,
        LV_BORDER_SIDE_BOTTOM, LV_PART_MAIN);
    lv_obj_remove_flag(s_bar_container, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(s_bar_container, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(s_bar_container, bar_tap_cb, LV_EVENT_CLICKED, nullptr);

    // Stage icon
    s_stage_icon = lv_label_create(s_bar_container);
    lv_label_set_text(s_stage_icon, STAGE_ICONS[0]);
    lv_obj_set_style_text_color(s_stage_icon,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_stage_icon,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_set_pos(s_stage_icon, ICON_PAD, 6);

    // Pet name
    s_name_label = lv_label_create(s_bar_container);
    lv_label_set_text(s_name_label, "---");
    lv_obj_set_style_text_color(s_name_label,
        lv_color_make(240, 230, 211), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_name_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_pos(s_name_label, 32, 8);
    lv_obj_set_width(s_name_label, 200);
    lv_label_set_long_mode(s_name_label, LV_LABEL_LONG_DOT);

    // Need indicator dots
    for (uint8_t i = 0; i < NEED_COUNT; i++) {
        s_need_dots[i] = lv_obj_create(s_bar_container);
        lv_obj_remove_style_all(s_need_dots[i]);
        lv_obj_set_size(s_need_dots[i], DOT_SIZE, DOT_SIZE);
        lv_obj_set_style_radius(s_need_dots[i], DOT_SIZE / 2, LV_PART_MAIN);
        lv_obj_set_style_bg_color(s_need_dots[i],
            lv_color_make(100, 100, 100), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(s_need_dots[i], LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_pos(s_need_dots[i],
            DOT_START_X + i * (DOT_SIZE + DOT_GAP),
            (BAR_HEIGHT - DOT_SIZE) / 2);
        lv_obj_remove_flag(s_need_dots[i], LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(s_need_dots[i], LV_OBJ_FLAG_SCROLLABLE);
    }

    // WiFi icon
    s_wifi_icon = lv_label_create(s_bar_container);
    lv_label_set_text(s_wifi_icon, LV_SYMBOL_WARNING);
    lv_obj_set_style_text_color(s_wifi_icon,
        lv_color_make(140, 140, 150), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_wifi_icon,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_pos(s_wifi_icon, 680, 8);

    // Time label
    s_time_label = lv_label_create(s_bar_container);
    lv_label_set_text(s_time_label, "--:--");
    lv_obj_set_style_text_color(s_time_label,
        lv_color_make(160, 155, 140), LV_PART_MAIN);
    lv_obj_set_style_text_font(s_time_label,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_set_pos(s_time_label, 720, 9);

    // Create the needs overlay (hidden, attached to same parent)
    NeedBars::create(parent);

    Serial.println("[STATUS_BAR] Created");
}

void destroy() {
    NeedBars::destroy();
    if (s_bar_container) {
        lv_obj_delete(s_bar_container);
        s_bar_container = nullptr;
    }
    s_stage_icon = nullptr;
    s_name_label = nullptr;
    s_wifi_icon  = nullptr;
    s_time_label = nullptr;
    for (uint8_t i = 0; i < NEED_COUNT; i++) {
        s_need_dots[i] = nullptr;
    }
}

void update(const char* pet_name, uint8_t stage,
            int32_t wifi_rssi, const char* time_str,
            const Pet::NeedsState& needs) {
    if (!s_bar_container) return;

    // Pet name
    if (s_name_label && pet_name) {
        lv_label_set_text(s_name_label, pet_name);
    }

    // Stage icon
    if (s_stage_icon && stage < 8) {
        lv_label_set_text(s_stage_icon, STAGE_ICONS[stage]);
    }

    // WiFi
    if (s_wifi_icon) {
        lv_label_set_text(s_wifi_icon, wifi_icon_for_rssi(wifi_rssi));
        // Dim icon when signal is weak
        lv_opa_t opa = (wifi_rssi == 0) ? LV_OPA_40 :
                        (wifi_rssi > -70) ? LV_OPA_COVER : LV_OPA_60;
        lv_obj_set_style_text_opa(s_wifi_icon, opa, LV_PART_MAIN);
    }

    // Time
    if (s_time_label && time_str) {
        lv_label_set_text(s_time_label, time_str);
    }

    // Need dots
    for (uint8_t i = 0; i < NEED_COUNT; i++) {
        if (s_need_dots[i]) {
            lv_obj_set_style_bg_color(s_need_dots[i],
                dot_color(needs.values[i]), LV_PART_MAIN);
        }
    }

    // Update need bars overlay if expanded
    if (s_needs_expanded) {
        NeedBars::update(needs);
    }
}

void show() {
    if (s_bar_container) {
        lv_obj_remove_flag(s_bar_container, LV_OBJ_FLAG_HIDDEN);
    }
}

void hide() {
    if (s_bar_container) {
        lv_obj_add_flag(s_bar_container, LV_OBJ_FLAG_HIDDEN);
    }
    if (s_needs_expanded) {
        NeedBars::hide();
        s_needs_expanded = false;
    }
}

void toggleNeedsExpand() {
    s_needs_expanded = !s_needs_expanded;
    if (s_needs_expanded) {
        NeedBars::show();
    } else {
        NeedBars::hide();
    }
    Serial.print("[STATUS_BAR] Needs overlay ");
    Serial.println(s_needs_expanded ? "expanded" : "collapsed");
}

bool isNeedsExpanded() {
    return s_needs_expanded;
}

int16_t getHeight() {
    return BAR_HEIGHT;
}

lv_obj_t* getContainer() {
    return s_bar_container;
}

} // namespace StatusBar
} // namespace UI
