/**
 * pet_serializer.h — Serialize/deserialize pet state to/from JSON
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace PetSerializer {

    /// Save current pet state to /lalien/pets/current/pet.json.
    bool save();

    /// Load pet state from /lalien/pets/current/pet.json.
    bool load();

    /// Save vocabulary to /lalien/pets/current/vocabulary.json.
    bool saveVocabulary();

    /// Load vocabulary from /lalien/pets/current/vocabulary.json.
    bool loadVocabulary();

    /// Save milestones.
    bool saveMilestones();
    bool loadMilestones();

} // namespace PetSerializer
} // namespace Persistence
