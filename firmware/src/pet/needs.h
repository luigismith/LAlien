/**
 * needs.h — 10-need system with decay and care mechanics
 * All needs on 0-100 scale. Decay rates configurable.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Pet {

enum class NeedType : uint8_t {
    KORA = 0,       // hunger
    MOKO,           // rest
    MISKA,          // hygiene
    NASHI,          // happiness
    HEALTH,         // derived from others
    COGNITION,      // mental stimulation
    AFFECTION,      // bond
    CURIOSITY,      // variety
    COSMIC,         // cosmic connection (lalí-vÿthi)
    SECURITY,       // environmental stability
    COUNT
};

struct NeedsState {
    float values[(uint8_t)NeedType::COUNT];

    float get(NeedType n) const { return values[(uint8_t)n]; }
    void set(NeedType n, float v) { values[(uint8_t)n] = constrain(v, 0.0f, 100.0f); }
    void add(NeedType n, float delta) { set(n, get(n) + delta); }
};

namespace Needs {

    void init();

    /// Decay all needs by one tick (1 second of game time).
    void decay(NeedsState& state, float time_multiplier);

    /// Apply a care action.
    void feed(NeedsState& state);
    void sleep(NeedsState& state);
    void clean(NeedsState& state);
    void play(NeedsState& state);
    void talk(NeedsState& state);
    void caress(NeedsState& state);
    void meditate(NeedsState& state);

    /// Check for pathological states.
    bool isZevol(const NeedsState& state);   // disease
    bool isMorak(const NeedsState& state);   // chronic fear
    bool isVelin(const NeedsState& state);   // depression
    bool isRenaThishi(const NeedsState& state); // home calling

    /// Get overall wellness (0-100).
    float getOverallWellness(const NeedsState& state);

} // namespace Needs
} // namespace Pet
