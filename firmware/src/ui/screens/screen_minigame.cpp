/**
 * screen_minigame.cpp -- Mini-game screen LVGL rendering
 *
 * Renders the three bonding rituals using LVGL 9.x objects:
 *   1. Thishi-Revosh: circular resonance nodes around pet sprite
 *   2. Miska-Vythi:   dust particles, sparkle trail, progress bar
 *   3. Selath-Nashi:  starfield, star dots, constellation lines
 *
 * All LVGL objects are pre-allocated in create() and shown/hidden as needed.
 * No dynamic allocation during gameplay.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "screen_minigame.h"
#include "../sprite_engine.h"
#include "../theme.h"
#include "../ui_manager.h"
#include "../../pet/minigames.h"
#include "../../pet/pet.h"
#include "lvgl.h"

using namespace Pet::MiniGames;

// ============================================================
// Layout constants
// ============================================================
static constexpr int16_t SCR_W = 800;
static constexpr int16_t SCR_H = 480;

// ============================================================
// Common LVGL objects
// ============================================================
static lv_obj_t* screen      = nullptr;
static lv_obj_t* bg_panel    = nullptr;
static lv_obj_t* score_label = nullptr;
static lv_obj_t* title_label = nullptr;
static lv_obj_t* back_btn    = nullptr;
static lv_obj_t* msg_label   = nullptr;  // status/poetic text

static GameType active_game = GameType::ECHO_MEMORY;
static uint16_t end_timer   = 0; // ticks after game-over before returning
static bool     game_ended  = false;

// ============================================================
// Echo Memory LVGL objects
// ============================================================
static constexpr uint8_t ECHO_NODES = ECHO_NODE_COUNT;
static lv_obj_t* echo_nodes[ECHO_NODES]  = {nullptr};
static lv_obj_t* echo_level_label         = nullptr;
static constexpr int16_t ECHO_NODE_SIZE   = 48;

// Node center positions (screen coords, matching minigames.cpp)
static constexpr int16_t ECHO_CX = 368;
static constexpr int16_t ECHO_CY = 240;
static constexpr int16_t ECHO_R  = 150;

// Node palette colors (deep-sea luminescence)
static const lv_color_t echo_colors[ECHO_NODES] = {
    lv_color_make(62, 207, 207),   // cyan
    lv_color_make(143, 88, 214),   // violet
    lv_color_make(212, 165, 52),   // gold
    lv_color_make(52, 180, 120),   // teal-green
    lv_color_make(210, 80, 120),   // coral-rose
    lv_color_make(80, 140, 220),   // soft blue
};

static const lv_color_t echo_dim = lv_color_make(20, 35, 50);

// ============================================================
// Light Cleansing LVGL objects
// ============================================================
static lv_obj_t* clean_dust_objs[CLEAN_MAX_DUST] = {nullptr};
static lv_obj_t* clean_progress_bar = nullptr;
static lv_obj_t* clean_pct_label    = nullptr;
static constexpr int16_t DUST_SIZE  = 14;

// Sparkle effect: small temporary circles at last swipe position
static constexpr uint8_t SPARKLE_COUNT = 8;
static lv_obj_t* sparkle_objs[SPARKLE_COUNT] = {nullptr};
static int16_t   sparkle_x[SPARKLE_COUNT];
static int16_t   sparkle_y[SPARKLE_COUNT];
static uint8_t   sparkle_life[SPARKLE_COUNT]; // ticks remaining
static uint8_t   sparkle_idx = 0;

// ============================================================
// Star Joy LVGL objects
// ============================================================
static constexpr uint8_t MAX_STAR_OBJS = STAR_MAX_STARS;
static lv_obj_t* star_objs[MAX_STAR_OBJS]       = {nullptr};
static lv_obj_t* star_glow_objs[MAX_STAR_OBJS]  = {nullptr}; // outer glow
static constexpr int16_t STAR_DOT_SIZE = 12;
static constexpr int16_t STAR_GLOW_SIZE = 24;

// Lines for constellation edges
static constexpr uint8_t MAX_LINE_OBJS = 12;
static lv_obj_t* line_objs[MAX_LINE_OBJS] = {nullptr};
static lv_point_precise_t line_points[MAX_LINE_OBJS][2];

// Background twinkling stars (decorative)
static constexpr uint8_t BG_STAR_COUNT = 40;
static lv_obj_t* bg_star_objs[BG_STAR_COUNT] = {nullptr};

static lv_obj_t* star_constellation_label = nullptr;
static lv_obj_t* star_poem_label          = nullptr;

// Poetic lines for completed constellations — fragments from the Archive
static const char* const star_poems[STAR_MAX_CONSTELLATIONS] = {
    "La voce di Voshi attraversa il sh\xc3\xa0-r\xc3\xa8vosh:\n"
    "\"Th\xc3\xadshi l\xc3\xa0l\xc3\xad... il coro non tace mai del tutto.\"",
    "L'eco di Th\xc3\xadshi risuona dall'Archivio Vibrazionale:\n"
    "\"Ogni r\xc3\xa8vosh porta un frammento di Ech\xc3\xb2a.\"",
    "R\xc3\xa8vosh si risveglia nel k\xc3\xb2rim:\n"
    "\"Le lam\xc3\xa8ren lanciarono i s\xc3\xbfrma verso ogni stella.\"",
    "K\xc3\xb2ra arde nel th\xc3\xadsh\xc3\xad-s\xc3\xa8lath:\n"
    "\"La fame di voci \xc3\xa8 la luce che guida i semi cosmici.\"",
    "Lal\xc3\xaden veglia tra le frequenze:\n"
    "\"Il n\xc3\xa0vresh lega custode e creatura oltre il vuoto.\"",
};

// ============================================================
// Back button callback
// ============================================================
static void back_btn_cb(lv_event_t* e) {
    (void)e;
    Pet::MiniGames::endGame();
    Pet::applyGameResult();  // apply growth effects from the ritual
    UI::Manager::showScreen(UI::Manager::Screen::MAIN);
}

// ============================================================
// Helper: spawn sparkle at position
// ============================================================
static void spawn_sparkle(int16_t x, int16_t y) {
    sparkle_x[sparkle_idx] = x + random(-12, 13);
    sparkle_y[sparkle_idx] = y + random(-12, 13);
    sparkle_life[sparkle_idx] = 8; // ~250ms
    if (sparkle_objs[sparkle_idx]) {
        lv_obj_set_pos(sparkle_objs[sparkle_idx],
                       sparkle_x[sparkle_idx] - 4,
                       sparkle_y[sparkle_idx] - 4);
        lv_obj_remove_flag(sparkle_objs[sparkle_idx], LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_opa(sparkle_objs[sparkle_idx], LV_OPA_COVER, LV_PART_MAIN);
    }
    sparkle_idx = (sparkle_idx + 1) % SPARKLE_COUNT;
}

// ============================================================
// create() -- pre-allocate all objects
// ============================================================

namespace UI {
namespace ScreenMiniGame {

void create() {
    screen = lv_obj_create(nullptr);
    lv_obj_set_size(screen, SCR_W, SCR_H);
    lv_obj_set_style_bg_color(screen, lv_color_make(2, 4, 10), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    // Background panel
    bg_panel = lv_obj_create(screen);
    lv_obj_remove_style_all(bg_panel);
    lv_obj_set_size(bg_panel, SCR_W, SCR_H);
    lv_obj_set_pos(bg_panel, 0, 0);
    lv_obj_set_style_bg_color(bg_panel, lv_color_make(2, 4, 10), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(bg_panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_remove_flag(bg_panel, LV_OBJ_FLAG_SCROLLABLE);

    // --- Title label (top center) ---
    title_label = lv_label_create(screen);
    lv_obj_set_style_text_color(title_label, lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(title_label, &lv_font_montserrat_18, LV_PART_MAIN);
    lv_label_set_text(title_label, "");
    lv_obj_align(title_label, LV_ALIGN_TOP_MID, 0, 10);

    // --- Score label (top right area) ---
    score_label = lv_label_create(screen);
    lv_obj_set_style_text_color(score_label, lv_color_make(240, 230, 211), LV_PART_MAIN);
    lv_obj_set_style_text_font(score_label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_text(score_label, "");
    lv_obj_align(score_label, LV_ALIGN_TOP_RIGHT, -20, 12);

    // --- Status/message label (bottom center) ---
    msg_label = lv_label_create(screen);
    lv_obj_set_style_text_color(msg_label, lv_color_make(180, 180, 200), LV_PART_MAIN);
    lv_obj_set_style_text_font(msg_label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_align(msg_label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_set_width(msg_label, 600);
    lv_label_set_text(msg_label, "");
    lv_obj_align(msg_label, LV_ALIGN_BOTTOM_MID, 0, -15);

    // --- Back button (top left) ---
    back_btn = lv_button_create(screen);
    lv_obj_set_size(back_btn, 44, 36);
    lv_obj_set_pos(back_btn, 8, 8);
    lv_obj_set_style_bg_color(back_btn, lv_color_make(10, 25, 41), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(back_btn, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_color(back_btn, lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_border_width(back_btn, 1, LV_PART_MAIN);
    lv_obj_set_style_border_opa(back_btn, LV_OPA_60, LV_PART_MAIN);
    lv_obj_set_style_radius(back_btn, 6, LV_PART_MAIN);
    lv_obj_t* back_lbl = lv_label_create(back_btn);
    lv_label_set_text(back_lbl, LV_SYMBOL_LEFT);
    lv_obj_set_style_text_color(back_lbl, lv_color_make(240, 230, 211), LV_PART_MAIN);
    lv_obj_center(back_lbl);
    lv_obj_add_event_cb(back_btn, back_btn_cb, LV_EVENT_CLICKED, nullptr);

    // ================================================================
    // Echo Memory objects
    // ================================================================
    for (uint8_t i = 0; i < ECHO_NODES; i++) {
        float angle = -1.5708f + (6.2832f * i) / ECHO_NODES;
        int16_t nx = ECHO_CX + (int16_t)(ECHO_R * cosf(angle)) - ECHO_NODE_SIZE / 2;
        int16_t ny = ECHO_CY + (int16_t)(ECHO_R * sinf(angle)) - ECHO_NODE_SIZE / 2;

        echo_nodes[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(echo_nodes[i]);
        lv_obj_set_size(echo_nodes[i], ECHO_NODE_SIZE, ECHO_NODE_SIZE);
        lv_obj_set_pos(echo_nodes[i], nx, ny);
        lv_obj_set_style_bg_color(echo_nodes[i], echo_dim, LV_PART_MAIN);
        lv_obj_set_style_bg_opa(echo_nodes[i], LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(echo_nodes[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_set_style_border_color(echo_nodes[i], echo_colors[i], LV_PART_MAIN);
        lv_obj_set_style_border_width(echo_nodes[i], 2, LV_PART_MAIN);
        lv_obj_set_style_border_opa(echo_nodes[i], LV_OPA_40, LV_PART_MAIN);
        lv_obj_add_flag(echo_nodes[i], LV_OBJ_FLAG_HIDDEN);
    }

    echo_level_label = lv_label_create(screen);
    lv_obj_set_style_text_color(echo_level_label, lv_color_make(62, 207, 207), LV_PART_MAIN);
    lv_obj_set_style_text_font(echo_level_label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_text(echo_level_label, "");
    lv_obj_align(echo_level_label, LV_ALIGN_TOP_MID, 0, 36);
    lv_obj_add_flag(echo_level_label, LV_OBJ_FLAG_HIDDEN);

    // ================================================================
    // Light Cleansing objects
    // ================================================================
    for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
        clean_dust_objs[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(clean_dust_objs[i]);
        lv_obj_set_size(clean_dust_objs[i], DUST_SIZE, DUST_SIZE);
        lv_obj_set_style_bg_color(clean_dust_objs[i], lv_color_make(40, 30, 50), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(clean_dust_objs[i], LV_OPA_70, LV_PART_MAIN);
        lv_obj_set_style_radius(clean_dust_objs[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_add_flag(clean_dust_objs[i], LV_OBJ_FLAG_HIDDEN);
    }

    // Sparkle effect objects
    for (uint8_t i = 0; i < SPARKLE_COUNT; i++) {
        sparkle_objs[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(sparkle_objs[i]);
        lv_obj_set_size(sparkle_objs[i], 8, 8);
        lv_obj_set_style_bg_color(sparkle_objs[i], lv_color_make(255, 220, 120), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(sparkle_objs[i], LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(sparkle_objs[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
        sparkle_life[i] = 0;
        lv_obj_add_flag(sparkle_objs[i], LV_OBJ_FLAG_HIDDEN);
    }

    // Progress bar
    clean_progress_bar = lv_bar_create(screen);
    lv_obj_set_size(clean_progress_bar, 300, 16);
    lv_obj_align(clean_progress_bar, LV_ALIGN_BOTTOM_MID, 0, -50);
    lv_bar_set_range(clean_progress_bar, 0, 100);
    lv_bar_set_value(clean_progress_bar, 0, LV_ANIM_OFF);
    lv_obj_set_style_bg_color(clean_progress_bar, lv_color_make(15, 20, 30), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(clean_progress_bar, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(clean_progress_bar, 8, LV_PART_MAIN);
    lv_obj_set_style_bg_color(clean_progress_bar, lv_color_make(62, 207, 207), LV_PART_INDICATOR);
    lv_obj_set_style_bg_opa(clean_progress_bar, LV_OPA_COVER, LV_PART_INDICATOR);
    lv_obj_set_style_radius(clean_progress_bar, 8, LV_PART_INDICATOR);
    lv_obj_add_flag(clean_progress_bar, LV_OBJ_FLAG_HIDDEN);

    clean_pct_label = lv_label_create(screen);
    lv_obj_set_style_text_color(clean_pct_label, lv_color_make(240, 230, 211), LV_PART_MAIN);
    lv_obj_set_style_text_font(clean_pct_label, &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_text(clean_pct_label, "0%");
    lv_obj_align(clean_pct_label, LV_ALIGN_BOTTOM_MID, 0, -70);
    lv_obj_add_flag(clean_pct_label, LV_OBJ_FLAG_HIDDEN);

    // ================================================================
    // Star Joy objects
    // ================================================================
    // Background twinkling stars (fixed random positions)
    for (uint8_t i = 0; i < BG_STAR_COUNT; i++) {
        bg_star_objs[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(bg_star_objs[i]);
        uint8_t sz = (i % 3 == 0) ? 4 : 2;
        lv_obj_set_size(bg_star_objs[i], sz, sz);
        lv_obj_set_pos(bg_star_objs[i], random(10, SCR_W - 10), random(10, SCR_H - 10));
        uint8_t bright = 80 + random(0, 100);
        lv_obj_set_style_bg_color(bg_star_objs[i],
            lv_color_make(bright, bright, (uint8_t)(bright + 40 > 255 ? 255 : bright + 40)),
            LV_PART_MAIN);
        lv_obj_set_style_bg_opa(bg_star_objs[i], LV_OPA_60, LV_PART_MAIN);
        lv_obj_set_style_radius(bg_star_objs[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_add_flag(bg_star_objs[i], LV_OBJ_FLAG_HIDDEN);
    }

    // Star dots (constellation vertices)
    for (uint8_t i = 0; i < MAX_STAR_OBJS; i++) {
        // Glow halo
        star_glow_objs[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(star_glow_objs[i]);
        lv_obj_set_size(star_glow_objs[i], STAR_GLOW_SIZE, STAR_GLOW_SIZE);
        lv_obj_set_style_bg_color(star_glow_objs[i], lv_color_make(200, 200, 255), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(star_glow_objs[i], LV_OPA_20, LV_PART_MAIN);
        lv_obj_set_style_radius(star_glow_objs[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_add_flag(star_glow_objs[i], LV_OBJ_FLAG_HIDDEN);

        // Core dot
        star_objs[i] = lv_obj_create(screen);
        lv_obj_remove_style_all(star_objs[i]);
        lv_obj_set_size(star_objs[i], STAR_DOT_SIZE, STAR_DOT_SIZE);
        lv_obj_set_style_bg_color(star_objs[i], lv_color_make(240, 240, 255), LV_PART_MAIN);
        lv_obj_set_style_bg_opa(star_objs[i], LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_radius(star_objs[i], LV_RADIUS_CIRCLE, LV_PART_MAIN);
        lv_obj_add_flag(star_objs[i], LV_OBJ_FLAG_HIDDEN);
    }

    // Constellation edge lines
    for (uint8_t i = 0; i < MAX_LINE_OBJS; i++) {
        line_objs[i] = lv_line_create(screen);
        lv_obj_set_style_line_color(line_objs[i], lv_color_make(62, 207, 207), LV_PART_MAIN);
        lv_obj_set_style_line_width(line_objs[i], 2, LV_PART_MAIN);
        lv_obj_set_style_line_opa(line_objs[i], LV_OPA_COVER, LV_PART_MAIN);
        lv_obj_set_style_line_rounded(line_objs[i], true, LV_PART_MAIN);
        lv_obj_add_flag(line_objs[i], LV_OBJ_FLAG_HIDDEN);
    }

    star_constellation_label = lv_label_create(screen);
    lv_obj_set_style_text_color(star_constellation_label,
        lv_color_make(180, 180, 200), LV_PART_MAIN);
    lv_obj_set_style_text_font(star_constellation_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_label_set_text(star_constellation_label, "");
    lv_obj_align(star_constellation_label, LV_ALIGN_TOP_MID, 0, 36);
    lv_obj_add_flag(star_constellation_label, LV_OBJ_FLAG_HIDDEN);

    star_poem_label = lv_label_create(screen);
    lv_obj_set_style_text_color(star_poem_label,
        lv_color_make(212, 165, 52), LV_PART_MAIN);
    lv_obj_set_style_text_font(star_poem_label,
        &lv_font_montserrat_14, LV_PART_MAIN);
    lv_obj_set_style_text_align(star_poem_label, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_set_width(star_poem_label, 500);
    lv_label_set_text(star_poem_label, "");
    lv_obj_align(star_poem_label, LV_ALIGN_CENTER, 0, 180);
    lv_obj_add_flag(star_poem_label, LV_OBJ_FLAG_HIDDEN);

    Serial.println("[MINIGAME-UI] Screen created");
}

// ============================================================
// Helper: hide all game-specific objects
// ============================================================
static void hide_all_game_objects() {
    // Echo
    for (uint8_t i = 0; i < ECHO_NODES; i++) {
        if (echo_nodes[i]) lv_obj_add_flag(echo_nodes[i], LV_OBJ_FLAG_HIDDEN);
    }
    if (echo_level_label) lv_obj_add_flag(echo_level_label, LV_OBJ_FLAG_HIDDEN);

    // Clean
    for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
        if (clean_dust_objs[i]) lv_obj_add_flag(clean_dust_objs[i], LV_OBJ_FLAG_HIDDEN);
    }
    for (uint8_t i = 0; i < SPARKLE_COUNT; i++) {
        if (sparkle_objs[i]) lv_obj_add_flag(sparkle_objs[i], LV_OBJ_FLAG_HIDDEN);
        sparkle_life[i] = 0;
    }
    if (clean_progress_bar) lv_obj_add_flag(clean_progress_bar, LV_OBJ_FLAG_HIDDEN);
    if (clean_pct_label) lv_obj_add_flag(clean_pct_label, LV_OBJ_FLAG_HIDDEN);

    // Stars
    for (uint8_t i = 0; i < BG_STAR_COUNT; i++) {
        if (bg_star_objs[i]) lv_obj_add_flag(bg_star_objs[i], LV_OBJ_FLAG_HIDDEN);
    }
    for (uint8_t i = 0; i < MAX_STAR_OBJS; i++) {
        if (star_objs[i]) lv_obj_add_flag(star_objs[i], LV_OBJ_FLAG_HIDDEN);
        if (star_glow_objs[i]) lv_obj_add_flag(star_glow_objs[i], LV_OBJ_FLAG_HIDDEN);
    }
    for (uint8_t i = 0; i < MAX_LINE_OBJS; i++) {
        if (line_objs[i]) lv_obj_add_flag(line_objs[i], LV_OBJ_FLAG_HIDDEN);
    }
    if (star_constellation_label) lv_obj_add_flag(star_constellation_label, LV_OBJ_FLAG_HIDDEN);
    if (star_poem_label) lv_obj_add_flag(star_poem_label, LV_OBJ_FLAG_HIDDEN);
}

// ============================================================
// show() -- start a game
// ============================================================
void show(GameType type) {
    active_game = type;
    game_ended = false;
    end_timer = 0;

    hide_all_game_objects();

    // Start the game logic
    Pet::MiniGames::startGame(type);

    // Set title
    switch (type) {
        case GameType::ECHO_MEMORY:
            lv_label_set_text(title_label, "Thish\xc3\xad-R\xc3\xa8vosh");
            break;
        case GameType::LIGHT_CLEANSING:
            lv_label_set_text(title_label, "Misk\xc3\xa1-V\xc3\xbfthi");
            break;
        case GameType::STAR_JOY:
            lv_label_set_text(title_label, "S\xc3\xa8lath-Nashi");
            break;
    }
    lv_label_set_text(score_label, "0");
    lv_label_set_text(msg_label, "");

    // Show game-specific objects
    switch (type) {
        case GameType::ECHO_MEMORY:
            for (uint8_t i = 0; i < ECHO_NODES; i++) {
                lv_obj_remove_flag(echo_nodes[i], LV_OBJ_FLAG_HIDDEN);
                lv_obj_set_style_bg_color(echo_nodes[i], echo_dim, LV_PART_MAIN);
                lv_obj_set_style_border_opa(echo_nodes[i], LV_OPA_40, LV_PART_MAIN);
            }
            lv_obj_remove_flag(echo_level_label, LV_OBJ_FLAG_HIDDEN);
            lv_label_set_text(echo_level_label, "Risonanza del k\xc3\xb2rim: 3");
            lv_label_set_text(msg_label,
                "Il Lal\xc3\xaden canta una sequenza dall'Archivio...\n"
                "Ripetila per rafforzare il th\xc3\xadshi-s\xc3\xa8lath");
            // Set pet to idle animation centered
            UI::SpriteEngine::setAnimation("idle");
            break;

        case GameType::LIGHT_CLEANSING: {
            // Show dust particles at their positions
            for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
                int16_t dx, dy;
                uint8_t hp;
                if (Pet::MiniGames::cleanGetDust(i, dx, dy, hp)) {
                    lv_obj_set_pos(clean_dust_objs[i], dx - DUST_SIZE/2, dy - DUST_SIZE/2);
                    // Darker = more HP
                    uint8_t shade = (hp == 3) ? 20 : (hp == 2) ? 30 : 40;
                    lv_obj_set_style_bg_color(clean_dust_objs[i],
                        lv_color_make(shade, shade - 5, shade + 10), LV_PART_MAIN);
                    lv_obj_set_style_bg_opa(clean_dust_objs[i],
                        (hp == 3) ? LV_OPA_80 : LV_OPA_60, LV_PART_MAIN);
                    lv_obj_remove_flag(clean_dust_objs[i], LV_OBJ_FLAG_HIDDEN);
                }
            }
            lv_obj_remove_flag(clean_progress_bar, LV_OBJ_FLAG_HIDDEN);
            lv_obj_remove_flag(clean_pct_label, LV_OBJ_FLAG_HIDDEN);
            lv_bar_set_value(clean_progress_bar, 0, LV_ANIM_OFF);
            lv_label_set_text(clean_pct_label, "0%");
            lv_label_set_text(msg_label,
                "La s\xc3\xa8vra \xc3\xa8 offuscata dalle ombre del vuoto...\n"
                "Sfiora con dolcezza per restituire la luce al Lal\xc3\xaden");
            // Larger pet rendering (sprite engine handles scale)
            UI::SpriteEngine::setAnimation("idle");
            break;
        }

        case GameType::STAR_JOY: {
            // Show background stars
            for (uint8_t i = 0; i < BG_STAR_COUNT; i++) {
                lv_obj_remove_flag(bg_star_objs[i], LV_OBJ_FLAG_HIDDEN);
            }
            // Show constellation stars
            uint8_t sc = Pet::MiniGames::starGetStarCount();
            for (uint8_t i = 0; i < sc && i < MAX_STAR_OBJS; i++) {
                StarInfo si = Pet::MiniGames::starGetStar(i);
                lv_obj_set_pos(star_objs[i], si.x - STAR_DOT_SIZE/2, si.y - STAR_DOT_SIZE/2);
                lv_obj_set_pos(star_glow_objs[i],
                               si.x - STAR_GLOW_SIZE/2, si.y - STAR_GLOW_SIZE/2);
                lv_obj_remove_flag(star_objs[i], LV_OBJ_FLAG_HIDDEN);
                lv_obj_remove_flag(star_glow_objs[i], LV_OBJ_FLAG_HIDDEN);
            }
            // Show guide lines (very faint)
            uint8_t ec = Pet::MiniGames::starGetEdgeCount();
            for (uint8_t e = 0; e < ec && e < MAX_LINE_OBJS; e++) {
                ConstellationEdge edge = Pet::MiniGames::starGetEdge(e);
                StarInfo s1 = Pet::MiniGames::starGetStar(edge.from);
                StarInfo s2 = Pet::MiniGames::starGetStar(edge.to);
                line_points[e][0] = {(lv_value_precise_t)s1.x, (lv_value_precise_t)s1.y};
                line_points[e][1] = {(lv_value_precise_t)s2.x, (lv_value_precise_t)s2.y};
                lv_line_set_points(line_objs[e], line_points[e], 2);
                lv_obj_set_style_line_opa(line_objs[e], LV_OPA_10, LV_PART_MAIN);
                lv_obj_set_style_line_color(line_objs[e],
                    lv_color_make(100, 100, 140), LV_PART_MAIN);
                lv_obj_remove_flag(line_objs[e], LV_OBJ_FLAG_HIDDEN);
            }
            lv_obj_remove_flag(star_constellation_label, LV_OBJ_FLAG_HIDDEN);
            {
                char buf[48];
                snprintf(buf, sizeof(buf), "Costellazione %d / %d",
                         Pet::MiniGames::starGetConstellation() + 1,
                         Pet::MiniGames::starGetTotalConstellations());
                lv_label_set_text(star_constellation_label, buf);
            }
            lv_label_set_text(msg_label,
                "Le lam\xc3\xa8ren lanciarono i s\xc3\xbfrma verso queste stelle...\n"
                "Ritrova il cammino collegando le frequenze");
            // Pet in corner
            UI::SpriteEngine::setAnimation("idle");
            break;
        }
    }

    // Load the screen
    if (screen) {
        lv_screen_load_anim(screen, LV_SCR_LOAD_ANIM_FADE_IN, 300, 0, false);
    }
}

void hide() {
    hide_all_game_objects();
    if (Pet::MiniGames::isPlaying()) {
        Pet::MiniGames::endGame();
        Pet::applyGameResult();
    }
}

// ============================================================
// update() -- ~30Hz visual updates
// ============================================================
void update() {
    // Tick game logic
    Pet::MiniGames::update();

    // Update sprite engine
    UI::SpriteEngine::tick();

    switch (active_game) {
        // ---- ECHO MEMORY visual update ----
        case GameType::ECHO_MEMORY: {
            int8_t lit = Pet::MiniGames::echoGetLitNode();
            for (uint8_t i = 0; i < ECHO_NODES; i++) {
                if ((int8_t)i == lit) {
                    lv_obj_set_style_bg_color(echo_nodes[i], echo_colors[i], LV_PART_MAIN);
                    lv_obj_set_style_border_opa(echo_nodes[i], LV_OPA_COVER, LV_PART_MAIN);
                } else {
                    lv_obj_set_style_bg_color(echo_nodes[i], echo_dim, LV_PART_MAIN);
                    lv_obj_set_style_border_opa(echo_nodes[i], LV_OPA_40, LV_PART_MAIN);
                }
            }

            // Update level label
            {
                char buf[40];
                snprintf(buf, sizeof(buf), "Risonanza del k\xc3\xb2rim: %d",
                         Pet::MiniGames::echoGetLevel());
                lv_label_set_text(echo_level_label, buf);
            }

            // Status messages — lore-contextualised
            if (Pet::MiniGames::echoIsPlayback()) {
                lv_label_set_text(msg_label,
                    "Il k\xc3\xb2rim pulsa... ascolta il canto ancestrale");
            } else if (Pet::MiniGames::echoIsSuccess()) {
                lv_label_set_text(msg_label,
                    "K\xc3\xb2! Il r\xc3\xa8vosh risuona! "
                    "Un frammento di Ech\xc3\xb2a rivive nel n\xc3\xa0vresh");
                UI::SpriteEngine::setAnimation("happy");
            } else if (Pet::MiniGames::echoIsFailed()) {
                lv_label_set_text(msg_label,
                    "Sh\xc3\xa0... la frequenza si perde nel vuoto...");
                UI::SpriteEngine::setAnimation("sad");
                if (!game_ended) {
                    game_ended = true;
                    end_timer = 0;
                }
            } else {
                lv_label_set_text(msg_label,
                    "Tocca i nodi nell'ordine del canto");
            }

            // Auto-return after failure
            if (game_ended) {
                end_timer++;
                if (end_timer > 60) { // 2 sec
                    Pet::MiniGames::endGame();
                    Pet::applyGameResult();
                    UI::Manager::showScreen(UI::Manager::Screen::MAIN);
                    return;
                }
            }
            break;
        }

        // ---- LIGHT CLEANSING visual update ----
        case GameType::LIGHT_CLEANSING: {
            // Update dust visibility
            for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
                int16_t dx, dy;
                uint8_t hp;
                if (Pet::MiniGames::cleanGetDust(i, dx, dy, hp)) {
                    uint8_t shade = (hp == 3) ? 20 : (hp == 2) ? 30 : 40;
                    lv_obj_set_style_bg_color(clean_dust_objs[i],
                        lv_color_make(shade, shade - 5, shade + 10), LV_PART_MAIN);
                    lv_obj_remove_flag(clean_dust_objs[i], LV_OBJ_FLAG_HIDDEN);
                } else {
                    lv_obj_add_flag(clean_dust_objs[i], LV_OBJ_FLAG_HIDDEN);
                }
            }

            // Update sparkles
            for (uint8_t i = 0; i < SPARKLE_COUNT; i++) {
                if (sparkle_life[i] > 0) {
                    sparkle_life[i]--;
                    lv_obj_set_style_opa(sparkle_objs[i],
                        (lv_opa_t)(sparkle_life[i] * 30), LV_PART_MAIN);
                    if (sparkle_life[i] == 0) {
                        lv_obj_add_flag(sparkle_objs[i], LV_OBJ_FLAG_HIDDEN);
                    }
                }
            }

            // Progress bar
            uint8_t pct = Pet::MiniGames::cleanGetProgress();
            lv_bar_set_value(clean_progress_bar, pct, LV_ANIM_ON);
            {
                char buf[8];
                snprintf(buf, sizeof(buf), "%d%%", pct);
                lv_label_set_text(clean_pct_label, buf);
            }

            // Flinch feedback
            if (Pet::MiniGames::cleanIsFlinching()) {
                lv_label_set_text(msg_label,
                    "Sh\xc3\xa0! Troppo brusco... "
                    "la s\xc3\xa8vra \xc3\xa8 delicata come il canto");
                UI::SpriteEngine::setAnimation("sad");
            } else if (pct >= 100) {
                lv_label_set_text(msg_label,
                    "K\xc3\xb2-l\xc3\xa0l\xc3\xad! La s\xc3\xa8vra risplende come "
                    "le foreste-filtro di Ech\xc3\xb2a!");
                UI::SpriteEngine::setAnimation("happy");
                if (!game_ended) {
                    game_ended = true;
                    end_timer = 0;
                }
            } else {
                char clean_msg[120];
                if (pct < 30) {
                    snprintf(clean_msg, sizeof(clean_msg),
                        "Le ombre del sh\xc3\xa0-r\xc3\xa8vosh ricoprono la membrana...");
                } else if (pct < 70) {
                    snprintf(clean_msg, sizeof(clean_msg),
                        "La luce del k\xc3\xb2rim traspare... continua con dolcezza");
                } else {
                    snprintf(clean_msg, sizeof(clean_msg),
                        "Quasi purificata! La s\xc3\xa8vra comincia a cantare...");
                }
                lv_label_set_text(msg_label, clean_msg);
                UI::SpriteEngine::setAnimation("idle");
            }

            // Auto-return after completion
            if (game_ended) {
                end_timer++;
                if (end_timer > 90) { // 3 sec
                    Pet::MiniGames::endGame();
                    Pet::applyGameResult();
                    UI::Manager::showScreen(UI::Manager::Screen::MAIN);
                    return;
                }
            }
            break;
        }

        // ---- STAR JOY visual update ----
        case GameType::STAR_JOY: {
            // Twinkling background stars
            for (uint8_t i = 0; i < BG_STAR_COUNT; i++) {
                if (random(0, 60) == 0) {
                    lv_opa_t opa = (lv_opa_t)(30 + random(0, 100));
                    lv_obj_set_style_bg_opa(bg_star_objs[i], opa, LV_PART_MAIN);
                }
            }

            // Update star appearances
            int8_t sel = Pet::MiniGames::starGetSelectedStar();
            uint8_t sc = Pet::MiniGames::starGetStarCount();
            for (uint8_t i = 0; i < sc && i < MAX_STAR_OBJS; i++) {
                StarInfo si = Pet::MiniGames::starGetStar(i);
                // Reposition (in case constellation changed)
                lv_obj_set_pos(star_objs[i], si.x - STAR_DOT_SIZE/2, si.y - STAR_DOT_SIZE/2);
                lv_obj_set_pos(star_glow_objs[i],
                               si.x - STAR_GLOW_SIZE/2, si.y - STAR_GLOW_SIZE/2);
                lv_obj_remove_flag(star_objs[i], LV_OBJ_FLAG_HIDDEN);
                lv_obj_remove_flag(star_glow_objs[i], LV_OBJ_FLAG_HIDDEN);

                if ((int8_t)i == sel) {
                    // Selected star glows brighter
                    lv_obj_set_style_bg_color(star_objs[i],
                        lv_color_make(255, 220, 120), LV_PART_MAIN);
                    lv_obj_set_style_bg_opa(star_glow_objs[i], LV_OPA_50, LV_PART_MAIN);
                } else if (si.connected) {
                    lv_obj_set_style_bg_color(star_objs[i],
                        lv_color_make(62, 207, 207), LV_PART_MAIN);
                    lv_obj_set_style_bg_opa(star_glow_objs[i], LV_OPA_30, LV_PART_MAIN);
                } else {
                    lv_obj_set_style_bg_color(star_objs[i],
                        lv_color_make(240, 240, 255), LV_PART_MAIN);
                    lv_obj_set_style_bg_opa(star_glow_objs[i], LV_OPA_20, LV_PART_MAIN);
                }
            }
            // Hide unused star objects
            for (uint8_t i = sc; i < MAX_STAR_OBJS; i++) {
                lv_obj_add_flag(star_objs[i], LV_OBJ_FLAG_HIDDEN);
                lv_obj_add_flag(star_glow_objs[i], LV_OBJ_FLAG_HIDDEN);
            }

            // Update edge lines
            uint8_t ec = Pet::MiniGames::starGetEdgeCount();
            for (uint8_t e = 0; e < ec && e < MAX_LINE_OBJS; e++) {
                ConstellationEdge edge = Pet::MiniGames::starGetEdge(e);
                StarInfo s1 = Pet::MiniGames::starGetStar(edge.from);
                StarInfo s2 = Pet::MiniGames::starGetStar(edge.to);
                line_points[e][0] = {(lv_value_precise_t)s1.x, (lv_value_precise_t)s1.y};
                line_points[e][1] = {(lv_value_precise_t)s2.x, (lv_value_precise_t)s2.y};
                lv_line_set_points(line_objs[e], line_points[e], 2);

                // Check if this edge is done (by checking completed count vs index)
                // We need a way to check per-edge. Use accessor pattern:
                // For simplicity, completed edges get bright color, others stay faint
                bool done = false;
                // Check if from-to pair matches any completed sequence
                // The game tracks completion per-edge internally; we check visually
                // by comparing completed count progression
                // Actually we need to iterate: if edge index < completed, it's done
                // But edges may not complete in order. Let's use a simpler visual:
                // bright if completed edges >= edge_count (constellation done)
                if (Pet::MiniGames::starIsConstellationComplete()) {
                    done = true;
                }
                // For individual edges we rely on star.connected status
                // A completed edge means both its stars are connected
                if (s1.connected && s2.connected) {
                    done = true;
                }

                if (done) {
                    lv_obj_set_style_line_color(line_objs[e],
                        lv_color_make(62, 207, 207), LV_PART_MAIN);
                    lv_obj_set_style_line_opa(line_objs[e], LV_OPA_80, LV_PART_MAIN);
                    lv_obj_set_style_line_width(line_objs[e], 3, LV_PART_MAIN);
                } else {
                    lv_obj_set_style_line_color(line_objs[e],
                        lv_color_make(100, 100, 140), LV_PART_MAIN);
                    lv_obj_set_style_line_opa(line_objs[e], LV_OPA_10, LV_PART_MAIN);
                    lv_obj_set_style_line_width(line_objs[e], 2, LV_PART_MAIN);
                }
                lv_obj_remove_flag(line_objs[e], LV_OBJ_FLAG_HIDDEN);
            }
            // Hide unused lines
            for (uint8_t e = ec; e < MAX_LINE_OBJS; e++) {
                lv_obj_add_flag(line_objs[e], LV_OBJ_FLAG_HIDDEN);
            }

            // Constellation counter
            {
                char buf[48];
                snprintf(buf, sizeof(buf), "Costellazione %d / %d",
                         Pet::MiniGames::starGetConstellation() + 1,
                         Pet::MiniGames::starGetTotalConstellations());
                lv_label_set_text(star_constellation_label, buf);
            }

            // Poem display on constellation completion
            if (Pet::MiniGames::starIsConstellationComplete()) {
                uint8_t cidx = Pet::MiniGames::starGetConstellation();
                if (cidx < STAR_MAX_CONSTELLATIONS) {
                    lv_label_set_text(star_poem_label, star_poems[cidx]);
                    lv_obj_remove_flag(star_poem_label, LV_OBJ_FLAG_HIDDEN);
                }
                UI::SpriteEngine::setAnimation("sing");
            } else {
                lv_obj_add_flag(star_poem_label, LV_OBJ_FLAG_HIDDEN);
            }

            // Session complete
            if (Pet::MiniGames::starIsSessionComplete()) {
                lv_label_set_text(msg_label,
                    "K\xc3\xb2-s\xc3\xa8lath! Le costellazioni cantano!\n"
                    "Il th\xc3\xadsh\xc3\xad-s\xc3\xa8lath accoglie una voce in pi\xc3\xb9.");
                if (!game_ended) {
                    game_ended = true;
                    end_timer = 0;
                }
            } else {
                lv_label_set_text(msg_label,
                    "Collega le stelle... ogni linea \xc3\xa8 un sentiero di s\xc3\xbfrma");
            }

            // Auto-return after session complete
            if (game_ended) {
                end_timer++;
                if (end_timer > 90) { // 3 sec
                    Pet::MiniGames::endGame();
                    Pet::applyGameResult();
                    UI::Manager::showScreen(UI::Manager::Screen::MAIN);
                    return;
                }
            }
            break;
        }
    }

    // Update score display
    {
        char buf[20];
        uint16_t score = 0;
        switch (active_game) {
            case GameType::ECHO_MEMORY:     score = Pet::MiniGames::echoGetLevel() * 10; break;
            case GameType::LIGHT_CLEANSING: score = Pet::MiniGames::cleanGetProgress(); break;
            case GameType::STAR_JOY:        score = Pet::MiniGames::starGetCompletedEdges() * 20; break;
        }
        snprintf(buf, sizeof(buf), "%d", score);
        lv_label_set_text(score_label, buf);
    }
}

// ============================================================
// handleTouch()
// ============================================================
void handleTouch(const HAL::TouchEvent& event) {
    if (!Pet::MiniGames::isPlaying()) return;

    bool pressed = (event.type == HAL::TouchEvent::PRESS ||
                    event.type == HAL::TouchEvent::DRAG ||
                    event.type == HAL::TouchEvent::LONG_PRESS);
    bool dragging = (event.type == HAL::TouchEvent::DRAG);

    Pet::MiniGames::handleTouch(event.x, event.y, pressed, dragging);

    // Spawn sparkles for cleaning game on drag
    if (active_game == GameType::LIGHT_CLEANSING && dragging) {
        spawn_sparkle(event.x, event.y);
    }
}

lv_obj_t* getScreen() {
    return screen;
}

} // namespace ScreenMiniGame
} // namespace UI
