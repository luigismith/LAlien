/**
 * death.cpp — Death triggers, sequences, and types
 * Checks all death/transcendence conditions and manages the death animation sequence.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "death.h"

namespace Pet {
namespace Death {

// Death sequence state
static bool s_sequence_playing = false;
static bool s_sequence_complete = false;
static DeathType s_sequence_type = DeathType::NONE;
static uint32_t s_sequence_start_ms = 0;

// Duration of death sequence animation in milliseconds
static constexpr uint32_t SEQUENCE_DURATION_MS = 15000; // 15 seconds

// Velin duration tracking (game-time seconds)
static uint32_t s_velin_duration = 0;
static bool s_was_velin = false;

DeathType checkDeathTriggers(Stage stage, uint32_t age_hours,
                              const NeedsState& needs,
                              uint32_t morak_duration_s,
                              uint32_t rena_thishi_duration_s) {

    // TRANSCENDENCE (best ending) — check before OLD_AGE
    if ((uint8_t)stage >= 7 && age_hours > 2200 &&
        needs.get(NeedType::AFFECTION) > 90.0f &&
        needs.get(NeedType::COSMIC) > 80.0f) {
        return DeathType::TRANSCENDENCE;
    }

    // OLD_AGE — natural death
    if ((uint8_t)stage >= 7 && age_hours > 2500) {
        return DeathType::OLD_AGE;
    }

    // ZEVOL — health reaches 0
    if (needs.get(NeedType::HEALTH) <= 0.0f) {
        return DeathType::ZEVOL;
    }

    // MORAK — chronic trauma for > 48h game-time
    if (Needs::isMorak(needs) && morak_duration_s > 172800) { // 48h
        return DeathType::MORAK;
    }

    // VELIN — depression for > 96h game-time
    if (Needs::isVelin(needs)) {
        s_velin_duration++;
        if (s_velin_duration > 345600) { // 96h in seconds
            return DeathType::VELIN;
        }
        s_was_velin = true;
    } else {
        if (s_was_velin) {
            s_velin_duration = 0;
            s_was_velin = false;
        }
    }

    // RENA_THISHI — home calling for > 120h game-time
    if (Needs::isRenaThishi(needs) && rena_thishi_duration_s > 432000) { // 120h
        return DeathType::RENA_THISHI;
    }

    return DeathType::NONE;
}

bool isSequencePlaying() {
    return s_sequence_playing && !s_sequence_complete;
}

void startSequence(DeathType type) {
    s_sequence_type = type;
    s_sequence_playing = true;
    s_sequence_complete = false;
    s_sequence_start_ms = millis();
}

bool updateSequence() {
    if (!s_sequence_playing) return true;

    uint32_t elapsed = millis() - s_sequence_start_ms;
    if (elapsed >= SEQUENCE_DURATION_MS) {
        s_sequence_complete = true;
        s_sequence_playing = false;
        return true; // sequence complete
    }
    return false; // still playing
}

const char* getAnimationName(DeathType type) {
    switch (type) {
        case DeathType::VELIN:         return "death_velin";
        case DeathType::ZEVOL:         return "death_zevol";
        case DeathType::MORAK:         return "death_morak";
        case DeathType::RENA_THISHI:   return "death_rena_thishi";
        case DeathType::OLD_AGE:       return "death_old_age";
        case DeathType::TRANSCENDENCE: return "death_transcendence";
        case DeathType::FAREWELL:      return "death_farewell";
        default:                       return "death_generic";
    }
}

String buildLastWordsPrompt(DeathType type, const char* pet_name,
                             uint32_t age_days, Stage stage,
                             const char* top_words, const char* milestones) {
    String prompt = "Sei ";
    prompt += pet_name;
    prompt += ", un lalien che sta per morire. ";

    // Context about the pet's life
    prompt += "Hai vissuto per ";
    prompt += String(age_days);
    prompt += " giorni, raggiungendo lo stadio ";
    prompt += String((uint8_t)stage);
    prompt += ". ";

    if (top_words && strlen(top_words) > 0) {
        prompt += "Le parole che hai usato di piu: ";
        prompt += top_words;
        prompt += ". ";
    }

    if (milestones && strlen(milestones) > 0) {
        prompt += "I tuoi momenti importanti: ";
        prompt += milestones;
        prompt += ". ";
    }

    // Death-type specific prompt
    switch (type) {
        case DeathType::VELIN:
            prompt += "Stai morendo di velin (disperazione). Nessuno ti ha amato abbastanza. "
                      "Scrivi le tue ultime parole: tristi, malinconiche, ma con un barlume "
                      "di speranza che il prossimo lalien sara piu fortunato.";
            break;
        case DeathType::ZEVOL:
            prompt += "Stai morendo di zevol (malattia). Il tuo corpo non ce la fa piu. "
                      "Scrivi le tue ultime parole: deboli, affaticati, ma grati per i momenti belli.";
            break;
        case DeathType::MORAK:
            prompt += "Stai morendo di morak (paura cronica). Hai avuto troppa paura per troppo tempo. "
                      "Scrivi le tue ultime parole: tremanti, spaventati, cercando conforto.";
            break;
        case DeathType::RENA_THISHI:
            prompt += "Stai tornando a casa (rena-thishi). La tua mente ha bisogno di tornare "
                      "nello spazio profondo. Scrivi le tue ultime parole: nostalgiche, "
                      "con ricordi del tuo pianeta natale, ma affettuose verso chi ti ha ospitato.";
            break;
        case DeathType::OLD_AGE:
            prompt += "Stai morendo di vecchiaia. Hai vissuto una vita piena. "
                      "Scrivi le tue ultime parole: sagge, pacifiche, piene di gratitudine "
                      "e consigli per il custode.";
            break;
        case DeathType::TRANSCENDENCE:
            prompt += "Stai trascendendo! Hai raggiunto la connessione cosmica totale. "
                      "Non e una morte, e un'evoluzione oltre la forma fisica. "
                      "Scrivi le tue ultime parole: luminose, cosmiche, piene di amore "
                      "infinito e promesse di rimanere come energia nell'universo.";
            break;
        case DeathType::FAREWELL:
            prompt += "Il tuo custode ha cambiato la chiave API. Devi salutarlo. "
                      "Scrivi le tue ultime parole: sorprese, un po confuse, ma affettuose.";
            break;
        default:
            prompt += "Scrivi le tue ultime parole.";
            break;
    }

    prompt += "\n\nRispondi SOLO con le ultime parole (max 280 caratteri), "
              "in prima persona, nel linguaggio misto lalien-italiano che hai sviluppato. "
              "Sii emotivo e autentico.";

    return prompt;
}

} // namespace Death
} // namespace Pet
