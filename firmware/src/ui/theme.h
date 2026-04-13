/**
 * theme.h — Dark Mediterranean visual theme
 * Deep black, gold accents, night blue, pet core color as highlight.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace UI {
namespace Theme {

    // Core palette (RGB565)
    static constexpr uint16_t BG_BLACK       = 0x0000;
    static constexpr uint16_t GOLD_ACCENT    = 0xFE60; // warm gold
    static constexpr uint16_t NIGHT_BLUE     = 0x1928; // deep blue
    static constexpr uint16_t TEXT_PRIMARY    = 0xF79E; // off-white
    static constexpr uint16_t TEXT_SECONDARY  = 0x9CD3; // muted gray
    static constexpr uint16_t DANGER_RED      = 0xF800;
    static constexpr uint16_t SUCCESS_GREEN   = 0x07E0;

    /// Initialize LVGL theme styles.
    void init();

    /// Set pet core color as dynamic highlight (changes with mood/DNA).
    void setPetHighlight(uint16_t color);

    /// Get current pet highlight color.
    uint16_t getPetHighlight();

} // namespace Theme
} // namespace UI
