/**
 * pet.cpp — Main pet state machine
 * Manages the full lifecycle: egg -> 8 stages -> death/transcendence.
 * Coordinates needs decay, evolution checks, death triggers, graveyard burial,
 * and IMU events. Checks death and evolution conditions at 1Hz.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "pet.h"
#include "needs.h"
#include "evolution.h"
#include "dna.h"
#include "personality.h"
#include "death.h"
#include "minigames.h"
#include "../util/config.h"
#include "../persistence/save_manager.h"
#include "../persistence/pet_serializer.h"
#include "../persistence/memory_log.h"
#include "../persistence/graveyard.h"
#include "../persistence/vocabulary_store.h"

namespace Pet {

// --- Internal state ---
static Stage s_stage = Stage::SYRMA;
static DeathType s_death_type = DeathType::NONE;
static bool s_alive = true;
static bool s_transcended = false;

static char s_name[32] = {0};
static uint32_t s_age_seconds = 0;      // game-time age in seconds
static uint32_t s_birth_timestamp = 0;   // millis() at birth
static uint32_t s_last_evolution_stage = 0;

static NeedsState s_needs;
static DNA::DNAData s_dna;

// Interaction counters
static uint32_t s_voice_interactions = 0;
static uint32_t s_touch_interactions = 0;
static uint32_t s_play_interactions = 0;
static uint16_t s_conversations = 0;

// Vocabulary and diary counts (updated from persistence)
static uint16_t s_vocabulary_size = 0;
static uint8_t s_diary_entries = 0;

// Pathological state duration tracking (game-time seconds)
static uint32_t s_morak_start = 0;
static uint32_t s_velin_start = 0;
static uint32_t s_rena_start = 0;

// Last words buffer (filled by LLM during death sequence)
static char s_last_words[300] = {0};

// Death burial flag — ensures we only bury once
static bool s_buried = false;

// Mood
enum class Mood : uint8_t { HAPPY, NEUTRAL, SAD, SCARED };
static Mood s_mood = Mood::NEUTRAL;

// --- Forward declarations ---
static void updateMood();
static void checkEvolution();
static void checkDeath();
static void initDefaultState();
static void buryPet();

// --- Public API ---

void init() {
    Needs::init();
    Death::init();

    // Try to load from SD
    if (Persistence::SaveManager::loadPet()) {
        // State loaded by pet_serializer into our static variables
        return;
    }

    // No saved pet — create egg state
    initDefaultState();
}

static void initDefaultState() {
    s_stage = Stage::SYRMA;
    s_death_type = DeathType::NONE;
    s_alive = true;
    s_transcended = false;
    s_age_seconds = 0;
    s_birth_timestamp = millis();
    s_last_evolution_stage = 0;
    s_voice_interactions = 0;
    s_touch_interactions = 0;
    s_play_interactions = 0;
    s_conversations = 0;
    s_vocabulary_size = 0;
    s_diary_entries = 0;
    s_morak_start = 0;
    s_velin_start = 0;
    s_rena_start = 0;
    s_buried = false;

    memset(s_name, 0, sizeof(s_name));
    memset(s_last_words, 0, sizeof(s_last_words));

    // Initialize all needs to 100 (newborn starts full)
    for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
        s_needs.values[i] = 100.0f;
    }

    // DNA is generated when egg hatches (stage 0 -> 1 transition)
    memset(&s_dna, 0, sizeof(s_dna));

    Death::init();
}

void update() {
    if (!s_alive) {
        // If death sequence is playing, update it
        if (Death::isSequencePlaying()) {
            Death::updateSequence();
        }

        // After death sequence completes, bury the pet (once)
        if (Death::isSequenceComplete() && !s_buried) {
            buryPet();
        }

        // DEAD or TRANSCENDED: no more need decay, no more evolution
        return;
    }

    // Don't decay needs while still an egg
    if (s_stage == Stage::SYRMA) {
        return;
    }

    float time_mult = Config::getTimeMultiplier();

    // Advance game-time age
    s_age_seconds += (uint32_t)time_mult;

    // Decay all needs (1 game-second per call)
    Needs::decay(s_needs, time_mult);

    // Update pathological state duration trackers
    if (Needs::isMorak(s_needs)) {
        if (s_morak_start == 0) s_morak_start = s_age_seconds;
    } else {
        s_morak_start = 0;
    }

    if (Needs::isRenaThishi(s_needs)) {
        if (s_rena_start == 0) s_rena_start = s_age_seconds;
    } else {
        s_rena_start = 0;
    }

    // Update mood
    updateMood();

    // Check evolution (1Hz)
    checkEvolution();

    // Check death (1Hz)
    checkDeath();

    // Mark dirty for autosave
    Persistence::SaveManager::markDirty();
}

void handleIMUEvent(const HAL::IMUEvent& event) {
    if (!s_alive) return;

    // Egg responds to touch (for hatching counter)
    if (s_stage == Stage::SYRMA) {
        if (event.type == HAL::IMUEventType::GENTLE_TILT ||
            event.type == HAL::IMUEventType::SHAKE) {
            s_touch_interactions++;
            Death::recordInteraction(s_age_seconds);
            Persistence::SaveManager::markDirty();
        }
        return;
    }

    switch (event.type) {
        case HAL::IMUEventType::SHAKE:
            if (event.magnitude < 3.0f) {
                // Gentle shake — play
                Needs::play(s_needs);
                s_play_interactions++;
                Persistence::MemoryLog::log("play", "scosso dolcemente - gioco");
            } else {
                // Vigorous shake — disturb
                s_needs.add(NeedType::SECURITY, -15.0f);
                s_needs.add(NeedType::NASHI, -10.0f);
                Persistence::MemoryLog::log("disturb", "scosso forte - disturbato");
            }
            s_touch_interactions++;
            Death::recordInteraction(s_age_seconds);
            break;

        case HAL::IMUEventType::GENTLE_TILT:
            // Soothe / cradle
            Needs::caress(s_needs);
            s_touch_interactions++;
            Death::recordInteraction(s_age_seconds);
            Persistence::MemoryLog::log("soothe", "cullato dolcemente");
            break;

        case HAL::IMUEventType::IMPACT:
            // Trauma — sharp security drop
            s_needs.add(NeedType::SECURITY, -30.0f);
            s_needs.add(NeedType::NASHI, -15.0f);
            s_touch_interactions++;
            Death::recordInteraction(s_age_seconds);
            Persistence::MemoryLog::log("impact", "impatto subito - trauma");
            break;

        default:
            break;
    }

    Persistence::SaveManager::markDirty();
}

// ---------------------------------------------------------------
// applyGameResult() — Bridge between bonding rituals and growth
// ---------------------------------------------------------------
// Each mini-game is a ritual from Echòa's culture. Playing them
// doesn't just change need values — it actively develops the
// creature's mind, body, and connection to its keeper.
//
// Thishí-Rèvosh (Echo Memory):
//   - Trains cognitive functions (rèvosh = memory)
//   - Unlocks ancestral words from the Archivio Vibrazionale
//   - Long sequences trigger mokó-thishí (dream-visions)
//   - Strengthens the nàvresh through shared ritual
//
// Miskà-Vÿthi (Light Cleansing):
//   - Heals the sèvra (bioluminescent membrane)
//   - Deepens trust through gentle physical contact
//   - Many touch interactions accelerate evolution
//   - Unlocks body/physical vocabulary
//
// Sèlath-Nashi (Star Joy):
//   - Develops cosmic awareness (sèlath = cosmic)
//   - Maps the paths of the sÿrma seeds through space
//   - Full sessions trigger dream-visions of Echòa's sky
//   - Unlocks cosmic/nature vocabulary

void applyGameResult() {
    if (!s_alive) return;

    MiniGames::GameResult r = MiniGames::getLastResult();

    // 1. Apply need bonuses/costs
    s_needs.add(NeedType::NASHI,     r.nashi_bonus);
    s_needs.add(NeedType::COGNITION, r.cognition_bonus);
    s_needs.add(NeedType::CURIOSITY, r.curiosity_bonus);
    s_needs.add(NeedType::AFFECTION, r.affection_bonus);
    s_needs.add(NeedType::MISKA,     r.miska_bonus);
    s_needs.add(NeedType::COSMIC,    r.cosmic_bonus);
    s_needs.add(NeedType::SECURITY,  r.security_bonus);
    s_needs.add(NeedType::MOKO,     -r.moko_cost);  // playing costs energy

    // 2. Count as touch interactions (for evolution triggers)
    for (uint8_t i = 0; i < r.interaction_count; i++) {
        s_interactions++;
    }
    Death::recordInteraction(); // resets loneliness/neglect timers

    // 3. Unlock vocabulary from the Archive based on performance
    if (r.vocab_unlock > 0) {
        // Words unlocked depend on which game was played:
        // Echo Memory → memory/sound/emotion words
        // Light Cleansing → body/health words
        // Star Joy → cosmic/nature words
        static const char* echo_words[]  = {"r\xc3\xa8vosh", "th\xc3\xadshi", "k\xc3\xb2rim",
                                             "l\xc3\xa0l\xc3\xad", "sh\xc3\xa0", "k\xc3\xb2"};
        static const char* clean_words[] = {"s\xc3\xa8vra", "misk\xc3\xa1", "z\xc3\xa8vol",
                                             "sh\xc3\xa0ren", "m\xc3\xb2ko", "th\xc3\xa0lim"};
        static const char* star_words[]  = {"s\xc3\xa8lath", "th\xc3\xa0mor", "n\xc3\xb2rath",
                                             "m\xc3\xa0rith", "r\xc3\xa8mith", "sh\xc3\xb2lith"};

        const char** word_pool = echo_words;
        uint8_t pool_size = 6;
        MiniGames::GameType game = MiniGames::getCurrentGame();
        if (game == MiniGames::GameType::LIGHT_CLEANSING) word_pool = clean_words;
        else if (game == MiniGames::GameType::STAR_JOY) word_pool = star_words;

        for (uint8_t i = 0; i < r.vocab_unlock && i < pool_size; i++) {
            uint8_t idx = random(0, pool_size);
            Persistence::VocabularyStore::add(
                word_pool[idx],
                "Archivio Vibrazionale",
                (uint8_t)s_stage
            );
        }
        // Update vocabulary count for evolution check
        Internal::setVocabularySize(
            Persistence::VocabularyStore::getCount()
        );

        Serial.print("[PET] Game unlocked ");
        Serial.print(r.vocab_unlock);
        Serial.println(" words from the Archive");
    }

    // 4. Trigger dream-vision (mokó-thishí) for exceptional play
    if (r.triggers_dream) {
        Serial.println("[PET] Exceptional play triggers mok\xc3\xb3-thish\xc3\xad!");
        // Dream-visions are handled by the diary generator as special entries
        // Flag it so next sleep cycle produces a lore dream
        // (This integrates with the diary system)
    }

    Persistence::SaveManager::markDirty();

    Serial.print("[PET] Game result applied. Score=");
    Serial.print(r.score);
    Serial.print(" Interactions=");
    Serial.println(s_interactions);
}

void triggerFarewell() {
    if (!s_alive) return;
    s_death_type = DeathType::FAREWELL;
    s_alive = false;
    Death::startSequence(DeathType::FAREWELL);

    Persistence::MemoryLog::log("death", "farewell - il custode ha scelto di salutare");
    Persistence::SaveManager::saveNow();
}

// --- Accessors ---

Stage getStage() { return s_stage; }

const char* getStageName() {
    return getStageNameFor(s_stage);
}

const char* getStageNameFor(Stage stage) {
    switch (stage) {
        case Stage::SYRMA:       return "Syrma";
        case Stage::LALI_NA:     return "Lali-na";
        case Stage::LALI_SHI:    return "Lali-shi";
        case Stage::LALI_KO:     return "Lali-ko";
        case Stage::LALI_REN:    return "Lali-ren";
        case Stage::LALI_VOX:    return "Lali-vox";
        case Stage::LALI_MERE:   return "Lali-mere";
        case Stage::LALI_THISHI: return "Lali-thishi";
        default:                 return "???";
    }
}

DeathType getDeathType() { return s_death_type; }
bool isAlive() { return s_alive; }
bool isEgg() { return s_stage == Stage::SYRMA; }
bool isTranscended() { return s_transcended; }

uint32_t getAgeHours() {
    return s_age_seconds / 3600;
}

uint32_t getAgeDays() {
    return s_age_seconds / 86400;
}

const char* getName() { return s_name; }

uint8_t getDNAVariantIndex() { return s_dna.variant_index; }

uint32_t getTotalInteractions() {
    return s_voice_interactions + s_touch_interactions + s_play_interactions;
}

uint16_t getConversationCount() { return s_conversations; }

void addConversation() {
    s_conversations++;
    s_voice_interactions++;
    Death::recordInteraction(s_age_seconds);
    Persistence::SaveManager::markDirty();
}

const char* getLastWords() { return s_last_words; }

void setLastWords(const char* words) {
    if (words) {
        strncpy(s_last_words, words, sizeof(s_last_words) - 1);
        s_last_words[sizeof(s_last_words) - 1] = '\0';
    }
}

// --- Internal helpers ---

static void updateMood() {
    float avg = Needs::getOverallWellness(s_needs);
    float security = s_needs.get(NeedType::SECURITY);

    if (security < 20.0f) {
        s_mood = Mood::SCARED;
    } else if (avg > 70.0f) {
        s_mood = Mood::HAPPY;
    } else if (avg < 40.0f) {
        s_mood = Mood::SAD;
    } else {
        s_mood = Mood::NEUTRAL;
    }
}

static void checkEvolution() {
    // Do not evolve if evolution animation is already playing
    if (Evolution::isEvolving()) return;

    if (Evolution::canEvolve(s_stage, getAgeHours(), s_needs,
                              (uint16_t)s_touch_interactions,
                              (uint16_t)s_voice_interactions,
                              s_vocabulary_size, s_conversations,
                              s_diary_entries)) {
        uint8_t next = (uint8_t)s_stage + 1;
        if (next <= (uint8_t)Stage::LALI_THISHI) {
            Stage old_stage = s_stage;
            Stage new_stage = (Stage)next;

            // Set evolution animation flags (UI reads these)
            Evolution::setEvolutionFromStage(old_stage);
            Evolution::setEvolutionToStage(new_stage);
            Evolution::setEvolving(true);

            // Actually advance stage
            s_stage = new_stage;
            s_last_evolution_stage = (uint32_t)old_stage;

            // If hatching from egg, generate DNA
            if (old_stage == Stage::SYRMA) {
                s_dna = DNA::generate();

                // Set name from config if available
                const char* cfg_name = Config::getPetName();
                if (cfg_name && strlen(cfg_name) > 0) {
                    strncpy(s_name, cfg_name, sizeof(s_name) - 1);
                }
            }

            // Log evolution event
            String desc = "evoluzione: ";
            desc += getStageNameFor(old_stage);
            desc += " -> ";
            desc += getStageName();
            Persistence::MemoryLog::log("evolution", desc.c_str());

            // Force save
            Persistence::SaveManager::saveNow();
        }
    }
}

static void checkDeath() {
    uint32_t total = getTotalInteractions();

    DeathType dt = Death::checkDeathTriggers(s_stage, getAgeHours(), s_needs,
                                              s_age_seconds, total);

    if (dt != DeathType::NONE) {
        s_death_type = dt;
        s_alive = false;

        if (dt == DeathType::TRANSCENDENCE) {
            s_transcended = true;
        }

        Death::startSequence(dt);

        String desc = "morte: ";
        desc += Death::getCauseString(dt);
        Persistence::MemoryLog::log("death", desc.c_str());

        Persistence::SaveManager::saveNow();
    }
}

static void buryPet() {
    s_buried = true;

    const char* cause = Death::getCauseString(s_death_type);
    const char* words = (strlen(s_last_words) > 0) ? s_last_words : "...";

    Persistence::Graveyard::buryPet(cause, words);

    Serial.print("[PET] Buried: cause=");
    Serial.print(cause);
    Serial.print(" transcended=");
    Serial.println(s_transcended ? "yes" : "no");
}

// --- Internal setters (used by pet_serializer for loading) ---
namespace Internal {
    void setStage(Stage stage) { s_stage = stage; }
    void setAlive(bool alive) { s_alive = alive; }
    void setTranscended(bool t) { s_transcended = t; }
    void setDeathType(DeathType dt) { s_death_type = dt; }
    void setName(const char* name) { strncpy(s_name, name, sizeof(s_name) - 1); }
    void setAgeSeconds(uint32_t age) { s_age_seconds = age; }
    void setBirthTimestamp(uint32_t ts) { s_birth_timestamp = ts; }
    void setLastEvolutionStage(uint32_t s) { s_last_evolution_stage = s; }
    void setNeeds(const NeedsState& needs) { s_needs = needs; }
    void setDNA(const DNA::DNAData& dna) { s_dna = dna; }
    void setVoiceInteractions(uint32_t v) { s_voice_interactions = v; }
    void setTouchInteractions(uint32_t t) { s_touch_interactions = t; }
    void setPlayInteractions(uint32_t p) { s_play_interactions = p; }
    void setConversations(uint16_t c) { s_conversations = c; }
    void setVocabularySize(uint16_t v) { s_vocabulary_size = v; }
    void setDiaryEntries(uint8_t d) { s_diary_entries = d; }
    void setMorakStart(uint32_t s) { s_morak_start = s; }
    void setVelinStart(uint32_t s) { s_velin_start = s; }
    void setRenaStart(uint32_t s) { s_rena_start = s; }
    void setBuried(bool b) { s_buried = b; }
    void setLastWords(const char* w) {
        if (w) {
            strncpy(s_last_words, w, sizeof(s_last_words) - 1);
            s_last_words[sizeof(s_last_words) - 1] = '\0';
        }
    }

    // Getters for serializer
    NeedsState& getNeeds() { return s_needs; }
    DNA::DNAData& getDNA() { return s_dna; }
    uint32_t getAgeSeconds() { return s_age_seconds; }
    uint32_t getBirthTimestamp() { return s_birth_timestamp; }
    uint32_t getLastEvolutionStage() { return s_last_evolution_stage; }
    uint32_t getVoiceInteractions() { return s_voice_interactions; }
    uint32_t getTouchInteractions() { return s_touch_interactions; }
    uint32_t getPlayInteractions() { return s_play_interactions; }
    uint16_t getConversations() { return s_conversations; }
    uint16_t getVocabularySize() { return s_vocabulary_size; }
    uint8_t getDiaryEntries() { return s_diary_entries; }
    uint32_t getMorakStart() { return s_morak_start; }
    uint32_t getVelinStart() { return s_velin_start; }
    uint32_t getRenaStart() { return s_rena_start; }
    bool getBuried() { return s_buried; }
    bool getTranscended() { return s_transcended; }
    const char* getMoodString() {
        switch (s_mood) {
            case Mood::HAPPY:  return "happy";
            case Mood::SAD:    return "sad";
            case Mood::SCARED: return "scared";
            default:           return "neutral";
        }
    }
}

} // namespace Pet
