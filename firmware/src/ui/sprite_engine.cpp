/**
 * sprite_engine.cpp — Sprite engine stub
 * Author: Claude Code | Date: 2026-04-13
 */
#include "sprite_engine.h"

namespace UI {
namespace SpriteEngine {

void init() {
    Serial.println("[SPRITE] Engine initialized");
}

bool loadSprite(uint8_t stage, uint8_t variant_index, const char* animation_name) {
    (void)stage; (void)variant_index; (void)animation_name;
    // TODO: load from SD, decode PNG, cache in SDRAM
    return false;
}

const uint16_t* getFrameData(uint8_t frame_index) {
    (void)frame_index;
    return nullptr;
}

uint8_t getFrameCount() { return 0; }
uint8_t getFPS() { return 8; }

void renderFrame(uint8_t frame_index, int16_t x, int16_t y, uint8_t scale) {
    (void)frame_index; (void)x; (void)y; (void)scale;
}

uint8_t tick() { return 0; }
void resetAnimation() {}
void setAnimation(const char* name) { (void)name; }
void clearCache() {}

} // namespace SpriteEngine
} // namespace UI
