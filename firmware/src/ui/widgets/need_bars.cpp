/**
 * need_bars.cpp -- Detailed needs display overlay
 *
 * 10 horizontal bars with labels, percentage text, and color gradient.
 * Green (>70%) -> Yellow (30-70%) -> Red (<30%).
 * Animated fill transitions via LVGL bar value animation.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "need_bars.h"
#include "../theme.h"
#include "lvgl.h"

// ---- Layout ----
static constexpr int16_t  OVERLAY_WIDTH    = 340;
static constexpr int16_t  OVERLAY_HEIGHT   = 380;
static constexpr int16_t  BAR_HEIGHT       = 18;
static constexpr int16_t  BAR_WIDTH        = 180;
static constexpr int16_t  LABEL_WIDTH      = 80;
static constexpr int16_t  PCT_WIDTH        = 45;
static constexpr int16_t  ROW_HEIGHT       = 30;
static constexpr int16_t  PAD              = 12;
static constexpr uint32_t ANIM_DURATION_MS = 400;

// Need names (Italian, matching NeedType order)
static const char* const NEED_NAMES[] = {
    "Kora",        // hunger
    "Moko",        // rest
    "Miska",       // hygiene
    "Nashi",       // happiness
    "Salute",      // health
    "Cognizione",  // cognition
    "Affetto",     // affection
    "Curiosita",   // curiosity
    "Cosmico",     // cosmic
    "Sicurezza",   // security
};

static constexpr uint8_t NEED_COUNT = (uint8_t)Pet::NeedType::COUNT;

// ---- LVGL objects ----
static lv_obj_t*  s_container  = nullptr;
static lv_obj_t*  s_bars[NEED_COUNT]       = {nullptr};
static lv_obj_t*  s_labels[NEED_COUNT]     = {nullptr};
static lv_obj_t*  s_pct_labels[NEED_COUNT] = {nullptr};
static lv_style_t s_bar_style_bg;
static lv_style_t s_bar_style_ind;
static bool       s_visible = false;

// Cached values for change detection
static int16_t s_cached_values[NEED_COUNT] = {0};

// ---- Helpers ----

/// Map need value (0-100) to bar color (red->yellow->green)
static lv_color_t need_color(float value) {
    if (value > 70.0f) {
        // Green zone: interpolate green to yellow-green
        float t = (value - 70.0f) / 30.0f;
        return lv_color_make(
            (uint8_t)(60 - 40 * t),   // 60->20 red
            (uint8_t)(180 + 50 * t),   // 180->230 green
            (uint8_t)(40)              // low blue
        );
    } else if (value > 30.0f) {
        // Yellow zone
        float t = (value - 30.0f) / 40.0f;
        return lv_color_make(
            (uint8_t)(200 - 140 * t),  // 200->60 red
            (uint8_t)(160 + 20 * t),   // 160->180 green
            (uint8_t)(20 + 20 * t)     // 20->40 blue
        );
    } else {
        // Red zone
        float t = value / 30.0f;
        return lv_color_make(
            (uint8_t)(180 + 20 * t),   // 180->200 red
            (uint8_t)(30 + 130 * t),   // 30->160 green
            (uint8_t)(20)              // low blue
        );
    }
}

// ---- Public API ----

namespace UI {
namespace NeedBars {

void create(lv_obj_t* parent) {
    // Overlay container
    s_container = lv_obj_create(parent);
    lv_obj_set_size(s_container, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    lv_obj_align(s_container, LV_ALIGN_TOP_MID, 0, 36); // below status bar
    lv_obj_set_style_bg_color(s_container, lv_color_make(5, 10, 20), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_container, LV_OPA_90, LV_PART_MAIN);
    lv_obj_set_style_border_color(s_container,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_border_width(s_container, 1, LV_PART_MAIN);
    lv_obj_set_style_border_opa(s_container, LV_OPA_50, LV_PART_MAIN);
    lv_obj_set_style_radius(s_container, 12, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s_container, PAD, LV_PART_MAIN);
    lv_obj_set_style_pad_row(s_container, 4, LV_PART_MAIN);
    lv_obj_set_style_shadow_color(s_container, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_shadow_width(s_container, 16, LV_PART_MAIN);
    lv_obj_set_style_shadow_opa(s_container, LV_OPA_60, LV_PART_MAIN);
    lv_obj_remove_flag(s_container, LV_OBJ_FLAG_SCROLLABLE);

    // Title
    lv_obj_t* title = lv_label_create(s_container);
    lv_label_set_text(title, "Bisogni");
    lv_obj_set_style_text_color(title, lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 0);

    // Bar style: background track
    lv_style_init(&s_bar_style_bg);
    lv_style_set_bg_color(&s_bar_style_bg, lv_color_make(20, 25, 35));
    lv_style_set_bg_opa(&s_bar_style_bg, LV_OPA_COVER);
    lv_style_set_radius(&s_bar_style_bg, 4);
    lv_style_set_border_color(&s_bar_style_bg, lv_color_make(40, 45, 60));
    lv_style_set_border_width(&s_bar_style_bg, 1);

    // Bar style: indicator (will be overridden per-bar for color)
    lv_style_init(&s_bar_style_ind);
    lv_style_set_bg_opa(&s_bar_style_ind, LV_OPA_COVER);
    lv_style_set_radius(&s_bar_style_ind, 4);

    // Create rows
    for (uint8_t i = 0; i < NEED_COUNT; i++) {
        int16_t y_offset = 28 + i * ROW_HEIGHT;

        // Need name label
        s_labels[i] = lv_label_create(s_container);
        lv_label_set_text(s_labels[i], NEED_NAMES[i]);
        lv_obj_set_style_text_color(s_labels[i],
            lv_color_make(200, 195, 180), LV_PART_MAIN);
        lv_obj_set_style_text_font(s_labels[i],
            &lv_font_montserrat_12, LV_PART_MAIN);
        lv_obj_set_pos(s_labels[i], 0, y_offset + 2);
        lv_obj_set_width(s_labels[i], LABEL_WIDTH);

        // Bar
        s_bars[i] = lv_bar_create(s_container);
        lv_obj_set_size(s_bars[i], BAR_WIDTH, BAR_HEIGHT);
        lv_obj_set_pos(s_bars[i], LABEL_WIDTH + 4, y_offset);
        lv_bar_set_range(s_bars[i], 0, 100);
        lv_bar_set_value(s_bars[i], 50, LV_ANIM_OFF);
        lv_obj_add_style(s_bars[i], &s_bar_style_bg, LV_PART_MAIN);
        lv_obj_add_style(s_bars[i], &s_bar_style_ind, LV_PART_INDICATOR);

        // Percentage label
        s_pct_labels[i] = lv_label_create(s_container);
        lv_label_set_text(s_pct_labels[i], "50%");
        lv_obj_set_style_text_color(s_pct_labels[i],
            lv_color_make(160, 155, 140), LV_PART_MAIN);
        lv_obj_set_style_text_font(s_pct_labels[i],
            &lv_font_montserrat_12, LV_PART_MAIN);
        lv_obj_set_pos(s_pct_labels[i],
            LABEL_WIDTH + BAR_WIDTH + 10, y_offset + 2);

        s_cached_values[i] = 50;
    }

    // Start hidden
    lv_obj_add_flag(s_container, LV_OBJ_FLAG_HIDDEN);
    s_visible = false;

    Serial.println("[NEED_BARS] Created");
}

void destroy() {
    if (s_container) {
        lv_obj_delete(s_container);
        s_container = nullptr;
    }
    for (uint8_t i = 0; i < NEED_COUNT; i++) {
        s_bars[i] = nullptr;
        s_labels[i] = nullptr;
        s_pct_labels[i] = nullptr;
    }
    s_visible = false;
}

void update(const Pet::NeedsState& needs) {
    if (!s_container || !s_visible) return;

    for (uint8_t i = 0; i < NEED_COUNT; i++) {
        float val = needs.values[i];
        int16_t int_val = (int16_t)constrain(val, 0.0f, 100.0f);

        // Only animate if value actually changed
        if (int_val != s_cached_values[i]) {
            s_cached_values[i] = int_val;

            // Animate bar value
            lv_bar_set_value(s_bars[i], int_val, LV_ANIM_ON);

            // Update bar indicator color
            lv_color_t clr = need_color(val);
            lv_obj_set_style_bg_color(s_bars[i], clr, LV_PART_INDICATOR);

            // Update percentage text
            char buf[8];
            snprintf(buf, sizeof(buf), "%d%%", int_val);
            lv_label_set_text(s_pct_labels[i], buf);
        }
    }
}

void show() {
    if (!s_container) return;
    lv_obj_remove_flag(s_container, LV_OBJ_FLAG_HIDDEN);
    lv_obj_set_style_opa(s_container, LV_OPA_TRANSP, LV_PART_MAIN);

    // Fade in animation
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, s_container);
    lv_anim_set_values(&a, LV_OPA_TRANSP, LV_OPA_COVER);
    lv_anim_set_duration(&a, 200);
    lv_anim_set_exec_cb(&a, [](void* obj, int32_t v) {
        lv_obj_set_style_opa((lv_obj_t*)obj, (lv_opa_t)v, LV_PART_MAIN);
    });
    lv_anim_start(&a);

    s_visible = true;
}

void hide() {
    if (!s_container) return;

    // Fade out animation
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, s_container);
    lv_anim_set_values(&a, LV_OPA_COVER, LV_OPA_TRANSP);
    lv_anim_set_duration(&a, 200);
    lv_anim_set_exec_cb(&a, [](void* obj, int32_t v) {
        lv_obj_set_style_opa((lv_obj_t*)obj, (lv_opa_t)v, LV_PART_MAIN);
    });
    lv_anim_set_completed_cb(&a, [](lv_anim_t* anim) {
        lv_obj_t* obj = (lv_obj_t*)anim->var;
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    });
    lv_anim_start(&a);

    s_visible = false;
}

bool isVisible() {
    return s_visible;
}

lv_obj_t* getContainer() {
    return s_container;
}

} // namespace NeedBars
} // namespace UI
