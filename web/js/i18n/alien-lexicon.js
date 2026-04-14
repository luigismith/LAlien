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
        const lower = text.toLowerCase();
        const found = [];
        for (const entry of _allWords) {
            const w = entry.word.toLowerCase();
            if (_discovered.has(w)) continue;
            // Word-boundary match — handles Italian punctuation decently
            const re = new RegExp('(^|[^a-z\u00c0-\u017f])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z\u00c0-\u017f])', 'i');
            if (re.test(lower)) {
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
