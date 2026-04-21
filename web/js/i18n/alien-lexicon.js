/**
 * alien-lexicon.js -- Alien vocabulary manager
 * Loads the full alien vocabulary, tracks discovered words
 */

let _allWords = [];
let _discovered = new Set();
let _discoveredList = []; // { word, discoveredAt }

export const AlienLexicon = {
    async load() {
        try {
            const res = await fetch('lang/alien.json');
            if (res.ok) {
                _allWords = await res.json();
            }
        } catch (e) {
            console.warn('[LEXICON] Failed to load alien vocabulary:', e);
            _allWords = [];
        }
    },

    getAllWords(category) {
        if (!category) return _allWords;
        return _allWords.filter(w => w.category === category);
    },

    getCategories() {
        const cats = new Set();
        for (const w of _allWords) cats.add(w.category);
        return [...cats];
    },

    getWordsByStage(maxStage) {
        return _allWords.filter(w => w.stage_available <= maxStage);
    },

    getDiscoveredWords() {
        return [..._discoveredList];
    },

    getDiscoveredWordSet() {
        return new Set(_discovered);
    },

    getDiscoveredCount() {
        return _discovered.size;
    },

    isDiscovered(word) {
        return _discovered.has(word.toLowerCase());
    },

    /**
     * Mark a word as discovered.
     * @param {string} word
     * @param {'pet'|'keeper'} [source='pet']  who taught it — pet's own utterance or keeper's input
     */
    discover(word, source = 'pet') {
        const lower = word.toLowerCase();
        if (_discovered.has(lower)) return false;
        _discovered.add(lower);
        _discoveredList.push({ word: lower, discoveredAt: Date.now(), source });
        // Fire off the discovery event — the game-loop listens and applies the
        // need bursts. Dynamic import avoids a circular dep with the engine.
        try {
            import('../engine/events.js').then(m => {
                m.Events.emit('lexicon-word-discovered', {
                    word: lower,
                    source,
                    total: _discovered.size,
                });
            }).catch(() => {});
        } catch (_) {}
        return true;
    },

    tryDiscover(word, source = 'pet') {
        // Check if word matches any alien word
        const lower = word.toLowerCase();
        const match = _allWords.find(w => w.word.toLowerCase() === lower);
        if (match && !_discovered.has(lower)) {
            this.discover(lower, source);
            return true;
        }
        return false;
    },

    /**
     * Scan arbitrary text and discover every alien word found.
     * @param {string} text
     * @param {'pet'|'keeper'} source
     * @returns {string[]} list of newly discovered words
     */
    discoverFromText(text, source = 'pet') {
        if (!text || !_allWords.length) return [];
        // Strip diacritics for matching so "kora" matches "kòra", "moko" matches "mokó", etc.
        const stripDiacritics = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Also strip hyphens and periods that split alien words ("mo-ko" → "moko")
        const normalize = (s) => stripDiacritics(s.toLowerCase()).replace(/[-.]/g, '');
        const flat = normalize(text);
        const found = [];
        for (const entry of _allWords) {
            const w = entry.word.toLowerCase();
            if (_discovered.has(w)) continue;
            const wn = normalize(w);
            if (!wn) continue;
            // Word-boundary match against the normalized text
            const re = new RegExp('(^|[^a-z0-9])' + wn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
            if (re.test(flat)) {
                this.discover(w, source);
                found.push(w);
            }
        }
        return found;
    },

    /** How many words were taught by the keeper (bidirectional metric) */
    getTaughtCount() {
        return _discoveredList.filter(e => e.source === 'keeper').length;
    },

    restoreDiscovered(data) {
        _discovered = new Set();
        _discoveredList = [];
        if (Array.isArray(data)) {
            for (const item of data) {
                const word = typeof item === 'string' ? item : item.word;
                if (word) {
                    _discovered.add(word.toLowerCase());
                    _discoveredList.push(typeof item === 'string' ? { word, discoveredAt: 0 } : item);
                }
            }
        }
    },

    // Look up a word and return its full entry
    lookup(word) {
        return _allWords.find(w => w.word.toLowerCase() === word.toLowerCase()) || null;
    },
};
