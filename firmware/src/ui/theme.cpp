/**
 * theme.cpp — Dark Mediterranean LVGL theme implementation
 *
 * Deep black background, warm gold accents, night blue panels,
 * off-white text, with dynamic pet highlight color.
 * Uses LVGL 9.x style API.
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
// We define a set of reusable styles and apply them via a theme callback.

static lv_style_t style_screen;       // Screen/base background
static lv_style_t style_panel;        // Container panels
static lv_style_t style_btn;          // Buttons
static lv_style_t style_btn_pressed;  // Button pressed state
static lv_style_t style_label;        // Primary text
static lv_style_t style_label_sec;    // Secondary text
static lv_style_t style_toolbar;      // Toolbar panel
static lv_style_t style_card;         // Card-style containers

static bool styles_initialized = false;

static void init_styles() {
    if (styles_initialized) return;
    styles_initialized = true;

    // --- Screen background ---
    lv_style_init(&style_screen);
    lv_style_set_bg_color(&style_screen, rgb565_to_lv(UI::Theme::BG_BLACK));
    lv_style_set_bg_opa(&style_screen, LV_OPA_COVER);
    lv_style_set_text_color(&style_screen, rgb565_to_lv(UI::Theme::TEXT_PRIMARY));
    lv_style_set_text_font(&style_screen, &lv_font_montserrat_16);

    // --- Panel ---
    lv_style_init(&style_panel);
    lv_style_set_bg_color(&style_panel, rgb565_to_lv(UI::Theme::NIGHT_BLUE));
    lv_style_set_bg_opa(&style_panel, LV_OPA_COVER);
    lv_style_set_border_color(&style_panel, rgb565_to_lv(UI::Theme::GOLD_ACCENT));
    lv_style_set_border_width(&style_panel, 1);
    lv_style_set_border_opa(&style_panel, LV_OPA_40);
    lv_style_set_radius(&style_panel, 8);
    lv_style_set_pad_all(&style_panel, 8);

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
    lv_style_set_pad_all(&style_card, 12);
    lv_style_set_shadow_color(&style_card, lv_color_make(0, 0, 0));
    lv_style_set_shadow_width(&style_card, 8);
    lv_style_set_shadow_opa(&style_card, LV_OPA_40);
}

// ---- LVGL theme apply callback (LVGL 9.x) ----
static void theme_apply_cb(lv_theme_t* th, lv_obj_t* obj) {
    (void)th;

    // Apply screen style to screens
    if (lv_obj_get_parent(obj) == nullptr) {
        lv_obj_add_style(obj, &style_screen, LV_PART_MAIN);
        return;
    }

    // Apply button style
    if (lv_obj_check_type(obj, &lv_button_class)) {
        lv_obj_add_style(obj, &style_btn, LV_PART_MAIN);
        lv_obj_add_style(obj, &style_btn_pressed, LV_STATE_PRESSED);
        return;
    }

    // Apply label style
    if (lv_obj_check_type(obj, &lv_label_class)) {
        lv_obj_add_style(obj, &style_label, LV_PART_MAIN);
        return;
    }
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

    Serial.println("[THEME] Dark Mediterranean theme applied");
}

void setPetHighlight(uint16_t color) {
    pet_highlight_rgb565 = color;

    // Update button border with new highlight
    lv_style_set_border_color(&style_btn, rgb565_to_lv(color));
    lv_style_set_bg_color(&style_btn_pressed, rgb565_to_lv(color));
    lv_style_set_shadow_color(&style_btn, rgb565_to_lv(color));

    // Update toolbar border accent
    lv_style_set_border_color(&style_toolbar, rgb565_to_lv(color));

    // Force refresh
    lv_obj_invalidate(lv_screen_active());

    Serial.print("[THEME] Pet highlight updated to 0x");
    Serial.println(color, HEX);
}

uint16_t getPetHighlight() {
    return pet_highlight_rgb565;
}

} // namespace Theme
} // namespace UI
