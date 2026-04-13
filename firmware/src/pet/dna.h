/**
 * dna.h — Phonetic DNA: sensor data at hatching → SHA-256 → visual + personality params
 * Immutable for the pet's entire life.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Pet {
namespace DNA {

    static constexpr uint8_t DNA_HASH_LEN = 32; // SHA-256

    struct DNAData {
        uint8_t hash[DNA_HASH_LEN];

        // Derived parameters (computed once from hash, cached)
        uint8_t variant_index;       // sprite variant selection
        uint8_t appendage_count;     // 0-6
        uint8_t appendage_length;    // 0-3 (short to long)
        uint8_t eye_size;            // 0-3
        uint8_t core_pattern;        // 0-7
        uint8_t body_curvature;      // 0-3
        uint8_t palette_warmth;      // 0-255 (0=cold, 255=warm)
        uint8_t personality_traits;  // bitfield: curious, affectionate, reserved, playful, contemplative
        uint16_t core_hue;           // 0-360
    };

    /// Collect ~3 seconds of sensor data and compute DNA hash.
    /// Blocks during collection. Call once at hatching.
    DNAData generate();

    /// Derive visual and personality parameters from hash.
    void deriveParams(DNAData& dna);

    /// Load DNA from saved data.
    DNAData fromHash(const uint8_t* hash);

    /// Get personality description string for LLM system prompt.
    String getPersonalityDescription(const DNAData& dna);

} // namespace DNA
} // namespace Pet
