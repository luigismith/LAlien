/**
 * speech_bubble.h — Speech bubble with typewriter effect
 * Shape varies with emotional state. ~30 chars/sec, chiptune blips.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace UI {
namespace SpeechBubble {

    enum class Mood : uint8_t {
        NEUTRAL,
        HAPPY,    // soft rounded bubble
        SAD,      // drooping bubble
        SCARED,   // jagged edges
        SICK,     // trembling bubble
        WISE,     // glowing border
    };

    void init();
    void show(const char* text, Mood mood = Mood::NEUTRAL);
    void hide();
    void update(); // call at ~30Hz for typewriter advance
    bool isAnimating(); // true while typewriter is running
    void skipAnimation(); // show all text immediately

} // namespace SpeechBubble
} // namespace UI
