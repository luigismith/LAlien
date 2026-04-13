/**
 * screen_lexicon.cpp — Lalien Lexicon screen
 *
 * Displays all alien words the creature has learned in a scrollable list.
 * Each entry shows: lalien word, meaning in current locale, stage, frequency.
 * Tap a word to expand detail panel with phonetic hint and notes.
 * Filter by category or evolution stage.
 * Shows total words learned vs total available at the top.
 *
 * Words are loaded from /lang/alien.json on SD card and cross-referenced
 * with the pet's learned vocabulary stored in persistence.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_lexicon.h"
#include "../theme.h"
#include "../ui_manager.h"
#include "../../i18n/i18n.h"
#include "../../pet/pet.h"
#include "../../hal/sd_card.h"
#include "lvgl.h"
#include <ArduinoJson.h>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

static constexpr int SCREEN_W = 800;
static constexpr int SCREEN_H = 480;
static constexpr int MAX_WORDS = 150;

/// Category filter options
static const char* CATEGORY_FILTERS[] = {
    "all", "core", "emotions", "nature", "time", "relationships",
    "abstractions", "actions", "body", "lore", "descriptors",
    "greetings", "needs", "exclamations"
};
static constexpr size_t NUM_CATEGORIES = sizeof(CATEGORY_FILTERS) / sizeof(CATEGORY_FILTERS[0]);

// ---------------------------------------------------------------------------
// Word entry data (loaded from alien.json)
// ---------------------------------------------------------------------------

struct LexiconWord {
    char word[32];
    char meaning[64];       // in current locale
    char phonetic[32];
    char category[20];
    uint8_t stage;
    bool learned;           // has the pet used this word?
    uint16_t frequency;     // how many times used
};

static LexiconWord words[MAX_WORDS];
static size_t wordCount = 0;
static size_t learnedCount = 0;

// ---------------------------------------------------------------------------
// LVGL objects
// ---------------------------------------------------------------------------

static lv_obj_t* screen         = nullptr;
static lv_obj_t* title_label    = nullptr;
static lv_obj_t* counter_label  = nullptr;
static lv_obj_t* back_btn       = nullptr;
static lv_obj_t* filter_dropdown = nullptr;
static lv_obj_t* word_list      = nullptr;
static lv_obj_t* detail_panel   = nullptr;
static lv_obj_t* detail_word    = nullptr;
static lv_obj_t* detail_meaning = nullptr;
static lv_obj_t* detail_phonetic = nullptr;
static lv_obj_t* detail_category = nullptr;
static lv_obj_t* detail_stage   = nullptr;

static size_t currentFilter = 0;  // 0 = "all"

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

static void back_btn_cb(lv_event_t* e) {
    (void)e;
    UI::Manager::showMainScreen();
}

static void filter_changed_cb(lv_event_t* e) {
    (void)e;
    currentFilter = lv_dropdown_get_selected(filter_dropdown);
    // Rebuild list with new filter — handled in update()
    // For immediate response, call rebuild directly
    extern void rebuildWordList();
    rebuildWordList();
}

static void word_btn_cb(lv_event_t* e) {
    lv_obj_t* btn = (lv_obj_t*)lv_event_get_target(e);
    size_t idx = (size_t)(uintptr_t)lv_event_get_user_data(e);

    if (idx >= wordCount) return;
    if (!words[idx].learned) return;  // don't show details for undiscovered words

    // Populate detail panel
    lv_label_set_text(detail_word, words[idx].word);
    lv_label_set_text(detail_meaning, words[idx].meaning);

    char phonetic_buf[48];
    snprintf(phonetic_buf, sizeof(phonetic_buf), "[%s]", words[idx].phonetic);
    lv_label_set_text(detail_phonetic, phonetic_buf);

    lv_label_set_text(detail_category, words[idx].category);

    char stage_buf[32];
    snprintf(stage_buf, sizeof(stage_buf), "Stage %d", words[idx].stage);
    lv_label_set_text(detail_stage, stage_buf);

    // Show detail panel
    lv_obj_remove_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);
}

static void detail_close_cb(lv_event_t* e) {
    (void)e;
    lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

/// Determine the meaning field key from current locale
static const char* getMeaningKey() {
    const char* lang = I18n::getCurrentLang();
    if (strcmp(lang, "it") == 0) return "meaning_it";
    if (strcmp(lang, "es") == 0) return "meaning_es";
    if (strcmp(lang, "fr") == 0) return "meaning_fr";
    if (strcmp(lang, "de") == 0) return "meaning_de";
    return "meaning_en";
}

/// Load alien vocabulary from SD card
static void loadAlienVocabulary() {
    wordCount = 0;
    learnedCount = 0;

    String content = HAL::SDCard::readFile("/lang/alien.json");
    if (content.length() == 0) {
        Serial.println("[LEXICON] Failed to read alien.json from SD");
        return;
    }

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, content);
    if (err) {
        Serial.print("[LEXICON] JSON parse error: ");
        Serial.println(err.c_str());
        return;
    }

    JsonArray arr = doc.as<JsonArray>();
    const char* meaningKey = getMeaningKey();
    uint8_t petStage = (uint8_t)Pet::getStage();

    for (JsonObject obj : arr) {
        if (wordCount >= MAX_WORDS) break;

        LexiconWord& w = words[wordCount];

        const char* wrd = obj["word"] | "";
        const char* mng = obj[meaningKey] | obj["meaning_en"] | "";
        const char* phn = obj["phonetic_hint"] | obj["ipa"] | "";
        const char* cat = obj["category"] | "unknown";
        uint8_t stg    = obj["stage_available"] | obj["unlocked_at_stage"] | 0;

        strncpy(w.word, wrd, sizeof(w.word) - 1);
        w.word[sizeof(w.word) - 1] = '\0';
        strncpy(w.meaning, mng, sizeof(w.meaning) - 1);
        w.meaning[sizeof(w.meaning) - 1] = '\0';
        strncpy(w.phonetic, phn, sizeof(w.phonetic) - 1);
        w.phonetic[sizeof(w.phonetic) - 1] = '\0';
        strncpy(w.category, cat, sizeof(w.category) - 1);
        w.category[sizeof(w.category) - 1] = '\0';

        w.stage = stg;
        w.learned = (stg <= petStage);  // Available if pet has reached the stage
        w.frequency = w.learned ? 1 : 0; // TODO: read actual frequency from persistence

        if (w.learned) learnedCount++;
        wordCount++;
    }

    Serial.print("[LEXICON] Loaded ");
    Serial.print(wordCount);
    Serial.print(" words, ");
    Serial.print(learnedCount);
    Serial.println(" learned");
}

// ---------------------------------------------------------------------------
// List building
// ---------------------------------------------------------------------------

void rebuildWordList() {
    if (!word_list) return;

    // Clear existing children
    lv_obj_clean(word_list);

    const char* filterCat = (currentFilter > 0 && currentFilter < NUM_CATEGORIES)
                            ? CATEGORY_FILTERS[currentFilter] : nullptr;

    size_t visibleCount = 0;

    for (size_t i = 0; i < wordCount; i++) {
        // Apply category filter
        if (filterCat && strcmp(words[i].category, filterCat) != 0) {
            continue;
        }

        // Create list button
        lv_obj_t* btn = lv_list_add_button(word_list, nullptr, nullptr);
        lv_obj_set_size(btn, LV_PCT(100), 44);
        lv_obj_set_style_bg_color(btn, lv_color_make(20, 20, 30), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(btn, LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_border_width(btn, 0, LV_PART_MAIN);
        lv_obj_set_style_pad_all(btn, 6, LV_PART_MAIN);
        lv_obj_set_flex_flow(btn, LV_FLEX_FLOW_ROW);
        lv_obj_set_flex_align(btn, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

        if (words[i].learned) {
            // Word label (gold for learned words)
            lv_obj_t* word_lbl = lv_label_create(btn);
            lv_label_set_text(word_lbl, words[i].word);
            lv_obj_set_style_text_color(word_lbl,
                lv_color_make(212, 165, 52), LV_PART_MAIN);
            lv_obj_set_style_text_font(word_lbl,
                &lv_font_montserrat_14, LV_PART_MAIN);
            lv_obj_set_width(word_lbl, 180);

            // Meaning label (teal)
            lv_obj_t* meaning_lbl = lv_label_create(btn);
            lv_label_set_text(meaning_lbl, words[i].meaning);
            lv_obj_set_style_text_color(meaning_lbl,
                lv_color_make(156, 211, 200), LV_PART_MAIN);
            lv_obj_set_style_text_font(meaning_lbl,
                &lv_font_montserrat_12, LV_PART_MAIN);
            lv_obj_set_flex_grow(meaning_lbl, 1);

            // Stage indicator
            lv_obj_t* stage_lbl = lv_label_create(btn);
            char stage_txt[8];
            snprintf(stage_txt, sizeof(stage_txt), "S%d", words[i].stage);
            lv_label_set_text(stage_lbl, stage_txt);
            lv_obj_set_style_text_color(stage_lbl,
                lv_color_make(100, 100, 120), LV_PART_MAIN);
            lv_obj_set_style_text_font(stage_lbl,
                &lv_font_montserrat_12, LV_PART_MAIN);

            // Tap handler for details
            lv_obj_add_event_cb(btn, word_btn_cb, LV_EVENT_CLICKED,
                                (void*)(uintptr_t)i);
        } else {
            // Undiscovered word — show placeholder
            lv_obj_t* word_lbl = lv_label_create(btn);
            lv_label_set_text(word_lbl, "???");
            lv_obj_set_style_text_color(word_lbl,
                lv_color_make(60, 60, 80), LV_PART_MAIN);
            lv_obj_set_style_text_font(word_lbl,
                &lv_font_montserrat_14, LV_PART_MAIN);
            lv_obj_set_width(word_lbl, 180);

            lv_obj_t* meaning_lbl = lv_label_create(btn);
            lv_label_set_text(meaning_lbl, I18n::get("lexicon_undiscovered"));
            lv_obj_set_style_text_color(meaning_lbl,
                lv_color_make(60, 60, 80), LV_PART_MAIN);
            lv_obj_set_style_text_font(meaning_lbl,
                &lv_font_montserrat_12, LV_PART_MAIN);
        }

        visibleCount++;
    }

    // Update counter
    if (counter_label) {
        char buf[64];
        snprintf(buf, sizeof(buf), "%zu / %zu", learnedCount, wordCount);
        lv_label_set_text(counter_label, buf);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

namespace UI {
namespace ScreenLexicon {

void create() {
    // ---- Main screen container ----
    screen = lv_obj_create(nullptr);
    lv_obj_set_size(screen, SCREEN_W, SCREEN_H);
    lv_obj_set_style_bg_color(screen, lv_color_make(0, 0, 0), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // ---- Title ----
    title_label = lv_label_create(screen);
    lv_label_set_text(title_label, "Lexicon");
    lv_obj_set_style_text_color(title_label,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(title_label,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_align(title_label, LV_ALIGN_TOP_MID, 0, 16);

    // ---- Counter (learned / total) ----
    counter_label = lv_label_create(screen);
    lv_label_set_text(counter_label, "0 / 0");
    lv_obj_set_style_text_color(counter_label,
        lv_color_make(156, 211, 200), LV_PART_MAIN);
    lv_obj_set_style_text_font(counter_label,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_align(counter_label, LV_ALIGN_TOP_RIGHT, -80, 20);

    // ---- Back button ----
    back_btn = lv_button_create(screen);
    lv_obj_set_size(back_btn, 60, 36);
    lv_obj_align(back_btn, LV_ALIGN_TOP_LEFT, 10, 10);
    lv_obj_add_event_cb(back_btn, back_btn_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* back_lbl = lv_label_create(back_btn);
    lv_label_set_text(back_lbl, LV_SYMBOL_LEFT);
    lv_obj_center(back_lbl);

    // ---- Category filter dropdown ----
    filter_dropdown = lv_dropdown_create(screen);
    lv_dropdown_set_options(filter_dropdown,
        "All\n"
        "Core\n"
        "Emotions\n"
        "Nature\n"
        "Time\n"
        "Relationships\n"
        "Abstractions\n"
        "Actions\n"
        "Body\n"
        "Lore\n"
        "Descriptors\n"
        "Greetings\n"
        "Needs\n"
        "Exclamations");
    lv_obj_set_size(filter_dropdown, 160, 36);
    lv_obj_align(filter_dropdown, LV_ALIGN_TOP_RIGHT, -10, 10);
    lv_obj_set_style_bg_color(filter_dropdown,
        lv_color_make(30, 30, 50), LV_PART_MAIN);
    lv_obj_set_style_text_color(filter_dropdown,
        lv_color_make(156, 211, 200), LV_PART_MAIN);
    lv_obj_set_style_border_color(filter_dropdown,
        lv_color_make(80, 80, 120), LV_PART_MAIN);
    lv_obj_add_event_cb(filter_dropdown, filter_changed_cb,
                        LV_EVENT_VALUE_CHANGED, nullptr);

    // ---- Scrollable word list ----
    word_list = lv_list_create(screen);
    lv_obj_set_size(word_list, SCREEN_W - 20, SCREEN_H - 70);
    lv_obj_align(word_list, LV_ALIGN_BOTTOM_MID, 0, -10);
    lv_obj_set_style_bg_color(word_list,
        lv_color_make(10, 10, 18), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(word_list, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(word_list, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(word_list, 4, LV_PART_MAIN);

    // ---- Detail panel (hidden by default) ----
    detail_panel = lv_obj_create(screen);
    lv_obj_set_size(detail_panel, 400, 260);
    lv_obj_align(detail_panel, LV_ALIGN_CENTER, 0, 0);
    lv_obj_set_style_bg_color(detail_panel,
        lv_color_make(20, 20, 40), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(detail_panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_color(detail_panel,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_border_width(detail_panel, 2, LV_PART_MAIN);
    lv_obj_set_style_radius(detail_panel, 12, LV_PART_MAIN);
    lv_obj_set_style_pad_all(detail_panel, 20, LV_PART_MAIN);
    lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);

    // Detail: word
    detail_word = lv_label_create(detail_panel);
    lv_label_set_text(detail_word, "");
    lv_obj_set_style_text_color(detail_word,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_word,
        &lv_font_montserrat_20, LV_PART_MAIN);
    lv_obj_align(detail_word, LV_ALIGN_TOP_LEFT, 0, 0);

    // Detail: phonetic hint
    detail_phonetic = lv_label_create(detail_panel);
    lv_label_set_text(detail_phonetic, "");
    lv_obj_set_style_text_color(detail_phonetic,
        lv_color_make(120, 120, 150), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_phonetic,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_align(detail_phonetic, LV_ALIGN_TOP_LEFT, 0, 32);

    // Detail: meaning
    detail_meaning = lv_label_create(detail_panel);
    lv_label_set_text(detail_meaning, "");
    lv_obj_set_style_text_color(detail_meaning,
        lv_color_make(156, 211, 200), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_meaning,
        &lv_font_montserrat_16, LV_PART_MAIN);
    lv_obj_set_width(detail_meaning, 360);
    lv_label_set_long_mode(detail_meaning, LV_LABEL_LONG_WRAP);
    lv_obj_align(detail_meaning, LV_ALIGN_TOP_LEFT, 0, 60);

    // Detail: category
    detail_category = lv_label_create(detail_panel);
    lv_label_set_text(detail_category, "");
    lv_obj_set_style_text_color(detail_category,
        lv_color_make(100, 100, 120), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_category,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_align(detail_category, LV_ALIGN_TOP_LEFT, 0, 120);

    // Detail: stage
    detail_stage = lv_label_create(detail_panel);
    lv_label_set_text(detail_stage, "");
    lv_obj_set_style_text_color(detail_stage,
        lv_color_make(100, 100, 120), LV_PART_MAIN);
    lv_obj_set_style_text_font(detail_stage,
        &lv_font_montserrat_12, LV_PART_MAIN);
    lv_obj_align(detail_stage, LV_ALIGN_TOP_LEFT, 0, 140);

    // Detail: close button
    lv_obj_t* close_btn = lv_button_create(detail_panel);
    lv_obj_set_size(close_btn, 50, 30);
    lv_obj_align(close_btn, LV_ALIGN_BOTTOM_RIGHT, 0, 0);
    lv_obj_add_event_cb(close_btn, detail_close_cb, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* close_lbl = lv_label_create(close_btn);
    lv_label_set_text(close_lbl, LV_SYMBOL_CLOSE);
    lv_obj_center(close_lbl);

    Serial.println("[LEXICON] Screen created");
}

void show() {
    if (!screen) return;

    // Load vocabulary data and apply i18n title
    loadAlienVocabulary();

    if (title_label) {
        lv_label_set_text(title_label, I18n::get("lexicon_title"));
    }

    rebuildWordList();

    // Hide detail panel on show
    if (detail_panel) {
        lv_obj_add_flag(detail_panel, LV_OBJ_FLAG_HIDDEN);
    }

    lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_MOVE_LEFT, 300, 0, false);
}

void hide() {
    // Nothing to clean up — data persists until next show()
}

void update() {
    // No continuous updates needed — list is static once built
}

void handleTouch(const HAL::TouchEvent& event) {
    (void)event;
    // LVGL handles touch routing via its event system
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenLexicon
} // namespace UI
