/**
 * sprite_engine.h — Sprite loading, caching, and rendering from SD card
 * Loads PNG sprite sheets, LRU cache in SDRAM, blits at 4x scale
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace UI {
namespace SpriteEngine {

    void init();

    /// Load sprite sheet for given stage, variant, animation.
    /// Returns true if loaded (from cache or SD).
    bool loadSprite(uint8_t stage, uint8_t variant_index, const char* animation_name);

    /// Get current frame pixel data (64x64, RGB565).
    const uint16_t* getFrameData(uint8_t frame_index);

    /// Get frame count for currently loaded animation.
    uint8_t getFrameCount();

    /// Get recommended FPS for currently loaded animation.
    uint8_t getFPS();

    /// Render current frame to LVGL canvas at position (x,y) with scale factor.
    void renderFrame(uint8_t frame_index, int16_t x, int16_t y, uint8_t scale = 4);

    /// Advance animation by one tick. Returns current frame index.
    uint8_t tick();

    /// Reset animation to frame 0.
    void resetAnimation();

    /// Set animation by name (e.g., "idle", "happy", "sad").
    void setAnimation(const char* name);

    /// Clear cache (free SDRAM).
    void clearCache();

} // namespace SpriteEngine
} // namespace UI
