/**
 * i18n.js -- Internationalization with JSON language packs
 * Supports it/en/es/fr/de
 */

let _strings = {};
let _fallback = {};
let _currentLang = 'it';

export const I18n = {
    async load(langCode) {
        _currentLang = langCode || 'it';
        try {
            const res = await fetch(`lang/${_currentLang}.json`);
            if (res.ok) _strings = await res.json();
        } catch (e) {
            console.warn(`[I18N] Failed to load ${_currentLang}:`, e);
        }

        // Load English as fallback
        if (_currentLang !== 'en') {
            try {
                const res = await fetch('lang/en.json');
                if (res.ok) _fallback = await res.json();
            } catch { /* ignore */ }
        }
    },

    get(key) {
        return _strings[key] || _fallback[key] || key;
    },

    getLang() {
        return _currentLang;
    },
};
