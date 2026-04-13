/**
 * mic_button.cpp -- Push-to-talk microphone button widget
 *
 * Circular LVGL button with three visual states:
 *   IDLE       -- dark grey circle with mic icon
 *   RECORDING  -- pulsing red circle, waveform ring visualization
 *   PROCESSING -- spinning arc indicator
 *
 * Touch: PRESS starts HAL::Mic recording, RELEASE stops and fires callback.
 * Max recording duration enforced (default 15s).
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "mic_button.h"
#include "../theme.h"
#include "../../hal/mic.h"
#include "lvgl.h"

// ---- Layout ----
static constexpr int16_t  BTN_DIAMETER       = 80;
static constexpr int16_t  PULSE_RING_PAD     = 8;
static constexpr int16_t  WAVEFORM_RING_R    = 56; // radius of waveform ring
static constexpr uint8_t  WAVEFORM_POINTS    = 36; // points around the ring
static constexpr uint32_t PULSE_PERIOD_MS    = 800;
static constexpr uint32_t SPINNER_PERIOD_MS  = 1200;

// ---- State ----
static UI::MicButton::State s_state = UI::MicButton::State::IDLE;
static UI::MicButton::RecordingDoneCallback s_callback = nullptr;

static lv_obj_t* s_btn           = nullptr;
static lv_obj_t* s_icon_label    = nullptr;
static lv_obj_t* s_pulse_ring    = nullptr; // canvas for pulsing ring
static lv_obj_t* s_waveform_obj  = nullptr; // line object for waveform ring
static lv_obj_t* s_spinner_arc   = nullptr; // arc for processing spinner

static uint32_t s_record_start_ms = 0;
static uint32_t s_max_record_ms   = 15000;
static uint32_t s_anim_tick       = 0;

// Waveform ring points
static lv_point_precise_t s_wave_pts[WAVEFORM_POINTS + 1];

// Colors
static const lv_color_t CLR_IDLE_BG     = lv_color_make(40, 40, 50);
static const lv_color_t CLR_IDLE_ICON   = lv_color_make(180, 180, 190);
static const lv_color_t CLR_REC_BG      = lv_color_make(160, 30, 30);
static const lv_color_t CLR_REC_PULSE   = lv_color_make(220, 50, 40);
static const lv_color_t CLR_PROC_BG     = lv_color_make(30, 50, 80);
static const lv_color_t CLR_PROC_ARC    = lv_color_make(212, 165, 52); // gold

// ---- Internal helpers ----

static void start_recording() {
    if (s_state != UI::MicButton::State::IDLE) return;

    s_state = UI::MicButton::State::RECORDING;
    s_record_start_ms = millis();

    HAL::Mic::startRecording();

    // Visual: red background
    if (s_btn) {
        lv_obj_set_style_bg_color(s_btn, CLR_REC_BG, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(s_btn, LV_OPA_COVER, LV_PART_MAIN);
    }
    if (s_icon_label) {
        lv_obj_set_style_text_color(s_icon_label,
            lv_color_make(255, 255, 255), LV_PART_MAIN);
    }
    // Show waveform ring
    if (s_waveform_obj) {
        lv_obj_remove_flag(s_waveform_obj, LV_OBJ_FLAG_HIDDEN);
    }
    // Hide spinner
    if (s_spinner_arc) {
        lv_obj_add_flag(s_spinner_arc, LV_OBJ_FLAG_HIDDEN);
    }

    Serial.println("[MIC_BTN] Recording started");
}

static void stop_recording() {
    if (s_state != UI::MicButton::State::RECORDING) return;

    HAL::Mic::stopRecording();

    s_state = UI::MicButton::State::PROCESSING;

    // Visual: processing state
    if (s_btn) {
        lv_obj_set_style_bg_color(s_btn, CLR_PROC_BG, LV_PART_MAIN);
    }
    if (s_waveform_obj) {
        lv_obj_add_flag(s_waveform_obj, LV_OBJ_FLAG_HIDDEN);
    }
    if (s_spinner_arc) {
        lv_obj_remove_flag(s_spinner_arc, LV_OBJ_FLAG_HIDDEN);
    }
    if (s_icon_label) {
        lv_obj_set_style_text_color(s_icon_label, CLR_PROC_ARC, LV_PART_MAIN);
    }

    // Retrieve audio data and fire callback
    uint32_t sample_count = 0;
    const int16_t* data = HAL::Mic::getRecordingBuffer(sample_count);

    uint32_t duration_ms = millis() - s_record_start_ms;
    Serial.print("[MIC_BTN] Recording stopped, duration=");
    Serial.print(duration_ms);
    Serial.print("ms, samples=");
    Serial.println(sample_count);

    if (s_callback && data && sample_count > 0) {
        s_callback(data, sample_count);
    } else {
        // No callback or no data -- go back to idle
        s_state = UI::MicButton::State::IDLE;
        if (s_btn) {
            lv_obj_set_style_bg_color(s_btn, CLR_IDLE_BG, LV_PART_MAIN);
        }
        if (s_icon_label) {
            lv_obj_set_style_text_color(s_icon_label, CLR_IDLE_ICON, LV_PART_MAIN);
        }
        if (s_spinner_arc) {
            lv_obj_add_flag(s_spinner_arc, LV_OBJ_FLAG_HIDDEN);
        }
    }
}

// Touch event callback
static void btn_event_cb(lv_event_t* e) {
    lv_event_code_t code = lv_event_get_code(e);

    if (code == LV_EVENT_PRESSED) {
        start_recording();
    } else if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        if (s_state == UI::MicButton::State::RECORDING) {
            stop_recording();
        }
    }
}

// Update waveform ring visualization based on mic level
static void update_waveform_ring() {
    if (!s_waveform_obj) return;

    float level = HAL::Mic::getLevel();
    // Scale level to waveform amplitude (0-16 pixels)
    float amplitude = level * 16.0f;

    // Center of the button (relative to parent)
    float cx = BTN_DIAMETER / 2.0f;
    float cy = BTN_DIAMETER / 2.0f;

    uint32_t now = millis();
    for (uint8_t i = 0; i < WAVEFORM_POINTS; i++) {
        float angle = (2.0f * 3.14159f * i) / WAVEFORM_POINTS;
        // Pseudo-random variation based on time and index
        float variation = amplitude *
            (0.5f + 0.5f * sinf(angle * 3.0f + (float)now * 0.008f));
        float r = WAVEFORM_RING_R + variation;
        s_wave_pts[i].x = (int32_t)(cx + r * cosf(angle));
        s_wave_pts[i].y = (int32_t)(cy + r * sinf(angle));
    }
    // Close the ring
    s_wave_pts[WAVEFORM_POINTS] = s_wave_pts[0];

    lv_line_set_points(s_waveform_obj, s_wave_pts, WAVEFORM_POINTS + 1);
}

// Update pulsing effect on recording button
static void update_pulse() {
    if (!s_btn) return;

    uint32_t elapsed = millis() % PULSE_PERIOD_MS;
    float phase = (float)elapsed / (float)PULSE_PERIOD_MS;
    // Sine pulse: opacity oscillates between 180 and 255
    uint8_t opa = (uint8_t)(180 + 75 * sinf(phase * 2.0f * 3.14159f));
    lv_obj_set_style_bg_opa(s_btn, opa, LV_PART_MAIN);
}

// Update spinner rotation for processing state
static void update_spinner() {
    if (!s_spinner_arc) return;

    uint32_t elapsed = millis() % SPINNER_PERIOD_MS;
    int16_t start_angle = (int16_t)((360.0f * elapsed) / SPINNER_PERIOD_MS);
    lv_arc_set_angles(s_spinner_arc, start_angle, start_angle + 90);
}

// ---- Public API ----

namespace UI {
namespace MicButton {

void create(lv_obj_t* parent) {
    // Main circular button
    s_btn = lv_obj_create(parent);
    lv_obj_remove_style_all(s_btn);
    lv_obj_set_size(s_btn, BTN_DIAMETER, BTN_DIAMETER);
    lv_obj_set_style_radius(s_btn, BTN_DIAMETER / 2, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_btn, CLR_IDLE_BG, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_color(s_btn, lv_color_make(80, 80, 100), LV_PART_MAIN);
    lv_obj_set_style_border_width(s_btn, 2, LV_PART_MAIN);
    lv_obj_set_style_border_opa(s_btn, LV_OPA_60, LV_PART_MAIN);
    lv_obj_set_style_shadow_color(s_btn, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_shadow_width(s_btn, 10, LV_PART_MAIN);
    lv_obj_set_style_shadow_opa(s_btn, LV_OPA_40, LV_PART_MAIN);
    lv_obj_add_flag(s_btn, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(s_btn, LV_OBJ_FLAG_SCROLLABLE);

    // Touch events
    lv_obj_add_event_cb(s_btn, btn_event_cb, LV_EVENT_PRESSED, nullptr);
    lv_obj_add_event_cb(s_btn, btn_event_cb, LV_EVENT_RELEASED, nullptr);
    lv_obj_add_event_cb(s_btn, btn_event_cb, LV_EVENT_PRESS_LOST, nullptr);

    // Mic icon label (LV_SYMBOL_AUDIO or fallback)
    s_icon_label = lv_label_create(s_btn);
    lv_label_set_text(s_icon_label, LV_SYMBOL_AUDIO);
    lv_obj_set_style_text_color(s_icon_label, CLR_IDLE_ICON, LV_PART_MAIN);
    lv_obj_set_style_text_font(s_icon_label, &lv_font_montserrat_24, LV_PART_MAIN);
    lv_obj_center(s_icon_label);

    // Waveform ring (line object, hidden by default)
    s_waveform_obj = lv_line_create(parent);
    lv_obj_set_style_line_color(s_waveform_obj, CLR_REC_PULSE, LV_PART_MAIN);
    lv_obj_set_style_line_width(s_waveform_obj, 2, LV_PART_MAIN);
    lv_obj_set_style_line_opa(s_waveform_obj, LV_OPA_70, LV_PART_MAIN);
    lv_obj_set_style_line_rounded(s_waveform_obj, true, LV_PART_MAIN);
    // Initialize points at rest position
    for (uint8_t i = 0; i <= WAVEFORM_POINTS; i++) {
        s_wave_pts[i].x = 0;
        s_wave_pts[i].y = 0;
    }
    lv_line_set_points(s_waveform_obj, s_wave_pts, WAVEFORM_POINTS + 1);
    lv_obj_add_flag(s_waveform_obj, LV_OBJ_FLAG_HIDDEN);

    // Processing spinner arc (hidden by default)
    s_spinner_arc = lv_arc_create(parent);
    lv_obj_set_size(s_spinner_arc, BTN_DIAMETER + 20, BTN_DIAMETER + 20);
    lv_arc_set_rotation(s_spinner_arc, 0);
    lv_arc_set_bg_angles(s_spinner_arc, 0, 360);
    lv_arc_set_angles(s_spinner_arc, 0, 90);
    lv_obj_set_style_arc_color(s_spinner_arc, CLR_PROC_ARC, LV_PART_INDICATOR);
    lv_obj_set_style_arc_width(s_spinner_arc, 3, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(s_spinner_arc, lv_color_make(20, 20, 30), LV_PART_MAIN);
    lv_obj_set_style_arc_width(s_spinner_arc, 3, LV_PART_MAIN);
    lv_obj_set_style_arc_opa(s_spinner_arc, LV_OPA_30, LV_PART_MAIN);
    lv_obj_remove_style(s_spinner_arc, nullptr, LV_PART_KNOB);
    lv_obj_remove_flag(s_spinner_arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(s_spinner_arc, LV_OBJ_FLAG_HIDDEN);

    s_state = State::IDLE;
    Serial.println("[MIC_BTN] Created");
}

void destroy() {
    if (s_btn) { lv_obj_delete(s_btn); s_btn = nullptr; }
    if (s_waveform_obj) { lv_obj_delete(s_waveform_obj); s_waveform_obj = nullptr; }
    if (s_spinner_arc) { lv_obj_delete(s_spinner_arc); s_spinner_arc = nullptr; }
    s_icon_label = nullptr;
    s_state = State::IDLE;
    s_callback = nullptr;
}

void update() {
    if (!s_btn) return;

    switch (s_state) {
        case State::IDLE:
            break;

        case State::RECORDING: {
            // Poll mic level for waveform
            HAL::Mic::pollLevel();
            update_waveform_ring();
            update_pulse();

            // Check max recording time
            if (millis() - s_record_start_ms >= s_max_record_ms) {
                Serial.println("[MIC_BTN] Max recording time reached");
                stop_recording();
            }
            break;
        }

        case State::PROCESSING:
            update_spinner();
            break;
    }
}

State getState() {
    return s_state;
}

void setState(State state) {
    if (state == s_state) return;

    s_state = state;

    switch (state) {
        case State::IDLE:
            if (s_btn) {
                lv_obj_set_style_bg_color(s_btn, CLR_IDLE_BG, LV_PART_MAIN);
                lv_obj_set_style_bg_opa(s_btn, LV_OPA_COVER, LV_PART_MAIN);
                lv_obj_set_style_border_color(s_btn,
                    lv_color_make(80, 80, 100), LV_PART_MAIN);
            }
            if (s_icon_label) {
                lv_obj_set_style_text_color(s_icon_label, CLR_IDLE_ICON, LV_PART_MAIN);
            }
            if (s_waveform_obj) lv_obj_add_flag(s_waveform_obj, LV_OBJ_FLAG_HIDDEN);
            if (s_spinner_arc)  lv_obj_add_flag(s_spinner_arc, LV_OBJ_FLAG_HIDDEN);
            break;

        case State::RECORDING:
            // Typically set via touch event, not externally
            break;

        case State::PROCESSING:
            if (s_btn) {
                lv_obj_set_style_bg_color(s_btn, CLR_PROC_BG, LV_PART_MAIN);
            }
            if (s_waveform_obj) lv_obj_add_flag(s_waveform_obj, LV_OBJ_FLAG_HIDDEN);
            if (s_spinner_arc)  lv_obj_remove_flag(s_spinner_arc, LV_OBJ_FLAG_HIDDEN);
            break;
    }
}

void setRecordingDoneCallback(RecordingDoneCallback cb) {
    s_callback = cb;
}

lv_obj_t* getButton() {
    return s_btn;
}

void setMaxRecordingMs(uint32_t ms) {
    s_max_record_ms = ms;
}

} // namespace MicButton
} // namespace UI
