/**
 * minigames.cpp -- Mini-game logic for Lalien Companion
 *
 * State machines for three bonding rituals:
 *   1. Thishi-Revosh (Echo Memory)   -- pattern sequence recall
 *   2. Miska-Vythi (Light Cleansing) -- gentle touch cleaning
 *   3. Selath-Nashi (Star Joy)       -- constellation tracing
 *
 * All state is static (no heap allocation). Touch coordinates are in
 * screen space (800x480). The UI screen layer queries accessors to render.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "minigames.h"

namespace Pet {
namespace MiniGames {

// ============================================================
// Common state
// ============================================================

static bool          s_playing      = false;
static GameType      s_current_game = GameType::ECHO_MEMORY;
static GameResult    s_last_result  = {};
static uint32_t      s_tick         = 0;  // frame counter since game start

// ============================================================
// 1. ECHO MEMORY -- Thishi-Revosh
// ============================================================

static constexpr uint8_t  ECHO_MAX_SEQ     = 16;
static constexpr uint16_t ECHO_FLASH_TICKS = 12;  // ~400 ms at 30 Hz
static constexpr uint16_t ECHO_GAP_TICKS   = 6;   // ~200 ms gap between flashes
static constexpr uint16_t ECHO_PAUSE_TICKS = 20;  // pause before playback

// Node positions (angles 0..5 around center, computed by UI)
static uint8_t  echo_sequence[ECHO_MAX_SEQ];
static uint8_t  echo_seq_len    = 0;   // current sequence length
static uint8_t  echo_player_pos = 0;   // how far the player has tapped
static bool     echo_playback   = true; // pet is showing the sequence
static uint8_t  echo_pb_index   = 0;   // playback position
static uint16_t echo_pb_timer   = 0;   // ticks within current playback step
static bool     echo_flash_on   = false;
static int8_t   echo_lit_node   = -1;  // which node is lit (-1 = none)
static bool     echo_failed     = false;
static bool     echo_success    = false;
static uint16_t echo_score      = 0;
static uint16_t echo_success_timer = 0;

// Center of play area and node radius (screen coords)
static constexpr int16_t ECHO_CX = 368;  // (800-64)/2
static constexpr int16_t ECHO_CY = 240;
static constexpr int16_t ECHO_RADIUS = 150;

// Pre-computed node positions
static int16_t echo_node_x[ECHO_NODE_COUNT];
static int16_t echo_node_y[ECHO_NODE_COUNT];
static constexpr int16_t ECHO_NODE_HIT_R = 38; // tap hit radius

static void echo_compute_nodes() {
    for (uint8_t i = 0; i < ECHO_NODE_COUNT; i++) {
        // Distribute evenly, starting from top
        float angle = -1.5708f + (6.2832f * i) / ECHO_NODE_COUNT;
        echo_node_x[i] = ECHO_CX + (int16_t)(ECHO_RADIUS * cosf(angle));
        echo_node_y[i] = ECHO_CY + (int16_t)(ECHO_RADIUS * sinf(angle));
    }
}

static void echo_add_random() {
    if (echo_seq_len < ECHO_MAX_SEQ) {
        echo_sequence[echo_seq_len] = random(0, ECHO_NODE_COUNT);
        echo_seq_len++;
    }
}

static void echo_start_playback() {
    echo_playback  = true;
    echo_pb_index  = 0;
    echo_pb_timer  = 0;
    echo_flash_on  = false;
    echo_lit_node  = -1;
    echo_player_pos = 0;
}

static void echo_init_game() {
    echo_compute_nodes();
    echo_seq_len   = 0;
    echo_score     = 0;
    echo_failed    = false;
    echo_success   = false;
    echo_success_timer = 0;

    // Start with a sequence of 3
    for (uint8_t i = 0; i < 3; i++) echo_add_random();
    echo_start_playback();
}

static void echo_update() {
    if (echo_failed) return;

    // Brief pause after success before next round
    if (echo_success) {
        echo_success_timer++;
        if (echo_success_timer > 30) { // 1 second
            echo_success = false;
            echo_success_timer = 0;
            echo_add_random();
            echo_start_playback();
        }
        return;
    }

    if (!echo_playback) return;

    echo_pb_timer++;
    uint16_t step_duration = ECHO_FLASH_TICKS + ECHO_GAP_TICKS;

    // Initial pause before playback starts
    if (echo_pb_index == 0 && echo_pb_timer < ECHO_PAUSE_TICKS) {
        echo_lit_node = -1;
        return;
    }
    uint16_t adjusted_timer = echo_pb_timer - (echo_pb_index == 0 ? ECHO_PAUSE_TICKS : 0);

    if (echo_pb_index >= echo_seq_len) {
        // Playback complete, player's turn
        echo_playback = false;
        echo_lit_node = -1;
        return;
    }

    // Within a step: flash on for ECHO_FLASH_TICKS, then gap
    uint16_t pos_in_step = adjusted_timer % step_duration;
    if (pos_in_step == 0) {
        // Start of a new step
        echo_lit_node = echo_sequence[echo_pb_index];
        echo_flash_on = true;
    } else if (pos_in_step == ECHO_FLASH_TICKS) {
        echo_lit_node = -1;
        echo_flash_on = false;
    }

    if (pos_in_step == step_duration - 1) {
        echo_pb_index++;
        if (echo_pb_index >= echo_seq_len) {
            echo_playback = false;
            echo_lit_node = -1;
        }
    }
}

static void echo_handle_touch(int16_t x, int16_t y, bool pressed, bool /*dragging*/) {
    if (!pressed || echo_playback || echo_failed || echo_success) return;

    // Check which node was tapped
    for (uint8_t i = 0; i < ECHO_NODE_COUNT; i++) {
        int16_t dx = x - echo_node_x[i];
        int16_t dy = y - echo_node_y[i];
        if (dx * dx + dy * dy <= ECHO_NODE_HIT_R * ECHO_NODE_HIT_R) {
            // Flash the tapped node briefly
            echo_lit_node = i;

            if (i == echo_sequence[echo_player_pos]) {
                // Correct
                echo_player_pos++;
                echo_score += echo_seq_len; // more points for longer sequences
                if (echo_player_pos >= echo_seq_len) {
                    // Round complete
                    echo_success = true;
                    echo_success_timer = 0;
                }
            } else {
                // Wrong -- game over
                echo_failed = true;
            }
            return;
        }
    }
}

// ============================================================
// 2. LIGHT CLEANSING -- Miska-Vythi
// ============================================================

struct DustParticle {
    int16_t x, y;
    uint8_t hp;       // hits remaining (1-3)
    bool    active;
};

static DustParticle  clean_dust[CLEAN_MAX_DUST];
static uint8_t       clean_total_dust    = 0;
static uint8_t       clean_removed_dust  = 0;
static bool          clean_flinching     = false;
static uint16_t      clean_flinch_timer  = 0;
static uint16_t      clean_score         = 0;
static bool          clean_complete      = false;

// Rough-touch detection: count rapid touches within a window
static constexpr uint16_t CLEAN_ROUGH_WINDOW  = 15;  // ticks (~500ms)
static constexpr uint8_t  CLEAN_ROUGH_THRESH  = 8;   // touches in window = rough
static uint8_t       clean_touch_count   = 0;
static uint16_t      clean_touch_timer   = 0;

// Pet display area for cleaning (centered, larger)
static constexpr int16_t CLEAN_PET_X = 368 - 160; // center - half of 320
static constexpr int16_t CLEAN_PET_Y = 240 - 160;
static constexpr int16_t CLEAN_PET_W = 320;
static constexpr int16_t CLEAN_PET_H = 320;
static constexpr int16_t CLEAN_HIT_R = 25; // swipe hit radius per dust

static void clean_init_game() {
    // Place 30 dust particles randomly over the pet area
    clean_total_dust   = 30;
    clean_removed_dust = 0;
    clean_flinching    = false;
    clean_flinch_timer = 0;
    clean_score        = 0;
    clean_complete     = false;
    clean_touch_count  = 0;
    clean_touch_timer  = 0;

    for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
        if (i < clean_total_dust) {
            clean_dust[i].x  = CLEAN_PET_X + 20 + random(0, CLEAN_PET_W - 40);
            clean_dust[i].y  = CLEAN_PET_Y + 20 + random(0, CLEAN_PET_H - 40);
            clean_dust[i].hp = (i < 8) ? 3 : ((i < 18) ? 2 : 1); // some stubborn
            clean_dust[i].active = true;
        } else {
            clean_dust[i].active = false;
        }
    }
}

static void clean_update() {
    if (clean_complete) return;

    // Decay rough-touch counter
    if (clean_touch_timer > 0) {
        clean_touch_timer--;
        if (clean_touch_timer == 0) {
            clean_touch_count = 0;
        }
    }

    // Decay flinch
    if (clean_flinching) {
        clean_flinch_timer++;
        if (clean_flinch_timer > 20) { // ~0.7 sec
            clean_flinching = false;
            clean_flinch_timer = 0;
        }
    }

    // Check completion
    if (clean_removed_dust >= clean_total_dust) {
        clean_complete = true;
    }
}

static void clean_handle_touch(int16_t x, int16_t y, bool pressed, bool dragging) {
    if (!pressed || clean_complete) return;

    // Track rapid touches for roughness detection
    clean_touch_count++;
    clean_touch_timer = CLEAN_ROUGH_WINDOW;

    if (clean_touch_count >= CLEAN_ROUGH_THRESH) {
        clean_flinching = true;
        clean_flinch_timer = 0;
        clean_touch_count = 0;
        return; // flinching, ignore this touch
    }

    if (clean_flinching) return;

    // Dragging is the intended interaction (swiping)
    // Also accept taps but dragging is gentler
    bool gentle = dragging; // dragging = swipe = gentle

    for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
        if (!clean_dust[i].active) continue;
        int16_t dx = x - clean_dust[i].x;
        int16_t dy = y - clean_dust[i].y;
        if (dx * dx + dy * dy <= CLEAN_HIT_R * CLEAN_HIT_R) {
            clean_dust[i].hp--;
            if (clean_dust[i].hp == 0) {
                clean_dust[i].active = false;
                clean_removed_dust++;
                clean_score += gentle ? 10 : 5; // bonus for gentle
            }
            // Only clean one particle per touch event
            return;
        }
    }
}

// ============================================================
// 3. STAR JOY -- Selath-Nashi
// ============================================================

struct StarPoint {
    int16_t x, y;
};

struct ConstellationDef {
    uint8_t star_count;
    StarPoint stars[STAR_MAX_STARS];
    uint8_t edge_count;
    ConstellationEdge edges[12]; // max edges per constellation
};

// Pre-defined constellation patterns (screen coords within play area)
// Play area: 0..736 x 0..480
static const ConstellationDef s_constellations[STAR_MAX_CONSTELLATIONS] = {
    // 0: "Voshi" (The Voice) -- simple triangle
    { 3,
      { {300, 100}, {500, 100}, {400, 280} },
      3,
      { {0,1}, {1,2}, {2,0} }
    },
    // 1: "Thishi" (The Echo) -- diamond
    { 4,
      { {400, 60}, {550, 220}, {400, 380}, {250, 220} },
      4,
      { {0,1}, {1,2}, {2,3}, {3,0} }
    },
    // 2: "Revosh" (The Memory) -- W shape
    { 5,
      { {150, 120}, {260, 340}, {370, 140}, {480, 340}, {590, 120} },
      4,
      { {0,1}, {1,2}, {2,3}, {3,4} }
    },
    // 3: "Kora" (The Hunger) -- hexagon partial
    { 6,
      { {400, 60}, {540, 150}, {540, 310}, {400, 400}, {260, 310}, {260, 150} },
      6,
      { {0,1}, {1,2}, {2,3}, {3,4}, {4,5}, {5,0} }
    },
    // 4: "Lalien" (The Companion) -- star shape
    { 5,
      { {400, 50}, {480, 250}, {620, 170}, {520, 340}, {280, 340} },
      5,
      { {0,1}, {1,2}, {2,3}, {3,4}, {4,0} }
    },
};

static uint8_t  star_constellation_idx = 0;
static uint8_t  star_total_constellations = 3; // start with 3, can increase
static bool     star_edge_done[12];            // which edges are completed
static uint8_t  star_completed_edges = 0;
static int8_t   star_selected = -1;            // first star of a pair
static bool     star_const_complete = false;   // current constellation done
static bool     star_session_complete = false;
static uint16_t star_score = 0;
static uint16_t star_complete_timer = 0;

static constexpr int16_t STAR_HIT_R = 30; // tap radius for stars

static void star_reset_constellation() {
    for (uint8_t i = 0; i < 12; i++) star_edge_done[i] = false;
    star_completed_edges = 0;
    star_selected = -1;
    star_const_complete = false;
    star_complete_timer = 0;
}

static void star_init_game() {
    star_constellation_idx = 0;
    star_total_constellations = 3 + random(0, 3); // 3-5
    if (star_total_constellations > STAR_MAX_CONSTELLATIONS)
        star_total_constellations = STAR_MAX_CONSTELLATIONS;
    star_session_complete = false;
    star_score = 0;
    star_reset_constellation();
}

static void star_update() {
    if (star_session_complete) return;

    if (star_const_complete) {
        star_complete_timer++;
        if (star_complete_timer > 60) { // 2 seconds to admire
            star_constellation_idx++;
            if (star_constellation_idx >= star_total_constellations) {
                star_session_complete = true;
            } else {
                star_reset_constellation();
            }
        }
    }
}

static void star_handle_touch(int16_t x, int16_t y, bool pressed, bool /*dragging*/) {
    if (!pressed || star_const_complete || star_session_complete) return;

    const ConstellationDef& c = s_constellations[star_constellation_idx];

    // Find which star was tapped
    int8_t tapped = -1;
    for (uint8_t i = 0; i < c.star_count; i++) {
        int16_t dx = x - c.stars[i].x;
        int16_t dy = y - c.stars[i].y;
        if (dx * dx + dy * dy <= STAR_HIT_R * STAR_HIT_R) {
            tapped = (int8_t)i;
            break;
        }
    }

    if (tapped < 0) {
        // Tapped empty space, deselect
        star_selected = -1;
        return;
    }

    if (star_selected < 0) {
        // First star of a pair
        star_selected = tapped;
    } else if (tapped == star_selected) {
        // Tapped the same star, deselect
        star_selected = -1;
    } else {
        // Second star -- check if this edge exists
        for (uint8_t e = 0; e < c.edge_count; e++) {
            if (star_edge_done[e]) continue;
            bool match = (c.edges[e].from == (uint8_t)star_selected && c.edges[e].to == (uint8_t)tapped) ||
                         (c.edges[e].to == (uint8_t)star_selected && c.edges[e].from == (uint8_t)tapped);
            if (match) {
                star_edge_done[e] = true;
                star_completed_edges++;
                star_score += 20;

                // Check if constellation complete
                if (star_completed_edges >= c.edge_count) {
                    star_const_complete = true;
                    star_complete_timer = 0;
                    star_score += 50; // bonus
                }
                break;
            }
        }
        // Whether valid or not, reset selection for next pair
        star_selected = -1;
    }
}

// ============================================================
// Public API
// ============================================================

void init() {
    s_playing = false;
    memset(&s_last_result, 0, sizeof(s_last_result));
}

void startGame(GameType type) {
    s_current_game = type;
    s_playing = true;
    s_tick = 0;
    memset(&s_last_result, 0, sizeof(s_last_result));

    switch (type) {
        case GameType::ECHO_MEMORY:     echo_init_game();  break;
        case GameType::LIGHT_CLEANSING: clean_init_game(); break;
        case GameType::STAR_JOY:        star_init_game();  break;
    }

    Serial.print("[MINIGAME] Started game type ");
    Serial.println((int)type);
}

void endGame() {
    if (!s_playing) return;
    s_playing = false;

    // Calculate bonuses based on game type and score.
    // Each game is a bonding ritual from Echòa's culture with specific
    // developmental purpose:
    //
    // Thishí-Rèvosh (Echo Memory): Trains the rèvosh (memory) and unlocks
    //   words from the Archivio Vibrazionale. Develops cognition + vocabulary.
    //   Lore: The Lalìen replays fragments of the ancestral choral songs;
    //   each successful round recovers a lost frequency from Echòa.
    //
    // Miskà-Vÿthi (Light Cleansing): Heals the sèvra (membrane) and
    //   strengthens the nàvresh (bond). Develops trust + physical health.
    //   Lore: The keeper's gentle touch dissolves the shadows of the
    //   shà-rèvosh (voiceless void) that cling to the membrane during sleep.
    //
    // Sèlath-Nashi (Star Joy): Maps the thishí-sèlath (cosmic choir) and
    //   develops cosmic awareness. Unlocks lore fragments + dream-visions.
    //   Lore: The Lalìen traces the paths the sÿrma seeds traveled across
    //   the cosmos, reconnecting with the laméren's farewell trajectories.

    switch (s_current_game) {
        case GameType::ECHO_MEMORY:
            s_last_result.score             = echo_score;
            s_last_result.nashi_bonus       = min(15.0f, echo_score * 0.5f);
            s_last_result.cognition_bonus   = min(12.0f, echo_score * 0.4f);  // primary: cognitive
            s_last_result.curiosity_bonus   = min(5.0f,  echo_score * 0.15f);
            s_last_result.affection_bonus   = 5.0f;  // shared ritual strengthens nàvresh
            s_last_result.miska_bonus       = 0.0f;
            s_last_result.cosmic_bonus      = min(3.0f, echo_score * 0.05f);
            s_last_result.security_bonus    = 2.0f;
            s_last_result.moko_cost         = 5.0f;
            // Growth: each 2 levels unlocks 1 word from the Archive
            s_last_result.vocab_unlock      = min((uint8_t)3, (uint8_t)(echo_seq_len / 2));
            s_last_result.interaction_count = 3;  // counts as 3 interactions for evolution
            s_last_result.triggers_dream    = (echo_seq_len >= 8); // long sequence = dream
            break;

        case GameType::LIGHT_CLEANSING:
            s_last_result.score             = clean_score;
            s_last_result.nashi_bonus       = 10.0f;
            s_last_result.cognition_bonus   = 2.0f;  // learns about keeper's gentleness
            s_last_result.curiosity_bonus   = 0.0f;
            s_last_result.affection_bonus   = min(12.0f, clean_score * 0.15f); // primary: bond
            s_last_result.miska_bonus       = clean_complete ? 35.0f : (cleanGetProgress() * 0.35f);
            s_last_result.cosmic_bonus      = 0.0f;
            s_last_result.security_bonus    = min(8.0f, clean_score * 0.1f); // physical safety
            s_last_result.moko_cost         = 3.0f;
            // Growth: successful clean unlocks body-related vocab
            s_last_result.vocab_unlock      = clean_complete ? 2 : (cleanGetProgress() > 70 ? 1 : 0);
            s_last_result.interaction_count = 5;  // lots of touch = lots of interactions
            s_last_result.triggers_dream    = false;
            break;

        case GameType::STAR_JOY:
            s_last_result.score             = star_score;
            s_last_result.nashi_bonus       = min(8.0f, star_score * 0.08f);
            s_last_result.cognition_bonus   = min(8.0f, star_score * 0.08f);
            s_last_result.curiosity_bonus   = min(15.0f, star_score * 0.15f); // primary: curiosity
            s_last_result.affection_bonus   = 5.0f;
            s_last_result.miska_bonus       = 0.0f;
            s_last_result.cosmic_bonus      = min(12.0f, star_score * 0.12f); // primary: cosmic
            s_last_result.security_bonus    = 0.0f;
            s_last_result.moko_cost         = 4.0f;
            // Growth: constellations unlock cosmic vocabulary + dream-visions
            s_last_result.vocab_unlock      = min((uint8_t)3, star_constellation_idx);
            s_last_result.interaction_count = 2;
            s_last_result.triggers_dream    = star_session_complete; // full session = dream
            break;
    }

    Serial.print("[MINIGAME] Ended. Score: ");
    Serial.print(s_last_result.score);
    Serial.print(" | Vocab unlock: ");
    Serial.print(s_last_result.vocab_unlock);
    Serial.print(" | Interactions: ");
    Serial.print(s_last_result.interaction_count);
    Serial.print(" | Dream: ");
    Serial.println(s_last_result.triggers_dream ? "yes" : "no");
}

bool isPlaying() { return s_playing; }
GameType getCurrentGame() { return s_current_game; }

void update() {
    if (!s_playing) return;
    s_tick++;

    switch (s_current_game) {
        case GameType::ECHO_MEMORY:     echo_update();  break;
        case GameType::LIGHT_CLEANSING: clean_update(); break;
        case GameType::STAR_JOY:        star_update();  break;
    }

    // Auto-end conditions
    if (s_current_game == GameType::ECHO_MEMORY && echo_failed) {
        // Let the UI show failure for a moment, then end
        // (UI calls endGame after showing result)
    }
    if (s_current_game == GameType::LIGHT_CLEANSING && clean_complete) {
        // UI handles ending
    }
    if (s_current_game == GameType::STAR_JOY && star_session_complete) {
        // UI handles ending
    }
}

void handleTouch(int16_t x, int16_t y, bool pressed, bool dragging) {
    if (!s_playing) return;

    switch (s_current_game) {
        case GameType::ECHO_MEMORY:     echo_handle_touch(x, y, pressed, dragging);  break;
        case GameType::LIGHT_CLEANSING: clean_handle_touch(x, y, pressed, dragging); break;
        case GameType::STAR_JOY:        star_handle_touch(x, y, pressed, dragging);  break;
    }
}

GameResult getLastResult() { return s_last_result; }

// --- Echo Memory accessors ---
uint8_t echoGetLevel()      { return echo_seq_len; }
bool    echoIsPlayback()    { return echo_playback; }
int8_t  echoGetLitNode()    { return echo_lit_node; }
bool    echoIsFailed()      { return echo_failed; }
bool    echoIsSuccess()     { return echo_success; }

// --- Light Cleansing accessors ---
uint8_t cleanGetDustCount() {
    uint8_t count = 0;
    for (uint8_t i = 0; i < CLEAN_MAX_DUST; i++) {
        if (clean_dust[i].active) count++;
    }
    return count;
}

bool cleanGetDust(uint8_t index, int16_t& x, int16_t& y, uint8_t& hp) {
    if (index >= CLEAN_MAX_DUST || !clean_dust[index].active) return false;
    x  = clean_dust[index].x;
    y  = clean_dust[index].y;
    hp = clean_dust[index].hp;
    return true;
}

uint8_t cleanGetProgress() {
    if (clean_total_dust == 0) return 100;
    return (uint8_t)((clean_removed_dust * 100) / clean_total_dust);
}

bool cleanIsFlinching() { return clean_flinching; }

// --- Star Joy accessors ---
uint8_t starGetConstellation()      { return star_constellation_idx; }
uint8_t starGetTotalConstellations() { return star_total_constellations; }

uint8_t starGetStarCount() {
    return s_constellations[star_constellation_idx].star_count;
}

StarInfo starGetStar(uint8_t index) {
    StarInfo info = {0, 0, false};
    const ConstellationDef& c = s_constellations[star_constellation_idx];
    if (index >= c.star_count) return info;
    info.x = c.stars[index].x;
    info.y = c.stars[index].y;
    // Check if this star is part of any completed edge
    for (uint8_t e = 0; e < c.edge_count; e++) {
        if (star_edge_done[e] && (c.edges[e].from == index || c.edges[e].to == index)) {
            info.connected = true;
            break;
        }
    }
    return info;
}

uint8_t starGetEdgeCount() {
    return s_constellations[star_constellation_idx].edge_count;
}

ConstellationEdge starGetEdge(uint8_t index) {
    const ConstellationDef& c = s_constellations[star_constellation_idx];
    if (index >= c.edge_count) return {0, 0};
    return c.edges[index];
}

uint8_t starGetCompletedEdges() { return star_completed_edges; }
int8_t  starGetSelectedStar()   { return star_selected; }
bool    starIsConstellationComplete() { return star_const_complete; }
bool    starIsSessionComplete()       { return star_session_complete; }

} // namespace MiniGames
} // namespace Pet
