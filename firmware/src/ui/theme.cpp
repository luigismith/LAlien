/**
 * theme.cpp -- Dark Mediterranean LVGL theme implementation
 *
 * Deep black background, warm gold accents, night blue panels,
 * off-white text, with dynamic pet highlight color.
 * Uses LVGL 9.x style API.
 *
 * Includes:
 *   - Screen transition fade animations (300ms)
 *   - Button press scale feedback (50ms)
 *   - Loading spinner overlay for async operations
 *   - Consistent padding, margins, and typography
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "theme.h"
#include "lvgl.h"

// ---- Internal state ----
static uint16_t pet_highlight_rgb565 = UI::Theme::GOLD_ACCENT;

// Convert RGB565 to LVGL lv_color_t (LVGL 9.x uses RGB888 internally)
static lv_color_t rgb565_to_lv(uint16_t c) {
    uint8_t r = ((c >> 11) & 0x1F) << 3;
    uint8_t g = ((c >> 5)  & 0x3F) << 2;
    uint8_t b = (c & 0x1F) << 3;
    return lv_color_make(r, g, b);
}

// ---- LVGL Styles ----
static lv_style_t style_screen;          // Screen/base background
static lv_style_t style_panel;           // Container panels
static lv_style_t style_btn;             // Buttons
static lv_style_t style_btn_pressed;     // Button pressed state
static lv_style_t style_label;           // Primary text
static lv_style_t style_label_sec;       // Secondary text
static lv_style_t style_toolbar;         // Toolbar panel
static lv_style_t style_card;            // Card-style containers
static lv_style_t style_transition;      // Screen transition helper

static bool styles_initialized = false;

// Loading spinner overlay
static lv_obj_t* spinner_overlay  = nullptr;
static lv_obj_t* spinner_arc      = nullptr;
static lv_obj_t* spinner_label    = nullptr;

// ---- Button press animation callback ----
static void btn_press_anim_cb(void* var, int32_t v) {
    lv_obj_t* obj = (lv_obj_t*)var;
    // Scale 256 = 100%. We animate from 256 down to 240 (94%) and back.
    lv_obj_set_style_transform_scale(obj, v, LV_PART_MAIN);
}

// Pressed event: shrink button briefly
static void btn_pressed_event_cb(lv_event_t* e) {
    lv_obj_t* btn = (lv_obj_t*)lv_event_get_target(e);

    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, btn);
    lv_anim_set_values(&a, 256, 236);
    lv_anim_set_duration(&a, UI::Theme::BTN_PRESS_MS);
    lv_anim_set_exec_cb(&a, btn_press_anim_cb);
    lv_anim_set_playback_duration(&a, UI::Theme::BTN_PRESS_MS);
    lv_anim_start(&a);
}

static void init_styles() {
    if (styles_initialized) return;
    styles_initialized = true;

    // --- Screen background ---
    lv_style_init(&style_screen);
    lv_style_set_bg_color(&style_screen, rgb565_to_lv(UI::Theme::BG_BLACK));
    lv_style_set_bg_opa(&style_screen, LV_OPA_COVER);
    lv_style_set_text_color(&style_screen, rgb565_to_lv(UI::Theme::TEXT_PRIMARY));
    lv_style_set_text_font(&style_screen, &lv_font_montserrat_16);
    lv_style_set_pad_all(&style_screen, UI::Theme::MARGIN_SCREEN);

    // --- Panel ---
    lv_style_init(&style_panel);
    lv_style_set_bg_color(&style_panel, rgb565_to_lv(UI::Theme::NIGHT_BLUE));
    lv_style_set_bg_opa(&style_panel, LV_OPA_COVER);
    lv_style_set_border_color(&style_panel, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_border_width(&style_panel, 1);
    lv_style_set_border_opa(&style_panel, LV_OPA_40);
    lv_style_set_radius(&style_panel, 8);
    lv_style_set_pad_all(&style_panel, UI::Theme::PAD_MEDIUM);

    // --- Button ---
    lv_style_init(&style_btn);
    lv_style_set_bg_color(&style_btn, rgb565_to_lv(UI::Theme::NIGHT_BLUE));
    lv_style_set_bg_opa(&style_btn, LV_OPA_COVER);
    lv_style_set_border_color(&style_btn, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_border_width(&style_btn, 2);
    lv_style_set_border_opa(&style_btn, LV_OPA_70);
    lv_style_set_radius(&style_btn, 12);
    lv_style_set_pad_all(&style_btn, 10);
    lv_style_set_text_color(&style_btn, rgb565_to_lv(UI::Theme::TEXT_PRIMARY));
    lv_style_set_text_font(&style_btn, &lv_font_montserrat_16);
    lv_style_set_shadow_color(&style_btn, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_shadow_width(&style_btn, 0);
    // Enable transform for scale animation
    lv_style_set_transform_scale(&style_btn, 256); // 100%

    // --- Button pressed ---
    lv_style_init(&style_btn_pressed);
    lv_style_set_bg_color(&style_btn_pressed, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_bg_opa(&style_btn_pressed, LV_OPA_80);
    lv_style_set_text_color(&style_btn_pressed, rgb565_to_lv(UI::Theme::BG_BLACK));
    lv_style_set_shadow_width(&style_btn_pressed, 12);
    lv_style_set_shadow_opa(&style_btn_pressed, LV_OPA_50);

    // --- Primary label ---
    lv_style_init(&style_label);
    lv_style_set_text_color(&style_label, rgb565_to_lv(UI::Theme::TEXT_PRIMARY));
    lv_style_set_text_font(&style_label, &lv_font_montserrat_16);

    // --- Secondary label ---
    lv_style_init(&style_label_sec);
    lv_style_set_text_color(&style_label_sec, rgb565_to_lv(UI::Theme::TEXT_SECONDARY));
    lv_style_set_text_font(&style_label_sec, &lv_font_montserrat_14);

    // --- Toolbar ---
    lv_style_init(&style_toolbar);
    lv_style_set_bg_color(&style_toolbar, lv_color_make(5, 12, 20));
    lv_style_set_bg_opa(&style_toolbar, LV_OPA_90);
    lv_style_set_border_color(&style_toolbar, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_border_width(&style_toolbar, 1);
    lv_style_set_border_opa(&style_toolbar, LV_OPA_30);
    lv_style_set_border_side(&style_toolbar, LV_BORDER_SIDE_LEFT);
    lv_style_set_radius(&style_toolbar, 0);
    lv_style_set_pad_all(&style_toolbar, 6);
    lv_style_set_pad_row(&style_toolbar, 4);

    // --- Card ---
    lv_style_init(&style_card);
    lv_style_set_bg_color(&style_card, lv_color_make(10, 18, 30));
    lv_style_set_bg_opa(&style_card, LV_OPA_COVER);
    lv_style_set_border_color(&style_card, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_border_width(&style_card, 1);
    lv_style_set_border_opa(&style_card, LV_OPA_30);
    lv_style_set_radius(&style_card, 12);
    lv_style_set_pad_all(&style_card, UI::Theme::PAD_LARGE);
    lv_style_set_shadow_color(&style_card, lv_color_make(0, 0, 0));
    lv_style_set_shadow_width(&style_card, 8);
    lv_style_set_shadow_opa(&style_card, LV_OPA_40);

    // --- Screen transition style ---
    lv_style_init(&style_transition);
    lv_style_set_bg_opa(&style_transition, LV_OPA_COVER);
}

// ---- LVGL theme apply callback (LVGL 9.x) ----
static void theme_apply_cb(lv_theme_t* th, lv_obj_t* obj) {
    (void)th;

    // Apply screen style to screens
    if (lv_obj_get_parent(obj) == nullptr) {
        lv_obj_add_style(obj, &style_screen, LV_PART_MAIN);
        return;
    }

    // Apply button style + press animation
    if (lv_obj_check_type(obj, &lv_button_class)) {
        lv_obj_add_style(obj, &style_btn, LV_PART_MAIN);
        lv_obj_add_style(obj, &style_btn_pressed, LV_STATE_PRESSED);
        // Add scale-down animation on press
        lv_obj_add_event_cb(obj, btn_pressed_event_cb,
            LV_EVENT_PRESSED, nullptr);
        return;
    }

    // Apply label style
    if (lv_obj_check_type(obj, &lv_label_class)) {
        lv_obj_add_style(obj, &style_label, LV_PART_MAIN);
        return;
    }
}

// ---- Loading spinner helpers ----

static void create_spinner_overlay() {
    lv_obj_t* scr = lv_screen_active();
    if (!scr) return;

    // Semi-transparent overlay
    spinner_overlay = lv_obj_create(scr);
    lv_obj_remove_style_all(spinner_overlay);
    lv_obj_set_size(spinner_overlay, 800, 480);
    lv_obj_set_pos(spinner_overlay, 0, 0);
    lv_obj_set_style_bg_color(spinner_overlay,
        lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(spinner_overlay, LV_OPA_50, LV_PART_MAIN);
    lv_obj_remove_flag(spinner_overlay, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(spinner_overlay, LV_OBJ_FLAG_CLICKABLE); // absorb clicks

    // Spinning arc
    spinner_arc = lv_arc_create(spinner_overlay);
    lv_obj_set_size(spinner_arc, 60, 60);
    lv_obj_center(spinner_arc);
    lv_arc_set_rotation(spinner_arc, 0);
    lv_arc_set_bg_angles(spinner_arc, 0, 360);
    lv_arc_set_angles(spinner_arc, 0, 90);
    lv_obj_set_style_arc_color(spinner_arc,
        rgb565_to_lv(UI::Theme::GOLD_ACCENT), LV_PART_INDICATOR);
    lv_obj_set_style_arc_width(spinner_arc, 4, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(spinner_arc,
        lv_color_make(30, 30, 40), LV_PART_MAIN);
    lv_obj_set_style_arc_width(spinner_arc, 4, LV_PART_MAIN);
    lv_obj_set_style_arc_opa(spinner_arc, LV_OPA_30, LV_PART_MAIN);
    lv_obj_remove_style(spinner_arc, nullptr, LV_PART_KNOB);
    lv_obj_remove_flag(spinner_arc, LV_OBJ_FLAG_CLICKABLE);

    // Rotation animation
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, spinner_arc);
    lv_anim_set_values(&a, 0, 360);
    lv_anim_set_duration(&a, 1000);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_set_exec_cb(&a, [](void* obj, int32_t v) {
        lv_arc_set_angles((lv_obj_t*)obj, v, v + 90);
    });
    lv_anim_start(&a);

    // Message label below spinner
    spinner_label = lv_label_create(spinner_overlay);
    lv_label_set_text(spinner_label, "");
    lv_obj_set_style_text_color(spinner_label,
        rgb565_to_lv(UI::Theme::TEXT_PRIMARY), LV_PART_MAIN);
    lv_obj_set_style_text_font(spinner_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(spinner_label, LV_ALIGN_CENTER, 0, 50);

    lv_obj_add_flag(spinner_overlay, LV_OBJ_FLAG_HIDDEN);
}

// ---- Public API ----

namespace UI {
namespace Theme {

void init() {
    init_styles();

    // Create and register theme
    static lv_theme_t theme;
    lv_theme_set_apply_cb(&theme, theme_apply_cb);

    // Set as default theme on the active display
    lv_display_t* disp = lv_display_get_default();
    if (disp) {
        lv_display_set_theme(disp, &theme);
    }

    // Apply screen style to the active screen
    lv_obj_t* scr = lv_screen_active();
    if (scr) {
        lv_obj_add_style(scr, &style_screen, LV_PART_MAIN);
    }

    // Create the loading spinner overlay (hidden)
    create_spinner_overlay();

    Serial.println("[THEME] Dark Mediterranean theme applied with animations");
}

void setPetHighlight(uint16_t color) {
    pet_highlight_rgb565 = color;

    // Update button border with new highlight
    lv_style_set_border_color(&style_btn, rgb565_to_lv(color));
    lv_style_set_bg_color(&style_btn_pressed, rgb565_to_lv(color));
    lv_style_set_shadow_color(&style_btn, rgb565_to_lv(color));

    // Update toolbar border accent
    lv_style_set_border_color(&style_toolbar, rgb565_to_lv(color));

    // Update card border
    lv_style_set_border_color(&style_card, rgb565_to_lv(color));

    // Update panel border
    lv_style_set_border_color(&style_panel, rgb565_to_lv(color));

    // Force refresh
    lv_obj_invalidate(lv_screen_active());

    Serial.print("[THEME] Pet highlight updated to 0x");
    Serial.println(color, HEX);
}

uint16_t getPetHighlight() {
    return pet_highlight_rgb565;
}

void showLoadingSpinner(const char* message) {
    if (!spinner_overlay) {
        create_spinner_overlay();
    }
    if (!spinner_overlay) return;

    if (message && spinner_label) {
        lv_label_set_text(spinner_label, message);
    } else if (spinner_label) {
        lv_label_set_text(spinner_label, "");
    }

    // Move to front
    lv_obj_move_foreground(spinner_overlay);
    lv_obj_remove_flag(spinner_overlay, LV_OBJ_FLAG_HIDDEN);

    // Fade in
    lv_obj_set_style_opa(spinner_overlay, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, spinner_overlay);
    lv_anim_set_values(&a, LV_OPA_TRANSP, LV_OPA_COVER);
    lv_anim_set_duration(&a, 150);
    lv_anim_set_exec_cb(&a, [](void* obj, int32_t v) {
        lv_obj_set_style_opa((lv_obj_t*)obj, (lv_opa_t)v, LV_PART_MAIN);
    });
    lv_anim_start(&a);
}

void hideLoadingSpinner() {
    if (!spinner_overlay) return;

    // Fade out
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, spinner_overlay);
    lv_anim_set_values(&a, LV_OPA_COVER, LV_OPA_TRANSP);
    lv_anim_set_duration(&a, 150);
    lv_anim_set_exec_cb(&a, [](void* obj, int32_t v) {
        lv_obj_set_style_opa((lv_obj_t*)obj, (lv_opa_t)v, LV_PART_MAIN);
    });
    lv_anim_set_completed_cb(&a, [](lv_anim_t* anim) {
        lv_obj_t* obj = (lv_obj_t*)anim->var;
        lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
    });
    lv_anim_start(&a);
}

bool isLoadingVisible() {
    if (!spinner_overlay) return false;
    return !lv_obj_has_flag(spinner_overlay, LV_OBJ_FLAG_HIDDEN);
}

} // namespace Theme
} // namespace UI
