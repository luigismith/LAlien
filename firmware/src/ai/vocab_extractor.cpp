/**
 * vocab_extractor.cpp --- Vocabulary extraction from user messages
 * Parses each user message for significant words (length >= 3, not
 * stop-words), tracks frequency and first/last seen timestamps,
 * and persists to SD as vocabulary.json. The top N words are included
 * in the system prompt to shape the creature's language learning.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "vocab_extractor.h"
#include "../hal/sd_storage.h"
#include "../pet/pet_internal.h"
#include <ArduinoJson.h>

namespace AI {
namespace VocabExtractor {

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

static const char* VOCAB_PATH = "/lalien/pets/current/vocabulary.json";

static VocabEntry s_vocab[MAX_VOCAB];
static uint16_t s_count = 0;
static bool s_dirty = false;

// ---------------------------------------------------------------------------
// Stop words (common words to skip in extraction)
// Multi-language stop words for it/en/es/fr/de
// ---------------------------------------------------------------------------

static const char* STOP_WORDS[] = {
    // English
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
    "neither", "each", "every", "all", "any", "few", "more", "most",
    "other", "some", "such", "no", "only", "own", "same", "than", "too",
    "very", "just", "because", "about", "between", "under", "again",
    "it", "its", "this", "that", "these", "those", "i", "me", "my",
    "you", "your", "he", "she", "we", "they", "him", "her", "his",
    "our", "them", "what", "which", "who", "whom", "how", "when",
    "where", "why", "if", "then", "else", "here", "there", "up", "out",
    // Italian
    "il", "lo", "la", "le", "li", "gli", "un", "una", "uno",
    "di", "del", "dello", "della", "dei", "degli", "delle",
    "da", "dal", "dallo", "dalla", "dai", "dagli", "dalle",
    "su", "sul", "sullo", "sulla", "sui", "sugli", "sulle",
    "con", "per", "tra", "fra", "che", "chi", "cui", "non",
    "mi", "ti", "si", "ci", "vi", "ne", "io", "tu", "lui", "lei",
    "noi", "voi", "loro", "mio", "tuo", "suo", "nostro", "vostro",
    "ma", "anche", "come", "cosa", "sono", "sei", "era", "hai",
    "ho", "ha", "hanno", "questo", "quello", "questa", "quella",
    // Spanish
    "el", "los", "las", "del", "al", "con", "por", "para",
    "que", "una", "uno", "unos", "unas", "es", "son", "fue",
    "yo", "tu", "nos", "les", "sus", "mas", "pero", "como",
    // French
    "le", "les", "des", "du", "au", "aux", "une", "est", "sont",
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
    "mon", "ton", "son", "mes", "tes", "ses", "pas", "qui",
    "que", "dans", "sur", "avec", "pour", "par", "mais", "ou",
    // German
    "der", "die", "das", "den", "dem", "des", "ein", "eine",
    "einer", "einem", "einen", "ist", "sind", "war", "ich",
    "du", "er", "sie", "wir", "ihr", "und", "oder", "aber",
    "auf", "mit", "von", "aus", "bei", "nach", "zu", "zum",
    "zur", "fur", "nicht", "was", "wie", "wenn", "dann",
    nullptr
};

static bool isStopWord(const char* word) {
    for (int i = 0; STOP_WORDS[i] != nullptr; i++) {
        if (strcasecmp(word, STOP_WORDS[i]) == 0) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Find existing entry by word (case-insensitive)
// ---------------------------------------------------------------------------

static int16_t findWord(const char* word) {
    for (uint16_t i = 0; i < s_count; i++) {
        if (strcasecmp(s_vocab[i].word, word) == 0) {
            return (int16_t)i;
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Add or update a word entry
// ---------------------------------------------------------------------------

static void addOrUpdateWord(const char* word, const char* emotion) {
    uint32_t now = millis() / 1000;

    int16_t idx = findWord(word);
    if (idx >= 0) {
        // Update existing entry
        s_vocab[idx].frequency++;
        s_vocab[idx].last_seen = now;
        s_dirty = true;
        return;
    }

    // Add new entry
    if (s_count >= MAX_VOCAB) {
        // Find least frequent word and replace it
        uint16_t min_freq = 0xFFFF;
        uint16_t min_idx = 0;
        for (uint16_t i = 0; i < s_count; i++) {
            if (s_vocab[i].frequency < min_freq) {
                min_freq = s_vocab[i].frequency;
                min_idx = i;
            }
        }
        idx = min_idx;
    } else {
        idx = s_count;
        s_count++;
    }

    strncpy(s_vocab[idx].word, word, sizeof(s_vocab[idx].word) - 1);
    s_vocab[idx].word[sizeof(s_vocab[idx].word) - 1] = '\0';
    s_vocab[idx].frequency = 1;
    s_vocab[idx].first_seen = now;
    s_vocab[idx].last_seen = now;

    if (emotion && strlen(emotion) > 0) {
        strncpy(s_vocab[idx].emotion, emotion, sizeof(s_vocab[idx].emotion) - 1);
        s_vocab[idx].emotion[sizeof(s_vocab[idx].emotion) - 1] = '\0';
    } else {
        strcpy(s_vocab[idx].emotion, "neutral");
    }

    s_dirty = true;

    // Update pet vocabulary size
    Pet::Internal::setVocabularySize(s_count);
}

// ---------------------------------------------------------------------------
// Check if character is a word separator
// ---------------------------------------------------------------------------

static bool isSeparator(char c) {
    return c == ' ' || c == ',' || c == '.' || c == '!' || c == '?'
        || c == ';' || c == ':' || c == '\'' || c == '"'
        || c == '(' || c == ')' || c == '\n' || c == '\r'
        || c == '\t' || c == '-';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void init() {
    s_count = 0;
    s_dirty = false;
    memset(s_vocab, 0, sizeof(s_vocab));

    if (load()) {
        Serial.println("[VOCAB] Loaded " + String(s_count) + " words from SD");
    } else {
        Serial.println("[VOCAB] No vocabulary file found, starting fresh");
    }
}

void extractFromMessage(const String& user_message, const char* mood) {
    if (user_message.length() == 0) return;

    // Tokenize the message by whitespace and punctuation
    String msg = user_message;
    msg.toLowerCase();

    int start = 0;
    int len = msg.length();
    uint8_t words_extracted = 0;

    for (int i = 0; i <= len; i++) {
        bool at_end = (i == len);
        bool is_sep = at_end || isSeparator(msg.charAt(i));

        if (is_sep && i > start) {
            String token = msg.substring(start, i);

            // Filter: minimum length 3, not a stop word, only alpha chars
            if (token.length() >= 3 && !isStopWord(token.c_str())) {
                // Verify all characters are alphabetic
                bool all_alpha = true;
                for (unsigned int j = 0; j < token.length(); j++) {
                    char c = token.charAt(j);
                    if (!isalpha(c) && c != '\'' && c != '-') {
                        all_alpha = false;
                        break;
                    }
                }

                if (all_alpha) {
                    addOrUpdateWord(token.c_str(), mood);
                    words_extracted++;
                }
            }
            start = i + 1;
        } else if (is_sep) {
            start = i + 1;
        }
    }

    if (words_extracted > 0) {
        Serial.println("[VOCAB] Extracted " + String(words_extracted)
                       + " words, total: " + String(s_count));
        // Auto-save periodically
        if (s_dirty) {
            save();
        }
    }
}

bool save() {
    if (s_count == 0) return true;

    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();

    for (uint16_t i = 0; i < s_count; i++) {
        JsonObject entry = arr.add<JsonObject>();
        entry["w"] = s_vocab[i].word;
        entry["f"] = s_vocab[i].frequency;
        entry["fs"] = s_vocab[i].first_seen;
        entry["ls"] = s_vocab[i].last_seen;
        entry["e"] = s_vocab[i].emotion;
    }

    String json;
    serializeJson(doc, json);

    bool ok = HAL::SDStorage::writeFileString(VOCAB_PATH, json);
    if (ok) {
        s_dirty = false;
        Serial.println("[VOCAB] Saved " + String(s_count) + " entries to SD");
    } else {
        Serial.println("[VOCAB] Failed to save vocabulary to SD");
    }
    return ok;
}

bool load() {
    String content = HAL::SDStorage::readFileString(VOCAB_PATH);
    if (content.length() == 0) return false;

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, content);
    if (err) {
        Serial.println("[VOCAB] JSON parse error: " + String(err.c_str()));
        return false;
    }

    JsonArray arr = doc.as<JsonArray>();
    s_count = 0;

    for (JsonObject entry : arr) {
        if (s_count >= MAX_VOCAB) break;

        const char* word = entry["w"] | "";
        if (strlen(word) == 0) continue;

        strncpy(s_vocab[s_count].word, word, sizeof(s_vocab[s_count].word) - 1);
        s_vocab[s_count].word[sizeof(s_vocab[s_count].word) - 1] = '\0';
        s_vocab[s_count].frequency = entry["f"] | 1;
        s_vocab[s_count].first_seen = entry["fs"] | 0;
        s_vocab[s_count].last_seen = entry["ls"] | 0;

        const char* emotion = entry["e"] | "neutral";
        strncpy(s_vocab[s_count].emotion, emotion, sizeof(s_vocab[s_count].emotion) - 1);
        s_vocab[s_count].emotion[sizeof(s_vocab[s_count].emotion) - 1] = '\0';

        s_count++;
    }

    // Sync pet state
    Pet::Internal::setVocabularySize(s_count);
    s_dirty = false;
    return true;
}

uint16_t getCount() {
    return s_count;
}

String buildPromptBlock(uint8_t max_words) {
    if (s_count == 0) return "";

    // Sort indices by frequency (descending) without modifying the array
    // Use a simple selection of top N
    uint16_t top_indices[MAX_PROMPT_WORDS];
    uint8_t top_count = 0;
    bool used[MAX_VOCAB];
    memset(used, false, sizeof(used));

    uint8_t limit = min((uint8_t)s_count, max_words);

    for (uint8_t n = 0; n < limit; n++) {
        uint16_t best_freq = 0;
        int16_t best_idx = -1;

        for (uint16_t i = 0; i < s_count; i++) {
            if (!used[i] && s_vocab[i].frequency > best_freq) {
                best_freq = s_vocab[i].frequency;
                best_idx = i;
            }
        }

        if (best_idx < 0) break;

        used[best_idx] = true;
        top_indices[top_count] = best_idx;
        top_count++;
    }

    if (top_count == 0) return "";

    String block;
    block.reserve(256);
    block += "[VOCABULARY_ACQUIRED]\n";
    block += "Words your keeper uses often (you are learning these):\n";

    for (uint8_t i = 0; i < top_count; i++) {
        uint16_t idx = top_indices[i];
        block += "- \"";
        block += s_vocab[idx].word;
        block += "\" (heard ";
        block += String(s_vocab[idx].frequency);
        block += "x)\n";
    }

    block += "Total words learned: ";
    block += String(s_count);
    block += "\n";

    return block;
}

bool getEntry(uint16_t index, VocabEntry& out) {
    if (index >= s_count) return false;
    memcpy(&out, &s_vocab[index], sizeof(VocabEntry));
    return true;
}

} // namespace VocabExtractor
} // namespace AI
