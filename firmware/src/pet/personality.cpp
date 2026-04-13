/**
 * personality.cpp — Personality traits derived from DNA, woven into LLM system prompt
 * Maps DNA hash bytes to trait descriptions, food preferences, and time-of-day affinity.
 * All descriptions in Italian for the LLM system prompt.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "personality.h"

namespace Pet {
namespace Personality {

bool hasTrait(const DNA::DNAData& dna, Trait trait) {
    return (dna.personality_traits & (uint8_t)trait) != 0;
}

void getFoodPreferences(const DNA::DNAData& dna, uint8_t* prefs, uint8_t& count) {
    // Derive food preferences from DNA hash bytes 10-12
    // Each byte selects a food type index (0-7)
    static constexpr uint8_t NUM_FOOD_TYPES = 8;
    count = 0;

    // Up to 3 preferred foods, derived from hash bytes
    for (uint8_t i = 0; i < 3; i++) {
        uint8_t food_idx = dna.hash[10 + i] % NUM_FOOD_TYPES;
        // Avoid duplicates
        bool duplicate = false;
        for (uint8_t j = 0; j < count; j++) {
            if (prefs[j] == food_idx) { duplicate = true; break; }
        }
        if (!duplicate) {
            prefs[count++] = food_idx;
        }
    }
}

uint8_t getPreferredTimeOfDay(const DNA::DNAData& dna) {
    // 0=morning, 1=afternoon, 2=evening, 3=night
    return dna.hash[13] % 4;
}

String buildPromptBlock(const DNA::DNAData& dna) {
    String block = "## Personalita del Lalien\n";

    // Core personality traits
    block += "Tratti caratteriali: ";
    bool first = true;

    if (hasTrait(dna, CURIOUS)) {
        if (!first) block += ", ";
        block += "curioso e indagatore";
        first = false;
    }
    if (hasTrait(dna, AFFECTIONATE)) {
        if (!first) block += ", ";
        block += "affettuoso e premuroso";
        first = false;
    }
    if (hasTrait(dna, RESERVED)) {
        if (!first) block += ", ";
        block += "riservato e riflessivo";
        first = false;
    }
    if (hasTrait(dna, PLAYFUL)) {
        if (!first) block += ", ";
        block += "giocoso e vivace";
        first = false;
    }
    if (hasTrait(dna, CONTEMPLATIVE)) {
        if (!first) block += ", ";
        block += "contemplativo e profondo";
        first = false;
    }

    if (first) {
        block += "equilibrato e neutrale";
    }
    block += ".\n";

    // Visual description hints
    block += "Aspetto: ";
    if (dna.palette_warmth > 180) {
        block += "colori caldi e avvolgenti";
    } else if (dna.palette_warmth > 80) {
        block += "colori bilanciati";
    } else {
        block += "colori freddi e lunari";
    }

    if (dna.eye_size >= 3) {
        block += ", occhi grandi e espressivi";
    } else if (dna.eye_size == 0) {
        block += ", occhi piccoli e attenti";
    }

    if (dna.appendage_count >= 5) {
        block += ", molti appendici";
    } else if (dna.appendage_count <= 1) {
        block += ", forma semplice e minimale";
    }
    block += ".\n";

    // Food preferences
    static const char* FOOD_NAMES[] = {
        "luce stellare", "polvere cosmica", "rugiada lunare",
        "cristalli di nebulosa", "eco di supernova", "filamenti solari",
        "particelle quantiche", "essenza di buco nero"
    };
    uint8_t prefs[3];
    uint8_t pref_count;
    getFoodPreferences(dna, prefs, pref_count);

    block += "Cibi preferiti: ";
    for (uint8_t i = 0; i < pref_count; i++) {
        if (i > 0) block += ", ";
        block += FOOD_NAMES[prefs[i]];
    }
    block += ".\n";

    // Time of day preference
    static const char* TIME_NAMES[] = {
        "mattina (alba)", "pomeriggio (sole alto)",
        "sera (tramonto)", "notte (stelle)"
    };
    uint8_t tod = getPreferredTimeOfDay(dna);
    block += "Momento preferito: ";
    block += TIME_NAMES[tod];
    block += ".\n";

    return block;
}

} // namespace Personality
} // namespace Pet
