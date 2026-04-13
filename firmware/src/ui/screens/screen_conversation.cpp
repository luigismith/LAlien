/**
 * screen_conversation.cpp -- Chat/conversation screen with push-to-talk
 *
 * Full conversation UI:
 *   - Scrollable message history (top 70%)
 *   - Text input area with virtual keyboard
 *   - Push-to-talk mic button (large, centered at bottom)
 *   - STT integration: hold mic to record, release to transcribe
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_conversation.h"
#include "../theme.h"
#include "../widgets/mic_button.h"
#include "../widgets/status_bar.h"
#include "../ui_manager.h"
#include "../../ai/stt_client.h"
#include "../../ai/llm_client.h"
#include "../../pet/pet.h"
#include "../../pet/needs.h"
#include "../../network/wifi_manager.h"
#include "lvgl.h"

// ---- Layout ----
static constexpr int16_t SCREEN_W         = 800;
static constexpr int16_t SCREEN_H         = 480;
static constexpr int16_t STATUS_BAR_H     = 32;
static constexpr int16_t HISTORY_Y        = STATUS_BAR_H + 4;
static constexpr int16_t HISTORY_H        = 260;
static constexpr int16_t INPUT_AREA_Y     = HISTORY_Y + HISTORY_H + 4;
static constexpr int16_t INPUT_AREA_H     = 44;
static constexpr int16_t BOTTOM_BAR_Y     = INPUT_AREA_Y + INPUT_AREA_H + 4;
static constexpr int16_t BOTTOM_BAR_H     = SCREEN_H - BOTTOM_BAR_Y;
static constexpr int16_t MSG_MAX_WIDTH    = 520;
static constexpr uint8_t MAX_VISIBLE_MSGS = 20;
static constexpr int16_t KB_HEIGHT        = 140;

// ---- Message entry ----
struct ChatMessage {
    char text[256];
    bool is_user;      // true = user, false = pet
};

static ChatMessage s_messages[MAX_VISIBLE_MSGS];
static uint8_t s_msg_count = 0;

// ---- LVGL objects ----
static lv_obj_t* screen         = nullptr;
static lv_obj_t* back_btn       = nullptr;
static lv_obj_t* title_label    = nullptr;
static lv_obj_t* history_panel  = nullptr;
static lv_obj_t* input_textarea = nullptr;
static lv_obj_t* send_btn       = nullptr;
static lv_obj_t* keyboard       = nullptr;
static lv_obj_t* mic_area       = nullptr;
static lv_obj_t* recording_time = nullptr; // label showing recording duration
static lv_obj_t* stt_status     = nullptr; // status text during processing

static bool kb_visible = false;

// ---- Forward declarations ----
static void add_message_bubble(const char* text, bool is_user);
static void send_text_input();
static void on_recording_done(const int16_t* data, uint32_t sample_count);

// ---- Callbacks ----

static void back_btn_cb(lv_event_t* e) {
    (void)e;
    // Hide keyboard if open
    if (kb_visible && keyboard) {
        lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
        kb_visible = false;
    }
    UI::Manager::showScreen(UI::Manager::Screen::MAIN);
}

static void send_btn_cb(lv_event_t* e) {
    (void)e;
    send_text_input();
}

static void textarea_focused_cb(lv_event_t* e) {
    (void)e;
    if (keyboard && !kb_visible) {
        lv_obj_remove_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
        kb_visible = true;
        // Shrink history to make room
        if (history_panel) {
            lv_obj_set_height(history_panel, HISTORY_H - KB_HEIGHT);
        }
    }
}

static void textarea_defocused_cb(lv_event_t* e) {
    (void)e;
    if (keyboard && kb_visible) {
        lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
        kb_visible = false;
        if (history_panel) {
            lv_obj_set_height(history_panel, HISTORY_H);
        }
    }
}

static void kb_event_cb(lv_event_t* e) {
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_READY) {
        // Enter key pressed on keyboard
        send_text_input();
        if (keyboard) {
            lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
            kb_visible = false;
            if (history_panel) {
                lv_obj_set_height(history_panel, HISTORY_H);
            }
        }
    } else if (code == LV_EVENT_CANCEL) {
        if (keyboard) {
            lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
            kb_visible = false;
            if (history_panel) {
                lv_obj_set_height(history_panel, HISTORY_H);
            }
        }
    }
}

// ---- Message handling ----

static void send_text_input() {
    if (!input_textarea) return;

    const char* text = lv_textarea_get_text(input_textarea);
    if (!text || strlen(text) == 0) return;

    // Add user message bubble
    add_message_bubble(text, true);

    // Store the text before clearing
    char input_copy[256];
    strncpy(input_copy, text, sizeof(input_copy) - 1);
    input_copy[sizeof(input_copy) - 1] = '\0';

    // Clear input
    lv_textarea_set_text(input_textarea, "");

    Serial.print("[CHAT] User sent: ");
    Serial.println(input_copy);

    // TODO: Feed input_copy to LLM client for response
    // AI::LLMClient::sendMessage(input_copy);
}

static void add_message_bubble(const char* text, bool is_user) {
    if (!history_panel || s_msg_count >= MAX_VISIBLE_MSGS) return;

    // Store in buffer
    strncpy(s_messages[s_msg_count].text, text, sizeof(s_messages[0].text) - 1);
    s_messages[s_msg_count].text[sizeof(s_messages[0].text) - 1] = '\0';
    s_messages[s_msg_count].is_user = is_user;
    s_msg_count++;

    // Create message bubble LVGL object
    lv_obj_t* bubble = lv_obj_create(history_panel);
    lv_obj_set_width(bubble, LV_SIZE_CONTENT);
    lv_obj_set_style_max_width(bubble, MSG_MAX_WIDTH, LV_PART_MAIN);
    lv_obj_set_height(bubble, LV_SIZE_CONTENT);
    lv_obj_set_style_pad_all(bubble, 10, LV_PART_MAIN);
    lv_obj_set_style_radius(bubble, 12, LV_PART_MAIN);
    lv_obj_remove_flag(bubble, LV_OBJ_FLAG_SCROLLABLE);

    if (is_user) {
        // User: right-aligned, night blue background
        lv_obj_set_style_bg_color(bubble,
            lv_color_make(20, 45, 70), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bubble, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_border_color(bubble,
            lv_color_make(60, 120, 180), LV_PART_MAIN);
        lv_obj_set_style_border_width(bubble, 1, LV_PART_MAIN);
        lv_obj_set_style_border_opa(bubble, LV_OPA_40, LV_PART_MAIN);
    } else {
        // Pet: left-aligned, dark with gold accent
        lv_obj_set_style_bg_color(bubble,
            lv_color_make(10, 18, 30), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bubble, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_border_color(bubble,
            lv_color_make(212, 165, 52), LV_PART_MAIN);
        lv_obj_set_style_border_width(bubble, 1, LV_PART_MAIN);
        lv_obj_set_style_border_opa(bubble, LV_OPA_30, LV_PART_MAIN);
    }

    // Text label inside bubble
    lv_obj_t* lbl = lv_label_create(bubble);
    lv_label_set_text(lbl, text);
    lv_label_set_long_mode(lbl, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(lbl, MSG_MAX_WIDTH - 24);
    lv_obj_set_style_text_color(lbl,
        lv_color_make(230, 225, 210), LV_PART_MAIN);
    lv_obj_set_style_text_font(lbl,
        &lv_font_montserrat_14, LV_PART_MAIN);

    // Scroll to bottom
    lv_obj_scroll_to_y(history_panel, LV_COORD_MAX, LV_ANIM_ON);
}

// STT callback: called when mic recording is done
static void on_recording_done(const int16_t* data, uint32_t sample_count) {
    if (!data || sample_count == 0) {
        UI::MicButton::setState(UI::MicButton::State::IDLE);
        return;
    }

    // Show processing status
    if (stt_status) {
        lv_label_set_text(stt_status, "Trascrivo...");
        lv_obj_remove_flag(stt_status, LV_OBJ_FLAG_HIDDEN);
    }

    // Send to STT client (async)
    AI::STTClient::transcribe(data, sample_count);

    Serial.print("[CHAT] Audio sent to STT, samples=");
    Serial.println(sample_count);
}

// ---- Public API ----

namespace UI {
namespace ScreenConversation {

void create() {
    screen = lv_obj_create(nullptr);
    lv_obj_set_size(screen, SCREEN_W, SCREEN_H);
    lv_obj_set_style_bg_color(screen, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // --- Status bar ---
    StatusBar::create(screen);

    // --- Title ---
    title_label = lv_label_create(screen);
    lv_label_set_text(title_label, "Conversazione");
    lv_obj_set_style_text_color(title_label,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(title_label,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_align(title_label, LV_ALIGN_TOP_MID, 0, STATUS_BAR_H + 2);
    lv_obj_add_flag(title_label, LV_OBJ_FLAG_HIDDEN); // hidden, status bar shows name

    // --- Back button ---
    back_btn = lv_button_create(screen);
    lv_obj_set_size(back_btn, 56, 30);
    lv_obj_set_pos(back_btn, 8, STATUS_BAR_H + 4);
    lv_obj_set_style_bg_color(back_btn,
        lv_color_make(15, 25, 40), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(back_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(back_btn, 8, LV_PART_MAIN);
    lv_obj_set_style_border_color(back_btn,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_border_width(back_btn, 1, LV_PART_MAIN);
    lv_obj_set_style_border_opa(back_btn, LV_OPA_40, LV_PART_MAIN);
    lv_obj_add_event_cb(back_btn, back_btn_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* back_lbl = lv_label_create(back_btn);
    lv_label_set_text(back_lbl, LV_SYMBOL_LEFT);
    lv_obj_set_style_text_color(back_lbl,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_center(back_lbl);

    // --- Message history panel (scrollable) ---
    history_panel = lv_obj_create(screen);
    lv_obj_remove_style_all(history_panel);
    lv_obj_set_size(history_panel, SCREEN_W - 80, HISTORY_H);
    lv_obj_set_pos(history_panel, 70, HISTORY_Y);
    lv_obj_set_style_bg_color(history_panel,
        lv_color_make(2, 5, 12), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(history_panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(history_panel, 8, LV_PART_MAIN);
    lv_obj_set_style_pad_all(history_panel, 8, LV_PART_MAIN);
    lv_obj_set_style_pad_row(history_panel, 6, LV_PART_MAIN);
    lv_obj_set_flex_flow(history_panel, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(history_panel, LV_FLEX_ALIGN_END,
                          LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_START);
    // Enable vertical scrolling
    lv_obj_add_flag(history_panel, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_scroll_dir(history_panel, LV_DIR_VER);
    lv_obj_set_style_scrollbar_mode(history_panel,
        LV_SCROLLBAR_MODE_AUTO, LV_PART_SCROLLBAR);

    // --- Text input area ---
    input_textarea = lv_textarea_create(screen);
    lv_obj_set_size(input_textarea, SCREEN_W - 200, INPUT_AREA_H);
    lv_obj_set_pos(input_textarea, 70, INPUT_AREA_Y);
    lv_textarea_set_placeholder_text(input_textarea, "Scrivi un messaggio...");
    lv_textarea_set_one_line(input_textarea, true);
    lv_obj_set_style_bg_color(input_textarea,
        lv_color_make(10, 18, 30), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(input_textarea, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_text_color(input_textarea,
        lv_color_make(220, 215, 200), LV_PART_MAIN);
    lv_obj_set_style_text_font(input_textarea,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_border_color(input_textarea,
        lv_color_make(80, 80, 100), LV_PART_MAIN);
    lv_obj_set_style_border_width(input_textarea, 1, LV_PART_MAIN);
    lv_obj_set_style_radius(input_textarea, 8, LV_PART_MAIN);
    lv_obj_set_style_pad_all(input_textarea, 8, LV_PART_MAIN);
    lv_obj_add_event_cb(input_textarea, textarea_focused_cb,
        LV_EVENT_FOCUSED, nullptr);
    lv_obj_add_event_cb(input_textarea, textarea_defocused_cb,
        LV_EVENT_DEFOCUSED, nullptr);

    // --- Send button ---
    send_btn = lv_button_create(screen);
    lv_obj_set_size(send_btn, 50, INPUT_AREA_H);
    lv_obj_set_pos(send_btn, SCREEN_W - 200 + 70 + 6, INPUT_AREA_Y);
    lv_obj_set_style_bg_color(send_btn,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(send_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(send_btn, 8, LV_PART_MAIN);
    lv_obj_add_event_cb(send_btn, send_btn_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* send_lbl = lv_label_create(send_btn);
    lv_label_set_text(send_lbl, LV_SYMBOL_RIGHT);
    lv_obj_set_style_text_color(send_lbl,
        lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_center(send_lbl);

    // --- Bottom area: mic button + STT status ---
    mic_area = lv_obj_create(screen);
    lv_obj_remove_style_all(mic_area);
    lv_obj_set_size(mic_area, SCREEN_W, BOTTOM_BAR_H);
    lv_obj_set_pos(mic_area, 0, BOTTOM_BAR_Y);
    lv_obj_set_style_bg_color(mic_area,
        lv_color_make(2, 5, 12), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(mic_area, LV_OPA_60, LV_PART_MAIN);
    lv_obj_remove_flag(mic_area, LV_OBJ_FLAG_SCROLLABLE);

    // Create mic button widget
    MicButton::create(mic_area);
    lv_obj_t* mic_btn = MicButton::getButton();
    if (mic_btn) {
        lv_obj_align(mic_btn, LV_ALIGN_CENTER, 0, -8);
    }
    MicButton::setRecordingDoneCallback(on_recording_done);

    // Recording time indicator
    recording_time = lv_label_create(mic_area);
    lv_label_set_text(recording_time, "");
    lv_obj_set_style_text_color(recording_time,
        lv_color_make(200, 60, 60), LV_PART_MAIN);
    lv_obj_set_style_text_font(recording_time,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_align(recording_time, LV_ALIGN_CENTER, 60, -8);

    // STT status label
    stt_status = lv_label_create(mic_area);
    lv_label_set_text(stt_status, "");
    lv_obj_set_style_text_color(stt_status,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(stt_status,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_align(stt_status, LV_ALIGN_BOTTOM_MID, 0, -4);
    lv_obj_add_flag(stt_status, LV_OBJ_FLAG_HIDDEN);

    // "Hold to speak" hint
    lv_obj_t* hint = lv_label_create(mic_area);
    lv_label_set_text(hint, "Tieni premuto per parlare");
    lv_obj_set_style_text_color(hint,
        lv_color_make(100, 100, 120), LV_PART_MAIN);
    lv_obj_set_style_text_font(hint,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -20);

    // --- Virtual keyboard (hidden by default) ---
    keyboard = lv_keyboard_create(screen);
    lv_obj_set_size(keyboard, SCREEN_W, KB_HEIGHT);
    lv_obj_align(keyboard, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_keyboard_set_textarea(keyboard, input_textarea);
    lv_obj_set_style_bg_color(keyboard,
        lv_color_make(8, 14, 24), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(keyboard, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_add_event_cb(keyboard, kb_event_cb, LV_EVENT_READY, nullptr);
    lv_obj_add_event_cb(keyboard, kb_event_cb, LV_EVENT_CANCEL, nullptr);
    lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);

    Serial.println("[CHAT] Screen created with PTT mic and keyboard");
}

void show() {
    if (screen) {
        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
        StatusBar::show();
    }
}

void hide() {
    if (kb_visible && keyboard) {
        lv_obj_add_flag(keyboard, LV_OBJ_FLAG_HIDDEN);
        kb_visible = false;
    }
    StatusBar::hide();
}

void update() {
    // Update mic button animations (pulse, waveform, spinner)
    MicButton::update();

    // Poll STT client for completed transcription
    AI::STTClient::poll();

    if (AI::STTClient::isReady()) {
        String transcription = AI::STTClient::getTranscription();

        // Reset mic button to idle
        MicButton::setState(MicButton::State::IDLE);

        // Hide STT status
        if (stt_status) {
            lv_obj_add_flag(stt_status, LV_OBJ_FLAG_HIDDEN);
        }

        if (transcription.length() > 0) {
            Serial.print("[CHAT] STT result: ");
            Serial.println(transcription);

            // Add as user message
            add_message_bubble(transcription.c_str(), true);

            // TODO: Feed to LLM client
            // AI::LLMClient::sendMessage(transcription.c_str());
        } else {
            Serial.println("[CHAT] STT returned empty transcription");
        }
    }

    // Update recording time display
    if (MicButton::getState() == MicButton::State::RECORDING) {
        if (recording_time) {
            // Show seconds elapsed (approximate)
            lv_label_set_text(recording_time, LV_SYMBOL_AUDIO);
            lv_obj_remove_flag(recording_time, LV_OBJ_FLAG_HIDDEN);
        }
    } else {
        if (recording_time) {
            lv_obj_add_flag(recording_time, LV_OBJ_FLAG_HIDDEN);
        }
    }
}

void handleTouch(const HAL::TouchEvent& event) {
    (void)event;
    // LVGL handles touch via its own input device driver.
    // Additional gesture handling can go here if needed.
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenConversation
} // namespace UI
