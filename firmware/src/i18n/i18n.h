/**
 * i18n.h — Internationalization: load UI strings from SD card lang packs
 * Supports: it (default), en, es, fr, de
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace I18n {

    /// Load language pack from SD card. lang = "it", "en", "es", "fr", "de".
    bool load(const char* lang);

    /// Get localized string by key. Returns key itself if not found.
    const char* get(const char* key);

    /// Get current language code.
    const char* getCurrentLang();

    /// Shorthand macro
    #define _(key) I18n::get(key)

} // namespace I18n
