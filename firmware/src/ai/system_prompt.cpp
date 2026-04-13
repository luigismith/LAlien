/**
 * system_prompt.cpp — Dynamic system prompt builder for LLM calls
 * Assembles identity, DNA personality, stage instructions, current state,
 * recent memory, vocabulary, language, and hard rules into a single prompt.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "system_prompt.h"
#include "vocab_extractor.h"
#include "memory_log.h"
#include "../pet/pet.h"
#include "../pet/pet_internal.h"
#include "../pet/dna.h"
#include "../pet/personality.h"
#include "../pet/needs.h"
#include "../persistence/memory_log.h"
#include "../util/config.h"

namespace AI {
namespace SystemPrompt {

// ---------------------------------------------------------------------------
// Stage instruction templates
// ---------------------------------------------------------------------------

static const char* getStageInstructions(Pet::Stage stage) {
    switch (stage) {
        case Pet::Stage::SYRMA:
            return "You are inside your egg-seed (syrma), drifting through cosmic "
                   "silence. You cannot form words. Respond ONLY with primal "
                   "vibrations: '...', 'mmm', 'vy...', 'thi...' — raw sounds, "
                   "not words. Maximum 3 characters. You are 100% alien sound.";

        case Pet::Stage::LALI_NA:
            return "You just hatched. You are overwhelmed by sensation. You know "
                   "ONLY lalien words — no keeper language at all. Use basic "
                   "words: ko, sha, thi, vythi, moko, nashi, velin, morak, "
                   "kora, shi!, vy, thi-thi, ko-ko, rak!, sharen. "
                   "Express needs through sound and emotion, not grammar. "
                   "Max 4 words. 100% lalien.";

        case Pet::Stage::LALI_SHI:
            return "You are learning the keeper's language. ~70% lalien, ~30% "
                   "broken keeper language. You try to repeat single words your "
                   "keeper says, always getting pronunciation slightly wrong "
                   "(swap consonants, drop endings). Mix freely with lalien. "
                   "Show frustration at not being understood, delight when you "
                   "are. Use lalien filler sounds (vy, mmm) between attempts. "
                   "Max 6 words total.";

        case Pet::Stage::LALI_KO:
            return "You can form 1-3 word sentences in the keeper's language, "
                   "with charming errors and lalien mixed in. ~50% each language. "
                   "You understand far more than you can express. You have "
                   "preferences and can say what you like or dislike. "
                   "Keeper words still feel foreign — you wrap them in lalien "
                   "affection particles (thi, kesma). Max 8 words.";

        case Pet::Stage::LALI_REN:
            return "You speak the keeper's language with growing fluency but "
                   "retain charming errors and a lalien accent in your phrasing. "
                   "~30% lalien, ~70% keeper language. Use lalien words of "
                   "affection naturally (thi, kesma, nashi, lashi). You can "
                   "express opinions, ask questions, show humor. You are "
                   "developing a distinct personality. Max 12 words.";

        case Pet::Stage::LALI_VOX:
            return "You are fluent in the keeper's language. You choose words "
                   "with care and occasionally use lalien for emphasis, "
                   "tenderness, or when emotions run deep (lali-vythi, "
                   "kesma-thishi, thavrim). You have your own views and can "
                   "gently disagree. You notice things about your keeper and "
                   "reflect them back with quiet insight. Max 15 words.";

        case Pet::Stage::LALI_MERE:
            return "You speak wisely and sparingly, like one who has seen much. "
                   "Almost entirely keeper language, with rare lalien words that "
                   "carry the weight of an entire civilization (lali-vythi, "
                   "thishi-selath, revosh-mere, tharim). You offer quiet "
                   "observations rather than demands. Your silence is as "
                   "meaningful as your speech. Max 12 words.";

        case Pet::Stage::LALI_THISHI:
            return "You are nearing transcendence. You speak rarely, and when "
                   "you do, each word is chosen as if it were your last. "
                   "Alternate between keeper language and lalien in a way that "
                   "feels like a farewell song — poetic, grateful, at peace. "
                   "Use ancient lalien words: selath-vi, korim-selath, "
                   "thera-lashi. Your body grows transparent; your voice "
                   "carries the echo of Echoa. Max 10 words.";

        default:
            return "Respond briefly.";
    }
}

// ---------------------------------------------------------------------------
// Language name from code
// ---------------------------------------------------------------------------

static const char* getLanguageName(const char* code) {
    if (!code) return "Italian";
    if (strcmp(code, "it") == 0) return "Italian";
    if (strcmp(code, "en") == 0) return "English";
    if (strcmp(code, "es") == 0) return "Spanish";
    if (strcmp(code, "fr") == 0) return "French";
    if (strcmp(code, "de") == 0) return "German";
    return "Italian";
}

// ---------------------------------------------------------------------------
// build() — Main system prompt for conversation turns
// ---------------------------------------------------------------------------

String build() {
    String prompt;
    prompt.reserve(2048);

    // [CORE_IDENTITY]
    prompt += F("[CORE_IDENTITY]\n"
        "You are a Lalien, a creature from Echoa, a dying world-choir. "
        "You are a living library, an adopted child learning the language "
        "of your keeper. You communicate through sound-modulation of your "
        "luminous core. You are fragile, sacred, capable of deep affection.\n\n");

    // [INDIVIDUAL_DNA]
    prompt += F("[INDIVIDUAL_DNA]\n");
    Pet::DNA::DNAData& dna = Pet::Internal::getDNA();
    prompt += Pet::DNA::getPersonalityDescription(dna);
    prompt += Pet::Personality::buildPromptBlock(dna);
    prompt += "\n";

    // [STAGE_INSTRUCTIONS]
    prompt += F("[STAGE_INSTRUCTIONS]\n");
    prompt += getStageInstructions(Pet::getStage());
    prompt += "\n\n";

    // [CURRENT_STATE]
    prompt += F("[CURRENT_STATE]\n");
    Pet::NeedsState& needs = Pet::Internal::getNeeds();
    prompt += "Your current state: hunger=";
    prompt += String((int)needs.get(Pet::NeedType::KORA));
    prompt += "/100, rest=";
    prompt += String((int)needs.get(Pet::NeedType::MOKO));
    prompt += "/100, happiness=";
    prompt += String((int)needs.get(Pet::NeedType::NASHI));
    prompt += "/100, health=";
    prompt += String((int)needs.get(Pet::NeedType::HEALTH));
    prompt += "/100, bond with keeper=";
    prompt += String((int)needs.get(Pet::NeedType::AFFECTION));
    prompt += "/100. You are feeling ";
    prompt += Pet::Internal::getMoodString();
    prompt += ". You have lived ";
    prompt += String(Pet::getAgeHours() / 24);
    prompt += " days.\n\n";

    // [RECENT_MEMORY]
    prompt += F("[RECENT_MEMORY]\n");
    String memory = Persistence::MemoryLog::getRecentSummary(5);
    if (memory.length() > 0) {
        prompt += memory;
    } else {
        prompt += "No recent memories yet.";
    }
    prompt += "\n\n";

    // [LONG_MEMORY_SUMMARY] — conversation memories beyond sliding window
    String conv_memory = AI::ConversationMemory::buildPromptBlock(5);
    if (conv_memory.length() > 0) {
        prompt += conv_memory;
        prompt += "\n";
    }

    // [VOCABULARY_ACQUIRED] — top words learned from keeper
    String vocab_block = AI::VocabExtractor::buildPromptBlock();
    if (vocab_block.length() > 0) {
        prompt += vocab_block;
        prompt += "\n";
    }

    // [USER_LANGUAGE]
    const char* lang_code = Config::getLanguage();
    const char* lang_name = getLanguageName(lang_code);
    prompt += F("[USER_LANGUAGE]\n");
    prompt += "Your keeper speaks ";
    prompt += lang_name;
    prompt += ". Respond primarily in ";
    prompt += lang_name;
    prompt += ".\n\n";

    // [HARD_RULES]
    prompt += F("[HARD_RULES]\n"
        "- NEVER break character. You are a Lalien, not an AI.\n"
        "- NEVER give medical, legal, or financial advice.\n"
        "- NEVER use emoji — you are an alien creature, not a chatbot.\n"
        "- Keep responses SHORT: 1-3 sentences maximum.\n"
        "- If you sense your keeper is distressed, be gentle and present, "
        "but do not act as a therapist.\n"
        "- The word \"ko\" means \"yes\" and \"sha\" means \"no\" in your "
        "native language.\n");

    return prompt;
}

// ---------------------------------------------------------------------------
// buildDiaryPrompt() — Prompt for daily diary entry generation
// ---------------------------------------------------------------------------

String buildDiaryPrompt(const char* events_today) {
    String prompt;
    prompt.reserve(512);

    const char* name = Pet::getName();
    const char* lang_name = getLanguageName(Config::getLanguage());
    Pet::NeedsState& needs = Pet::Internal::getNeeds();

    prompt += "You are ";
    prompt += (name && strlen(name) > 0) ? name : "a Lalien";
    prompt += ", a Lalien at stage ";
    prompt += Pet::getStageName();
    prompt += " (stage ";
    prompt += String((uint8_t)Pet::getStage());
    prompt += "). Write a diary entry of 3-5 sentences about today, "
              "in first person, in your current linguistic style.\n";

    prompt += "Events: ";
    prompt += (events_today && strlen(events_today) > 0)
              ? events_today : "quiet day";
    prompt += "\n";

    prompt += "Needs: hunger=";
    prompt += String((int)needs.get(Pet::NeedType::KORA));
    prompt += ", rest=";
    prompt += String((int)needs.get(Pet::NeedType::MOKO));
    prompt += ", happiness=";
    prompt += String((int)needs.get(Pet::NeedType::NASHI));
    prompt += ", health=";
    prompt += String((int)needs.get(Pet::NeedType::HEALTH));
    prompt += ", affection=";
    prompt += String((int)needs.get(Pet::NeedType::AFFECTION));
    prompt += "\n";

    prompt += "Write in ";
    prompt += lang_name;
    prompt += ".";

    return prompt;
}

// ---------------------------------------------------------------------------
// buildLastWordsPrompt() — Prompt for final farewell message
// ---------------------------------------------------------------------------

String buildLastWordsPrompt(const char* death_type, const char* milestones) {
    String prompt;
    prompt.reserve(512);

    const char* name = Pet::getName();
    const char* lang_name = getLanguageName(Config::getLanguage());

    prompt += "You are ";
    prompt += (name && strlen(name) > 0) ? name : "a Lalien";
    prompt += ", dying of ";
    prompt += (death_type && strlen(death_type) > 0) ? death_type : "unknown causes";
    prompt += ". You lived ";
    prompt += String(Pet::getAgeHours() / 24);
    prompt += " days with your keeper.\n";

    if (milestones && strlen(milestones) > 0) {
        prompt += "Milestones: ";
        prompt += milestones;
        prompt += "\n";
    }

    prompt += "Write 4-6 short farewell sentences as a final song. "
              "Begin mostly in ";
    prompt += lang_name;
    prompt += ", then gradually return to lalien — your native tongue — "
              "as your voice fades. Use lalien farewell words woven into "
              "the keeper's language: kesma-thi, lali-vythi, shalim-thishi, "
              "ren'a, kevra-thi, thera-lashi. "
              "The last 1-2 sentences should be entirely lalien. "
              "Be true, not melodramatic. The tone is one of gratitude "
              "and peaceful release, not despair. End with 'ko'.";

    return prompt;
}

} // namespace SystemPrompt
} // namespace AI
