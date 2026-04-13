/**
 * save_manager.h — Autosave with power-loss protection
 * Write-to-temp + rename for atomicity. Keeps .bak for recovery.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace SaveManager {

    void init();

    /// Autosave dirty data (call every 60s).
    void autosave();

    /// Force immediate save of all data.
    void saveNow();

    /// Load pet state from SD. Returns false if no saved pet.
    bool loadPet();

    /// Mark pet data as dirty (needs save on next autosave).
    void markDirty();

    /// Returns true if there's unsaved data.
    bool isDirty();

} // namespace SaveManager
} // namespace Persistence
