/**
 * minigames.h -- Mini-game system for Lalien Companion
 *
 * Three bonding rituals the keeper plays WITH their Lalien:
 *   1. Thishi-Revosh (Echo Memory)  -- pattern memory game
 *   2. Miska-Vythi (Light Cleansing) -- cleaning/grooming
 *   3. Selath-Nashi (Star Joy)       -- constellation drawing
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Pet {
namespace MiniGames {

    enum class GameType : uint8_t {
        ECHO_MEMORY,
        LIGHT_CLEANSING,
        STAR_JOY
    };

    /// Results from a completed game, applied to pet needs and growth.
    struct GameResult {
        uint16_t score;
        float nashi_bonus;       // fun/joy
        float cognition_bonus;   // cognitive development
        float curiosity_bonus;   // curiosity/exploration
        float affection_bonus;   // bond with keeper (navresh)
        float miska_bonus;       // hygiene/membrane health
        float cosmic_bonus;      // cosmic awareness (sèlath)
        float security_bonus;    // sense of safety
        float moko_cost;         // rest drain from playing
        // --- Growth effects ---
        uint8_t vocab_unlock;    // number of Lalìen words to unlock from Archive
        uint8_t interaction_count; // counts as N touch interactions for evolution
        bool    triggers_dream;  // if true, triggers a mokó-thishí (dream-vision)
    };

    /// Initialize the mini-game subsystem. Call once at startup.
    void init();

    /// Start a game. Resets all internal state for the chosen game.
    void startGame(GameType type);

    /// End the current game (if any). Calculates final result.
    void endGame();

    /// True if a game is currently in progress.
    bool isPlaying();

    /// Which game is active (only valid when isPlaying() == true).
    GameType getCurrentGame();

    /// Called by UI at ~30Hz during gameplay to advance game logic.
    void update();

    /// Handle touch input during gameplay.
    /// @param x,y     screen coordinates
    /// @param pressed true while finger is down
    /// @param dragging true if finger moved since press
    void handleTouch(int16_t x, int16_t y, bool pressed, bool dragging);

    /// Retrieve the result of the last completed game.
    GameResult getLastResult();

    // --- Echo Memory accessors (used by screen renderer) ---

    /// Number of resonance nodes.
    static constexpr uint8_t ECHO_NODE_COUNT = 6;
    /// Current sequence length.
    uint8_t echoGetLevel();
    /// True if the pet is currently playing back its sequence.
    bool echoIsPlayback();
    /// Index of the node currently lit during playback (-1 if none).
    int8_t echoGetLitNode();
    /// True if game just ended (wrong tap).
    bool echoIsFailed();
    /// True if player just completed a round successfully.
    bool echoIsSuccess();

    // --- Light Cleansing accessors ---

    static constexpr uint8_t CLEAN_MAX_DUST = 40;
    /// Number of active dust particles.
    uint8_t cleanGetDustCount();
    /// Get dust particle position (index 0..CLEAN_MAX_DUST-1).
    /// Returns false if particle inactive.
    bool cleanGetDust(uint8_t index, int16_t& x, int16_t& y, uint8_t& hp);
    /// Cleanliness percentage 0-100.
    uint8_t cleanGetProgress();
    /// True if pet is flinching from rough touch.
    bool cleanIsFlinching();

    // --- Star Joy accessors ---

    static constexpr uint8_t STAR_MAX_STARS = 8;
    static constexpr uint8_t STAR_MAX_CONSTELLATIONS = 5;

    struct StarInfo {
        int16_t x, y;
        bool connected;    // part of a completed edge
    };

    struct ConstellationEdge {
        uint8_t from, to;
    };

    /// Current constellation index (0-based).
    uint8_t starGetConstellation();
    /// Total constellations in this session.
    uint8_t starGetTotalConstellations();
    /// Number of stars in current constellation.
    uint8_t starGetStarCount();
    /// Get star info by index.
    StarInfo starGetStar(uint8_t index);
    /// Number of edges in current constellation.
    uint8_t starGetEdgeCount();
    /// Get edge by index.
    ConstellationEdge starGetEdge(uint8_t index);
    /// Number of edges the player has completed.
    uint8_t starGetCompletedEdges();
    /// Currently selected (first-tap) star, or -1.
    int8_t starGetSelectedStar();
    /// True if current constellation just completed.
    bool starIsConstellationComplete();
    /// True if all constellations done.
    bool starIsSessionComplete();

} // namespace MiniGames
} // namespace Pet
