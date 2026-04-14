/**
 * diary-generator.js -- Auto-generate diary entries + memory log
 * Port of firmware diary and memory systems
 */
import { LLMClient } from './llm-client.js';
import { SystemPrompt } from './system-prompt.js';
import { Pet } from '../pet/pet.js';
import { AlienLexicon } from '../i18n/alien-lexicon.js';

const MAX_MEMORIES = 20;
const DIARY_INTERVAL_CONVERSATIONS = 5; // generate diary every N conversations

let _memories = [];
let _diary = [];
let _conversationsSinceDiary = 0;

// Stop words for vocabulary extraction
const STOP_WORDS = new Set([
    'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
    'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
    'e', 'o', 'ma', 'che', 'non', 'si', 'mi', 'ti', 'ci', 'vi',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'and', 'or', 'but', 'not', 'no', 'yes', 'this', 'that',
    'it', 'he', 'she', 'we', 'they', 'you', 'me', 'him', 'her',
    'my', 'your', 'his', 'its', 'our', 'their',
    'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'must',
]);

function extractVocab(text) {
    if (!text) return [];
    const words = text.toLowerCase()
        .replace(/[^\w\u00C0-\u024F\s'-]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
    return [...new Set(words)];
}

export const DiaryGenerator = {
    logMemory(type, text) {
        _memories.push({ type, text, timestamp: Date.now() });
        if (_memories.length > MAX_MEMORIES) _memories.shift();
    },

    getRecentMemories(count) {
        return _memories.slice(-count);
    },

    getMemorySummary(count) {
        return _memories.slice(-count).map(m => `${m.type}: ${m.text}`).join('; ');
    },

    restoreMemories(data) {
        _memories = Array.isArray(data) ? data : [];
    },

    getMemories() { return [..._memories]; },

    // Diary entries
    restore(data) {
        _diary = Array.isArray(data) ? data : [];
    },

    getDiary() { return [..._diary]; },

    async onConversationEnd(petResponse) {
        // Extract vocabulary from response
        const words = extractVocab(petResponse);
        for (const w of words) {
            AlienLexicon.tryDiscover(w);
        }

        _conversationsSinceDiary++;

        // Check if it's time to generate a diary entry
        if (_conversationsSinceDiary >= DIARY_INTERVAL_CONVERSATIONS && LLMClient.isAvailable()) {
            _conversationsSinceDiary = 0;
            await this.generateDiary();
        }

        // Save updated data
        const { Persistence } = await import('../engine/persistence.js');
        await Persistence.saveMemories(_memories);
        await Persistence.saveVocabulary(AlienLexicon.getDiscoveredWords());
    },

    async generateDiary() {
        if (!LLMClient.isAvailable()) return;

        try {
            const events = this.getMemorySummary(5);
            const prompt = SystemPrompt.buildDiaryPrompt(events);
            const entry = await LLMClient.generateDiary(prompt);

            if (entry) {
                const diaryEntry = {
                    day: Pet.getAgeDays(),
                    stage: Pet.stage,
                    text: entry,
                    timestamp: Date.now(),
                };
                _diary.push(diaryEntry);
                Pet.diaryEntries = _diary.length;

                // Extract vocab from diary too
                const words = extractVocab(entry);
                for (const w of words) {
                    AlienLexicon.tryDiscover(w);
                }

                const { Persistence } = await import('../engine/persistence.js');
                await Persistence.saveDiary(_diary);

                console.log('[DIARY] Generated entry for day', diaryEntry.day);
            }
        } catch (e) {
            console.error('[DIARY] Generation failed:', e);
        }
    },

    async generateLastWords(deathCause) {
        if (!LLMClient.isAvailable()) return '... kesma-thi ... ko ...';

        try {
            const milestones = this.getMemorySummary(10);
            const prompt = SystemPrompt.buildLastWordsPrompt(deathCause, milestones);
            return await LLMClient.generateLastWords(prompt);
        } catch (e) {
            console.error('[DIARY] Last words generation failed:', e);
            return '... kesma-thi ... thera-lashi ... ko ...';
        }
    },
};
