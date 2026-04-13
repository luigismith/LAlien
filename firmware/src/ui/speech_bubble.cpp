/**
 * speech_bubble.cpp — Speech bubble with typewriter effect and mood shapes
 *
 * LVGL container at bottom-center of screen. Text is revealed character
 * by character (~30 chars/sec). Shape, color, and border change based on
 * the pet's emotional mood. Chiptune blips every 2-3 characters.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "speech_bubble.h"
#include "theme.h"
#include "../hal/audio.h"
#include "lvgl.h"

// ---- Layout constants ----
static constexpr int16_t  BUBBLE_WIDTH    = 600;
static constexpr int16_t  BUBBLE_X        = (800 - BUBBLE_WIDTH) / 2; // 100
static constexpr int16_t  BUBBLE_Y_BOTTOM = 470; // bottom edge
static constexpr int16_t  BUBBLE_PAD      = 16;
static constexpr int16_t  BUBBLE_MAX_H    = 120;
static constexpr uint32_t CHAR_INTERVAL   = 33;  // ~30 chars/sec
static constexpr uint8_t  BLIP_INTERVAL   = 3;   // blip every N chars

// Mood colors (background, border) as RGB888
struct MoodStyle {
    lv_color_t bg;
    lv_color_t border;
    uint8_t    border_w;
    uint8_t    radius;
    lv_opa_t   bg_opa;
};

static const MoodStyle mood_styles[] = {
    // NEUTRAL: night blue, subtle gold border
    { lv_color_make(10, 25, 41),  lv_color_make(212, 165, 52), 2, 16, LV_OPA_90 },
    // HAPPY: warm deep purple-blue, gold border, extra rounded
    { lv_color_make(20, 15, 50),  lv_color_make(212, 165, 52), 2, 24, LV_OPA_90 },
    // SAD: darker desaturated blue, dim border
    { lv_color_make(8, 12, 22),   lv_color_make(80, 90, 110),  2, 12, LV_OPA_80 },
    // SCARED: dark with red-orange border (jagged feel)
    { lv_color_make(20, 8, 8),    lv_color_make(200, 60, 40),  3, 4,  LV_OPA_90 },
    // SICK: greenish tint, muted border
    { lv_color_make(10, 18, 10),  lv_color_make(100, 130, 80), 2, 14, LV_OPA_85 },
    // WISE: deep blue, glowing gold border
    { lv_color_make(5, 10, 30),   lv_color_make(255, 200, 60), 3, 20, LV_OPA_90 },
};

// ---- State ----
static lv_obj_t*  bubble_container = nullptr;
static lv_obj_t*  bubble_label     = nullptr;
static lv_style_t bubble_style;
static lv_style_t label_style;

static char       full_text[512]   = {0};
static uint16_t   full_len         = 0;
static uint16_t   visible_chars    = 0;
static bool       animating        = false;
static uint32_t   last_char_ms     = 0;
static uint8_t    char_since_blip  = 0;

static UI::SpeechBubble::Mood current_mood = UI::SpeechBubble::Mood::NEUTRAL;

// Trembling offset for SICK mood
static int8_t     tremble_offset_x = 0;
static int8_t     tremble_offset_y = 0;
static uint32_t   tremble_timer    = 0;

// ---- Helpers ----

static void apply_mood_style(UI::SpeechBubble::Mood mood) {
    uint8_t idx = (uint8_t)mood;
    if (idx >= sizeof(mood_styles) / sizeof(mood_styles[0])) idx = 0;
    const MoodStyle& ms = mood_styles[idx];

    lv_style_set_bg_color(&bubble_style, ms.bg);
    lv_style_set_bg_opa(&bubble_style, ms.bg_opa);
    lv_style_set_border_color(&bubble_style, ms.border);
    lv_style_set_border_width(&bubble_style, ms.border_w);
    lv_style_set_radius(&bubble_style, ms.radius);

    if (bubble_container) {
        lv_obj_invalidate(bubble_container);
    }
}

// ---- Public API ----

namespace UI {
namespace SpeechBubble {

void init() {
    // --- Bubble container style ---
    lv_style_init(&bubble_style);
    lv_style_set_bg_color(&bubble_style, mood_styles[0].bg);
    lv_style_set_bg_opa(&bubble_style, mood_styles[0].bg_opa);
    lv_style_set_border_color(&bubble_style, mood_styles[0].border);
    lv_style_set_border_width(&bubble_style, mood_styles[0].border_w);
    lv_style_set_border_opa(&bubble_style, LV_OPA_COVER);
    lv_style_set_radius(&bubble_style, mood_styles[0].radius);
    lv_style_set_pad_all(&bubble_style, BUBBLE_PAD);
    lv_style_set_shadow_color(&bubble_style, lv_color_make(0, 0, 0));
    lv_style_set_shadow_width(&bubble_style, 12);
    lv_style_set_shadow_opa(&bubble_style, LV_OPA_60);

    // --- Label style ---
    lv_style_init(&label_style);
    lv_style_set_text_color(&label_style, lv_color_make(240, 230, 211)); // off-white
    lv_style_set_text_font(&label_style, &lv_font_montserrat_16);

    // --- Create container ---
    bubble_container = lv_obj_create(lv_screen_active());
    lv_obj_remove_style_all(bubble_container);
    lv_obj_add_style(bubble_container, &bubble_style, LV_PART_MAIN);
    lv_obj_set_width(bubble_container, BUBBLE_WIDTH);
    lv_obj_set_height(bubble_container, LV_SIZE_CONTENT);
    lv_obj_set_style_max_height(bubble_container, BUBBLE_MAX_H, 0);
    lv_obj_align(bubble_container, LV_ALIGN_BOTTOM_MID, 0, -10);
    lv_obj_add_flag(bubble_container, LV_OBJ_FLAG_HIDDEN);
    // Disable scrolling on the bubble
    lv_obj_remove_flag(bubble_container, LV_OBJ_FLAG_SCROLLABLE);

    // --- Create text label ---
    bubble_label = lv_label_create(bubble_container);
    lv_obj_remove_style_all(bubble_label);
    lv_obj_add_style(bubble_label, &label_style, LV_PART_MAIN);
    lv_label_set_long_mode(bubble_label, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(bubble_label, BUBBLE_WIDTH - 2 * BUBBLE_PAD);
    lv_label_set_text(bubble_label, "");

    Serial.println("[BUBBLE] Speech bubble initialized");
}

void show(const char* text, Mood mood) {
    if (!bubble_container || !bubble_label) return;

    current_mood = mood;

    // Copy full text
    strncpy(full_text, text, sizeof(full_text) - 1);
    full_text[sizeof(full_text) - 1] = '\0';
    full_len = (uint16_t)strlen(full_text);
    visible_chars = 0;
    animating = true;
    last_char_ms = millis();
    char_since_blip = 0;

    // Apply mood styling
    apply_mood_style(mood);

    // Reset tremble
    tremble_offset_x = 0;
    tremble_offset_y = 0;
    tremble_timer = millis();

    // Show empty text initially (typewriter will fill it)
    lv_label_set_text(bubble_label, "");
    lv_obj_remove_flag(bubble_container, LV_OBJ_FLAG_HIDDEN);
    lv_obj_align(bubble_container, LV_ALIGN_BOTTOM_MID, 0, -10);

    Serial.print("[BUBBLE] Showing: \"");
    Serial.print(text);
    Serial.print("\" mood=");
    Serial.println((int)mood);
}

void hide() {
    if (!bubble_container) return;
    lv_obj_add_flag(bubble_container, LV_OBJ_FLAG_HIDDEN);
    animating = false;
    visible_chars = 0;
    full_len = 0;
    full_text[0] = '\0';
}

void update() {
    if (!bubble_container || !bubble_label) return;

    // --- Typewriter advance ---
    if (animating && visible_chars < full_len) {
        uint32_t now = millis();
        if (now - last_char_ms >= CHAR_INTERVAL) {
            last_char_ms = now;
            visible_chars++;

            // Update visible text — copy only visible_chars characters
            char visible_buf[512];
            uint16_t len = visible_chars;
            if (len >= sizeof(visible_buf)) len = sizeof(visible_buf) - 1;
            memcpy(visible_buf, full_text, len);
            visible_buf[len] = '\0';
            lv_label_set_text(bubble_label, visible_buf);

            // Audio blip every BLIP_INTERVAL characters
            char_since_blip++;
            if (char_since_blip >= BLIP_INTERVAL) {
                char_since_blip = 0;
                if (HAL::Audio::isAvailable()) {
                    HAL::Audio::playBlip();
                }
            }
        }
    } else if (animating && visible_chars >= full_len) {
        animating = false;
    }

    // --- SICK mood trembling effect ---
    if (current_mood == Mood::SICK && !lv_obj_has_flag(bubble_container, LV_OBJ_FLAG_HIDDEN)) {
        uint32_t now = millis();
        if (now - tremble_timer > 80) {
            tremble_timer = now;
            // Pseudo-random small offsets
            tremble_offset_x = (int8_t)((now * 7) % 5) - 2; // -2..+2
            tremble_offset_y = (int8_t)((now * 13) % 3) - 1; // -1..+1
            lv_obj_align(bubble_container, LV_ALIGN_BOTTOM_MID,
                         tremble_offset_x, -10 + tremble_offset_y);
        }
    }
}

bool isAnimating() {
    return animating;
}

void skipAnimation() {
    if (!animating || !bubble_label) return;
    visible_chars = full_len;
    lv_label_set_text(bubble_label, full_text);
    animating = false;
}

} // namespace SpeechBubble
} // namespace UI
