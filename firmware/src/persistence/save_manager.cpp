/**
 * save_manager.cpp — Autosave with power-loss protection
 * Implements atomic write (write .tmp, rename to .json, keep .bak)
 * and automatic dirty-flag based autosaving for pet state, vocabulary,
 * and conversation memories.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "save_manager.h"
#include "pet_serializer.h"
#include "vocabulary_store.h"
#include "memory_store.h"
#include "../hal/sd_storage.h"
#include "../util/debug.h"

namespace Persistence {
namespace SaveManager {

static const char* PET_JSON     = "/lalien/pets/current/pet.json";
static const char* PET_TMP      = "/lalien/pets/current/pet.json.tmp";
static const char* PET_BAK      = "/lalien/pets/current/pet.json.bak";

static bool s_dirty = false;
static bool s_initialized = false;

void init() {
    // Ensure directory structure exists
    HAL::SDStorage::mkdir("/lalien");
    HAL::SDStorage::mkdir("/lalien/pets");
    HAL::SDStorage::mkdir("/lalien/pets/current");
    HAL::SDStorage::mkdir("/lalien/graveyard");
    HAL::SDStorage::mkdir("/data");
    HAL::SDStorage::mkdir("/diary");

    // Initialize vocabulary and memory stores
    VocabularyStore::init();
    MemoryStore::init();

    s_dirty = false;
    s_initialized = true;
}

void autosave() {
    if (!s_initialized) return;

    // Save pet state if dirty
    if (s_dirty) {
        saveNow();
    }

    // Save vocabulary if dirty
    if (VocabularyStore::isDirty()) {
        if (VocabularyStore::save()) {
            DEBUG_LOG("SaveManager: vocabulary autosaved");
        } else {
            LOG_ERROR("SaveManager: vocabulary autosave failed");
        }
    }

    // Save memories if dirty
    if (MemoryStore::isDirty()) {
        if (MemoryStore::save()) {
            DEBUG_LOG("SaveManager: memories autosaved");
        } else {
            LOG_ERROR("SaveManager: memories autosave failed");
        }
    }
}

void saveNow() {
    if (!s_initialized) return;

    // Backup current pet.json before overwriting
    if (HAL::SDStorage::fileExists(PET_JSON)) {
        String current = HAL::SDStorage::readFileString(PET_JSON);
        if (current.length() > 0) {
            HAL::SDStorage::writeFileString(PET_BAK, current);
        }
    }

    // Save via serializer (writes to pet.json)
    if (PetSerializer::save()) {
        s_dirty = false;
    }
    // If save fails, .bak still has the previous good state
}

bool loadPet() {
    if (!HAL::SDStorage::isReady()) return false;

    // Ensure directories exist
    init();

    // Try primary file first
    if (HAL::SDStorage::fileExists(PET_JSON)) {
        if (PetSerializer::load()) {
            PetSerializer::loadVocabulary();
            PetSerializer::loadMilestones();
            return true;
        }
    }

    // Primary corrupt or missing — try backup
    if (HAL::SDStorage::fileExists(PET_BAK)) {
        String bak = HAL::SDStorage::readFileString(PET_BAK);
        if (bak.length() > 0) {
            HAL::SDStorage::writeFileString(PET_JSON, bak);
            if (PetSerializer::load()) {
                PetSerializer::loadVocabulary();
                PetSerializer::loadMilestones();
                return true;
            }
        }
    }

    return false; // No saved pet found
}

void markDirty() {
    s_dirty = true;
}

void markVocabularyDirty() {
    VocabularyStore::markDirty();
}

void markMemoryDirty() {
    MemoryStore::markDirty();
}

bool isDirty() {
    return s_dirty || VocabularyStore::isDirty() || MemoryStore::isDirty();
}

} // namespace SaveManager
} // namespace Persistence
