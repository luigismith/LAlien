/**
 * screen_graveyard.cpp — Graveyard browser screen
 *
 * Displays memorial entries for past pets in a scrollable list.
 * Each entry shows the pet's name, stage reached, and age.
 * Tapping an entry opens a full memorial view with:
 *   - Name, stage reached, age in days
 *   - Cause of death (localized)
 *   - Last words
 *   - Vocabulary count
 *   - Personality traits
 * Transcended pets are highlighted with gold accent and star marker.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_graveyard.h"
#include "../theme.h"
#include "../../persistence/graveyard.h"
#include "../../pet/pet.h"
#include "lvgl.h"

// --- Screen objects ---
static lv_obj_t* screen         = nullptr;
static lv_obj_t* title_label    = nullptr;
static lv_obj_t* back_btn       = nullptr;
static lv_obj_t* list_container = nullptr;
static lv_obj_t* empty_label    = nullptr;

// --- Memorial detail panel ---
static lv_obj_t* memorial_panel      = nullptr;
static lv_obj_t* memorial_name       = nullptr;
static lv_obj_t* memorial_stage      = nullptr;
static lv_obj_t* memorial_age        = nullptr;
static lv_obj_t* memorial_cause      = nullptr;
static lv_obj_t* memorial_words      = nullptr;
static lv_obj_t* memorial_vocab      = nullptr;
static lv_obj_t* memorial_personality = nullptr;
static lv_obj_t* memorial_close_btn  = nullptr;
static lv_obj_t* memorial_transcend  = nullptr;

static bool s_memorial_visible = false;
static constexpr uint8_t MAX_DISPLAY = 50;

// --- Cause of death localization ---
static const char* localizeCause(const char* cause) {
    if (strcmp(cause, "velin") == 0)         return "Velin (disperazione)";
    if (strcmp(cause, "zevol") == 0)         return "Zevol (malattia)";
    if (strcmp(cause, "morak") == 0)         return "Morak (trauma)";
    if (strcmp(cause, "rena_thishi") == 0)   return "Ren'a-thishi (richiamo cosmico)";
    if (strcmp(cause, "old_age") == 0)       return "Vecchiaia naturale";
    if (strcmp(cause, "transcendence") == 0) return "Trascendenza";
    if (strcmp(cause, "farewell") == 0)      return "Addio del custode";
    return cause;
}

// --- Stage name helper ---
static const char* stageNameFromIndex(uint8_t idx) {
    return Pet::getStageNameFor((Pet::Stage)idx);
}

// --- Callbacks ---
static void back_btn_cb(lv_event_t* e) {
    (void)e;
    if (s_memorial_visible) {
        lv_obj_add_flag(memorial_panel, LV_OBJ_FLAG_HIDDEN);
        s_memorial_visible = false;
    } else {
        Serial.println("[GRAVEYARD] Back pressed");
        // Navigation handled by UI manager
    }
}

static void entry_clicked_cb(lv_event_t* e) {
    uint8_t index = (uint8_t)(uintptr_t)lv_event_get_user_data(e);

    Persistence::Graveyard::GraveEntry entry;
    if (!Persistence::Graveyard::getEntry(index, entry)) return;

    // Populate memorial panel
    lv_label_set_text(memorial_name, entry.name);

    // Stage
    String stage_str = "Stadio: ";
    stage_str += stageNameFromIndex(entry.stage_reached);
    lv_label_set_text(memorial_stage, stage_str.c_str());

    // Age
    uint32_t days = entry.age_hours / 24;
    uint32_t remaining_hours = entry.age_hours % 24;
    String age_str = "Eta: ";
    age_str += String(days);
    age_str += " giorni, ";
    age_str += String(remaining_hours);
    age_str += " ore";
    lv_label_set_text(memorial_age, age_str.c_str());

    // Cause
    String cause_str = "Causa: ";
    cause_str += localizeCause(entry.cause);
    lv_label_set_text(memorial_cause, cause_str.c_str());

    // Last words
    String words_str = "Ultime parole:\n\"";
    words_str += entry.last_words;
    words_str += "\"";
    lv_label_set_text(memorial_words, words_str.c_str());

    // Vocabulary
    String vocab_str = "Parole imparate: ";
    vocab_str += String(entry.words_learned);
    lv_label_set_text(memorial_vocab, vocab_str.c_str());

    // Personality
    if (strlen(entry.personality) > 0) {
        String pers_str = "Tratti: ";
        pers_str += entry.personality;
        lv_label_set_text(memorial_personality, pers_str.c_str());
        lv_obj_remove_flag(memorial_personality, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(memorial_personality, LV_OBJ_FLAG_HIDDEN);
    }

    // Transcendence marker
    if (entry.transcended) {
        lv_label_set_text(memorial_transcend,
            "* Trasceso * - Spirito guardiano");
        lv_obj_set_style_text_color(memorial_transcend,
            lv_color_make(212, 165, 52), LV_PART_MAIN); // gold
        lv_obj_remove_flag(memorial_transcend, LV_OBJ_FLAG_HIDDEN);

        // Gold name for transcended
        lv_obj_set_style_text_color(memorial_name,
            lv_color_make(212, 165, 52), LV_PART_MAIN);
    } else {
        lv_obj_add_flag(memorial_transcend, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_text_color(memorial_name,
            lv_color_make(156, 211, 200), LV_PART_MAIN);
    }

    // Show the panel
    lv_obj_remove_flag(memorial_panel, LV_OBJ_FLAG_HIDDEN);
    s_memorial_visible = true;
}

static void memorial_close_cb(lv_event_t* e) {
    (void)e;
    lv_obj_add_flag(memorial_panel, LV_OBJ_FLAG_HIDDEN);
    s_memorial_visible = false;
}

// --- Build the entry list ---
static void buildList() {
    // Clear existing list children (except the container itself)
    if (list_container) {
        lv_obj_clean(list_container);
    }

    uint8_t count = Persistence::Graveyard::getCount();

    if (count == 0) {
        if (empty_label) {
            lv_obj_remove_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
        }
        return;
    }

    if (empty_label) {
        lv_obj_add_flag(empty_label, LV_OBJ_FLAG_HIDDEN);
    }

    // Display entries in reverse order (newest first)
    for (int16_t i = count - 1; i >= 0; i--) {
        Persistence::Graveyard::GraveEntry entry;
        if (!Persistence::Graveyard::getEntry((uint8_t)i, entry)) continue;

        // Create entry button
        lv_obj_t* btn = lv_button_create(list_container);
        lv_obj_set_size(btn, 720, 56);
        lv_obj_set_style_bg_color(btn,
            lv_color_make(20, 20, 30), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(btn, 8, LV_PART_MAIN);
        lv_obj_set_style_border_width(btn, 1, LV_PART_MAIN);

        // Gold border for transcended, dim gray for others
        if (entry.transcended) {
            lv_obj_set_style_border_color(btn,
                lv_color_make(212, 165, 52), LV_PART_MAIN);
            lv_obj_set_style_border_opa(btn, LV_OPA_70, LV_PART_MAIN);
        } else {
            lv_obj_set_style_border_color(btn,
                lv_color_make(60, 60, 80), LV_PART_MAIN);
            lv_obj_set_style_border_opa(btn, LV_OPA_50, LV_PART_MAIN);
        }

        lv_obj_add_event_cb(btn, entry_clicked_cb, LV_EVENT_CLICKED,
            (void*)(uintptr_t)i);

        // Name label
        lv_obj_t* name_lbl = lv_label_create(btn);
        String display_name = "";
        if (entry.transcended) {
            display_name += "* ";
        }
        display_name += entry.name;
        lv_label_set_text(name_lbl, display_name.c_str());
        lv_obj_set_style_text_font(name_lbl,
            &lv_font_montserrat_14, LV_PART_MAIN);

        if (entry.transcended) {
            lv_obj_set_style_text_color(name_lbl,
                lv_color_make(212, 165, 52), LV_PART_MAIN);
        } else {
            lv_obj_set_style_text_color(name_lbl,
                lv_color_make(156, 211, 200), LV_PART_MAIN);
        }
        lv_obj_align(name_lbl, LV_ALIGN_LEFT_MID, 12, -8);

        // Info line: stage + age
        lv_obj_t* info_lbl = lv_label_create(btn);
        String info = stageNameFromIndex(entry.stage_reached);
        info += " - ";
        info += String(entry.age_hours / 24);
        info += " giorni - ";
        info += localizeCause(entry.cause);
        lv_label_set_text(info_lbl, info.c_str());
        lv_obj_set_style_text_font(info_lbl,
            &lv_font_montserrat_12, LV_PART_MAIN);
        lv_obj_set_style_text_color(info_lbl,
            lv_color_make(120, 120, 140), LV_PART_MAIN);
        lv_obj_align(info_lbl, LV_ALIGN_LEFT_MID, 12, 10);
    }
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

    // Scrollable list container
    list_container = lv_obj_create(screen);
    lv_obj_set_size(list_container, 760, 400);
    lv_obj_align(list_container, LV_ALIGN_TOP_MID, 0, 56);
    lv_obj_set_style_bg_opa(list_container, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_border_width(list_container, 0, LV_PART_MAIN);
    lv_obj_set_flex_flow(list_container, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_flex_align(list_container,
        LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_row(list_container, 8, LV_PART_MAIN);
    lv_obj_set_style_pad_top(list_container, 4, LV_PART_MAIN);

    // Empty state label
    empty_label = lv_label_create(screen);
    lv_label_set_text(empty_label,
        "Nessun ricordo ancora...\n\n"
        "Qui riposano i lalien che hanno\n"
        "condiviso il viaggio con te.");
    lv_obj_set_style_text_color(empty_label,
        lv_color_make(100, 100, 120), LV_PART_MAIN);
    lv_obj_set_style_text_font(empty_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_align(empty_label,
        LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_align(empty_label, LV_ALIGN_CENTER, 0, 0);

    // --- Memorial detail panel (hidden by default) ---
    memorial_panel = lv_obj_create(screen);
    lv_obj_set_size(memorial_panel, 700, 420);
    lv_obj_align(memorial_panel, LV_ALIGN_CENTER, 0, 10);
    lv_obj_set_style_bg_color(memorial_panel,
        lv_color_make(10, 10, 18), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(memorial_panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(memorial_panel, 12, LV_PART_MAIN);
    lv_obj_set_style_border_width(memorial_panel, 2, LV_PART_MAIN);
    lv_obj_set_style_border_color(memorial_panel,
        lv_color_make(60, 60, 80), LV_PART_MAIN);
    lv_obj_set_style_pad_all(memorial_panel, 20, LV_PART_MAIN);
    lv_obj_set_flex_flow(memorial_panel, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(memorial_panel, 6, LV_PART_MAIN);
    lv_obj_add_flag(memorial_panel, LV_OBJ_FLAG_HIDDEN);

    // Close button for memorial
    memorial_close_btn = lv_button_create(memorial_panel);
    lv_obj_set_size(memorial_close_btn, 40, 30);
    lv_obj_set_style_bg_color(memorial_close_btn,
        lv_color_make(40, 40, 60), LV_PART_MAIN);
    lv_obj_add_event_cb(memorial_close_btn, memorial_close_cb,
        LV_EVENT_CLICKED, nullptr);
    lv_obj_t* close_lbl = lv_label_create(memorial_close_btn);
    lv_label_set_text(close_lbl, LV_SYMBOL_CLOSE);
    lv_obj_center(close_lbl);

    // Transcendence marker (shown only for transcended pets)
    memorial_transcend = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_transcend, "");
    lv_obj_set_style_text_font(memorial_transcend,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_add_flag(memorial_transcend, LV_OBJ_FLAG_HIDDEN);

    // Name
    memorial_name = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_name, "");
    lv_obj_set_style_text_font(memorial_name,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_name,
        lv_color_make(156, 211, 200), LV_PART_MAIN);

    // Stage
    memorial_stage = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_stage, "");
    lv_obj_set_style_text_font(memorial_stage,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_stage,
        lv_color_make(180, 180, 200), LV_PART_MAIN);

    // Age
    memorial_age = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_age, "");
    lv_obj_set_style_text_font(memorial_age,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_age,
        lv_color_make(180, 180, 200), LV_PART_MAIN);

    // Cause
    memorial_cause = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_cause, "");
    lv_obj_set_style_text_font(memorial_cause,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_cause,
        lv_color_make(180, 180, 200), LV_PART_MAIN);

    // Vocabulary
    memorial_vocab = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_vocab, "");
    lv_obj_set_style_text_font(memorial_vocab,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_vocab,
        lv_color_make(180, 180, 200), LV_PART_MAIN);

    // Personality
    memorial_personality = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_personality, "");
    lv_obj_set_style_text_font(memorial_personality,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_personality,
        lv_color_make(160, 160, 180), LV_PART_MAIN);

    // Last words (larger, italic feel — uses regular font but indented)
    memorial_words = lv_label_create(memorial_panel);
    lv_label_set_text(memorial_words, "");
    lv_obj_set_style_text_font(memorial_words,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_color(memorial_words,
        lv_color_make(200, 200, 220), LV_PART_MAIN);
    lv_obj_set_width(memorial_words, 640);
    lv_label_set_long_mode(memorial_words, LV_LABEL_LONG_WRAP);

    Serial.println("[GRAVEYARD] Screen created");
}

void show() {
    if (screen) {
        refresh();
        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
    }
}

void hide() {
    // Hide memorial if open
    if (s_memorial_visible && memorial_panel) {
        lv_obj_add_flag(memorial_panel, LV_OBJ_FLAG_HIDDEN);
        s_memorial_visible = false;
    }
}

void update() {
    // Nothing dynamic to update — list is rebuilt on show/refresh
}

void handleTouch(const HAL::TouchEvent& event) {
    (void)event;
    // Touch is handled by LVGL event callbacks
}

lv_obj_t* getScreen() {
    return screen;
}

void refresh() {
    buildList();
}

} // namespace ScreenGraveyard
} // namespace UI
