/**
 * pet.cpp — Main pet state machine
 * Manages the full lifecycle: egg -> 8 stages -> death/transcendence.
 * Coordinates needs decay, evolution checks, death triggers, and IMU events.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "pet.h"
#include "needs.h"
#include "evolution.h"
#include "dna.h"
#include "personality.h"
#include "death.h"
#include "../util/config.h"
#include "../persistence/save_manager.h"
#include "../persistence/pet_serializer.h"
#include "../persistence/memory_log.h"

namespace Pet {

// --- Internal state ---
static Stage s_stage = Stage::SYRMA;
static DeathType s_death_type = DeathType::NONE;
static bool s_alive = true;

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

// Vocabulary and diary counts (updated from persistence)
static uint16_t s_vocabulary_size = 0;
static uint8_t s_diary_entries = 0;

// Pathological state duration tracking (game-time seconds)
static uint32_t s_morak_start = 0;
static uint32_t s_velin_start = 0;
static uint32_t s_rena_start = 0;

// Mood
enum class Mood : uint8_t { HAPPY, NEUTRAL, SAD, SCARED };
static Mood s_mood = Mood::NEUTRAL;

// --- Forward declarations ---
static void updateMood();
static void checkEvolution();
static void checkDeath();
static void initDefaultState();

// --- Public API ---

void init() {
    Needs::init();

    // Try to load from SD
    if (Persistence::SaveManager::loadPet()) {
        // State loaded by pet_serializer into our static variables
        // (pet_serializer calls internal setters)
        return;
    }

    // No saved pet — create egg state
    initDefaultState();
}

static void initDefaultState() {
    s_stage = Stage::SYRMA;
    s_death_type = DeathType::NONE;
    s_alive = true;
    s_age_seconds = 0;
    s_birth_timestamp = millis();
    s_last_evolution_stage = 0;
    s_voice_interactions = 0;
    s_touch_interactions = 0;
    s_play_interactions = 0;
    s_vocabulary_size = 0;
    s_diary_entries = 0;
    s_morak_start = 0;
    s_velin_start = 0;
    s_rena_start = 0;

    memset(s_name, 0, sizeof(s_name));

    // Initialize all needs to 100 (newborn starts full)
    for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
        s_needs.values[i] = 100.0f;
    }

    // DNA is generated when egg hatches (stage 0 -> 1 transition)
    memset(&s_dna, 0, sizeof(s_dna));
}

void update() {
    if (!s_alive) {
        // If death sequence is playing, update it
        if (Death::isSequencePlaying()) {
            Death::updateSequence();
        }
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

    // Check evolution
    checkEvolution();

    // Check death
    checkDeath();

    // Mark dirty for autosave
    Persistence::SaveManager::markDirty();
}

void handleIMUEvent(const HAL::IMUEvent& event) {
    if (!s_alive || s_stage == Stage::SYRMA) return;

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
            break;

        case HAL::IMUEventType::GENTLE_TILT:
            // Soothe / cradle
            Needs::caress(s_needs);
            s_touch_interactions++;
            Persistence::MemoryLog::log("soothe", "cullato dolcemente");
            break;

        case HAL::IMUEventType::IMPACT:
            // Trauma — sharp security drop
            s_needs.add(NeedType::SECURITY, -30.0f);
            s_needs.add(NeedType::NASHI, -15.0f);
            s_touch_interactions++;
            Persistence::MemoryLog::log("impact", "impatto subito - trauma");
            break;

        default:
            break;
    }

    Persistence::SaveManager::markDirty();
}

// --- Accessors ---

Stage getStage() { return s_stage; }

const char* getStageName() {
    switch (s_stage) {
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

uint32_t getAgeHours() {
    return s_age_seconds / 3600;
}

const char* getName() { return s_name; }

uint8_t getDNAVariantIndex() { return s_dna.variant_index; }

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
    if (Evolution::canEvolve(s_stage, getAgeHours(), s_needs,
                              (uint16_t)s_voice_interactions,
                              s_vocabulary_size, s_diary_entries)) {
        uint8_t next = (uint8_t)s_stage + 1;
        if (next <= (uint8_t)Stage::LALI_THISHI) {
            Stage old_stage = s_stage;
            s_stage = (Stage)next;
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
            desc += getStageName();
            Persistence::MemoryLog::log("evolution", desc.c_str());

            // Force save
            Persistence::SaveManager::saveNow();
        }
    }
}

static void checkDeath() {
    uint32_t morak_dur = (s_morak_start > 0) ? (s_age_seconds - s_morak_start) : 0;
    uint32_t rena_dur = (s_rena_start > 0) ? (s_age_seconds - s_rena_start) : 0;

    DeathType dt = Death::checkDeathTriggers(s_stage, getAgeHours(), s_needs,
                                              morak_dur, rena_dur);

    if (dt != DeathType::NONE) {
        s_death_type = dt;
        s_alive = false;
        Death::startSequence(dt);

        String desc = "morte: ";
        desc += Death::getAnimationName(dt);
        Persistence::MemoryLog::log("death", desc.c_str());

        Persistence::SaveManager::saveNow();
    }
}

// --- Internal setters (used by pet_serializer for loading) ---
// These are declared as extern "C" style free functions in the Pet namespace
// so pet_serializer can access them.

namespace Internal {
    void setStage(Stage stage) { s_stage = stage; }
    void setAlive(bool alive) { s_alive = alive; }
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
    void setVocabularySize(uint16_t v) { s_vocabulary_size = v; }
    void setDiaryEntries(uint8_t d) { s_diary_entries = d; }
    void setMorakStart(uint32_t s) { s_morak_start = s; }
    void setVelinStart(uint32_t s) { s_velin_start = s; }
    void setRenaStart(uint32_t s) { s_rena_start = s; }

    // Getters for serializer
    NeedsState& getNeeds() { return s_needs; }
    DNA::DNAData& getDNA() { return s_dna; }
    uint32_t getAgeSeconds() { return s_age_seconds; }
    uint32_t getBirthTimestamp() { return s_birth_timestamp; }
    uint32_t getLastEvolutionStage() { return s_last_evolution_stage; }
    uint32_t getVoiceInteractions() { return s_voice_interactions; }
    uint32_t getTouchInteractions() { return s_touch_interactions; }
    uint32_t getPlayInteractions() { return s_play_interactions; }
    uint16_t getVocabularySize() { return s_vocabulary_size; }
    uint8_t getDiaryEntries() { return s_diary_entries; }
    uint32_t getMorakStart() { return s_morak_start; }
    uint32_t getVelinStart() { return s_velin_start; }
    uint32_t getRenaStart() { return s_rena_start; }
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
