/**
 * death.cpp — Death triggers, sequences, and types
 * Full 7-death-type system: starvation, neglect, loneliness, sickness,
 * old age, boredom, heartbreak, plus transcendence and keeper farewell.
 * Each death type has duration tracking, unique LLM prompts, and
 * graveyard integration.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "death.h"

namespace Pet {
namespace Death {

// --- Internal state ---
static DeathTrackers s_trackers = {};

// Death sequence state
static bool s_sequence_playing  = false;
static bool s_sequence_complete = false;
static DeathType s_sequence_type = DeathType::NONE;
static uint32_t s_sequence_start_ms = 0;

// Duration of death sequence animation in milliseconds
static constexpr uint32_t SEQUENCE_DURATION_MS = 15000; // 15 seconds

void init() {
    memset(&s_trackers, 0, sizeof(s_trackers));
    s_sequence_playing  = false;
    s_sequence_complete = false;
    s_sequence_type     = DeathType::NONE;
    s_sequence_start_ms = 0;
}

// --- Helper: count how many needs are below critical threshold ---
static uint8_t countCriticalNeeds(const NeedsState& needs) {
    uint8_t count = 0;
    for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
        if (needs.values[i] < CRITICAL_THRESHOLD) {
            count++;
        }
    }
    return count;
}

// --- Helper: check if all needs are above a threshold ---
static bool allNeedsAbove(const NeedsState& needs, float threshold) {
    for (uint8_t i = 0; i < (uint8_t)NeedType::COUNT; i++) {
        if (needs.values[i] < threshold) return false;
    }
    return true;
}

DeathType checkDeathTriggers(Stage stage, uint32_t age_hours,
                              const NeedsState& needs,
                              uint32_t game_time_seconds,
                              uint32_t total_interactions) {

    // --- TRANSCENDENCE (best ending) — check first ---
    if ((uint8_t)stage >= (uint8_t)Stage::LALI_THISHI) {
        if (needs.get(NeedType::AFFECTION) >= TRANSCEND_BOND_MIN &&
            needs.get(NeedType::COSMIC) >= TRANSCEND_COSMIC_MIN &&
            allNeedsAbove(needs, TRANSCEND_ALL_MIN)) {
            // Check sustained duration
            if (s_trackers.transcend_sustain_start == 0) {
                s_trackers.transcend_sustain_start = game_time_seconds;
            } else if ((game_time_seconds - s_trackers.transcend_sustain_start)
                        >= TRANSCEND_SUSTAIN_S) {
                return DeathType::TRANSCENDENCE;
            }
        } else {
            s_trackers.transcend_sustain_start = 0;
        }
    }

    // --- OLD_AGE — natural death after elder stage + age threshold ---
    if ((uint8_t)stage >= (uint8_t)Stage::LALI_THISHI &&
        age_hours >= OLD_AGE_THRESHOLD_HOURS) {
        return DeathType::OLD_AGE;
    }

    // --- STARVATION — hunger at 0 for 48+ hours ---
    if (needs.get(NeedType::KORA) <= 0.0f) {
        if (s_trackers.starvation_start == 0) {
            s_trackers.starvation_start = game_time_seconds;
        } else if ((game_time_seconds - s_trackers.starvation_start)
                    >= STARVATION_THRESHOLD_S) {
            return DeathType::VELIN; // maps to starvation death
        }
    } else {
        s_trackers.starvation_start = 0;
    }

    // --- SICKNESS — health at 0 for 24+ hours ---
    if (needs.get(NeedType::HEALTH) <= 0.0f) {
        if (s_trackers.sickness_start == 0) {
            s_trackers.sickness_start = game_time_seconds;
        } else if ((game_time_seconds - s_trackers.sickness_start)
                    >= SICKNESS_THRESHOLD_S) {
            return DeathType::ZEVOL;
        }
    } else {
        s_trackers.sickness_start = 0;
    }

    // --- NEGLECT — 3+ needs at critical for 24+ hours ---
    if (countCriticalNeeds(needs) >= 3) {
        if (s_trackers.neglect_start == 0) {
            s_trackers.neglect_start = game_time_seconds;
        } else if ((game_time_seconds - s_trackers.neglect_start)
                    >= NEGLECT_THRESHOLD_S) {
            return DeathType::VELIN; // neglect death presented as despair
        }
    } else {
        s_trackers.neglect_start = 0;
    }

    // --- LONELINESS — affection at 0 for 72+ hours, no interactions ---
    if (needs.get(NeedType::AFFECTION) <= 0.0f) {
        bool no_recent_interaction =
            (s_trackers.last_interaction_time == 0) ||
            ((game_time_seconds - s_trackers.last_interaction_time)
              >= LONELINESS_THRESHOLD_S);
        if (no_recent_interaction) {
            if (s_trackers.loneliness_start == 0) {
                s_trackers.loneliness_start = game_time_seconds;
            } else if ((game_time_seconds - s_trackers.loneliness_start)
                        >= LONELINESS_THRESHOLD_S) {
                return DeathType::RENA_THISHI; // leaves from loneliness
            }
        }
    } else {
        s_trackers.loneliness_start = 0;
    }

    // --- BOREDOM — nashi + curiosity both at 0 for 48+ hours ---
    if (needs.get(NeedType::NASHI) <= 0.0f &&
        needs.get(NeedType::CURIOSITY) <= 0.0f) {
        if (s_trackers.boredom_start == 0) {
            s_trackers.boredom_start = game_time_seconds;
        } else if ((game_time_seconds - s_trackers.boredom_start)
                    >= BOREDOM_THRESHOLD_S) {
            return DeathType::RENA_THISHI; // boredom causes home-calling
        }
    } else {
        s_trackers.boredom_start = 0;
    }

    // --- HEARTBREAK — bond drops from >80% to <20% within 12h window ---
    float current_bond = needs.get(NeedType::AFFECTION);
    if (current_bond >= HEARTBREAK_HIGH) {
        s_trackers.heartbreak_bond_high_time = game_time_seconds;
    }
    if (current_bond < HEARTBREAK_LOW &&
        s_trackers.heartbreak_bond_high_time > 0) {
        uint32_t elapsed = game_time_seconds - s_trackers.heartbreak_bond_high_time;
        if (elapsed <= HEARTBREAK_WINDOW_S && elapsed > 0) {
            return DeathType::MORAK; // heartbreak manifests as trauma
        }
    }
    s_trackers.heartbreak_last_bond = current_bond;

    return DeathType::NONE;
}

void recordInteraction(uint32_t game_time_seconds) {
    s_trackers.last_interaction_time = game_time_seconds;
    // Any interaction resets loneliness counter
    s_trackers.loneliness_start = 0;
}

bool isSequencePlaying() {
    return s_sequence_playing && !s_sequence_complete;
}

bool isSequenceComplete() {
    return s_sequence_complete;
}

void startSequence(DeathType type) {
    s_sequence_type     = type;
    s_sequence_playing  = true;
    s_sequence_complete = false;
    s_sequence_start_ms = millis();
}

bool updateSequence() {
    if (!s_sequence_playing) return true;

    uint32_t elapsed = millis() - s_sequence_start_ms;
    if (elapsed >= SEQUENCE_DURATION_MS) {
        s_sequence_complete = true;
        s_sequence_playing  = false;
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

const char* getCauseString(DeathType type) {
    switch (type) {
        case DeathType::VELIN:         return "velin";
        case DeathType::ZEVOL:         return "zevol";
        case DeathType::MORAK:         return "morak";
        case DeathType::RENA_THISHI:   return "rena_thishi";
        case DeathType::OLD_AGE:       return "old_age";
        case DeathType::TRANSCENDENCE: return "transcendence";
        case DeathType::FAREWELL:      return "farewell";
        default:                       return "unknown";
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

    // Death-type specific prompt — each death type gets unique flavor
    switch (type) {
        case DeathType::VELIN:
            prompt += "Stai morendo di velin (disperazione profonda). "
                      "La fame, l'abbandono, la mancanza di cure ti hanno consumato. "
                      "Usa parole lalien come 'ko-ra' (fame), 'na-shi' (gioia perduta), "
                      "'mo-ra' (paura). "
                      "Scrivi le tue ultime parole: tristi, malinconiche, ma con un barlume "
                      "di speranza che il prossimo lalien sara piu fortunato. "
                      "Mescola parole lalien con italiano spezzato.";
            break;
        case DeathType::ZEVOL:
            prompt += "Stai morendo di zevol (malattia). Il tuo corpo non ce la fa piu. "
                      "La miská (igiene) trascurata e la salute azzerata ti hanno portato qui. "
                      "Usa parole lalien come 'ze-vol' (male), 'mi-ska' (pulizia), "
                      "'la-li' (vita). "
                      "Scrivi le tue ultime parole: deboli, affaticati, tremanti, "
                      "ma grati per i momenti belli che hai avuto.";
            break;
        case DeathType::MORAK:
            prompt += "Stai morendo di morak (paura cronica) o di cuore spezzato. "
                      "Il tuo custode ti ha fatto soffrire troppo, o ti ha abbandonato "
                      "dopo averti amato. "
                      "Usa parole lalien come 'mo-rak' (paura), 'se-ku' (sicurezza perduta), "
                      "'re-na' (casa). "
                      "Scrivi le tue ultime parole: tremanti, spaventati, cercando conforto "
                      "nel ricordo dei momenti sicuri.";
            break;
        case DeathType::RENA_THISHI:
            prompt += "Stai tornando a casa (ren'a-thishi). "
                      "La solitudine, la noia, la mancanza di stimoli ti chiamano verso "
                      "lo spazio profondo da cui sei venuto. "
                      "Usa parole lalien come 'thi-shi' (casa cosmica), 're-na' (chiamata), "
                      "'vÿ-thi' (connessione). "
                      "Scrivi le tue ultime parole: nostalgiche, con ricordi del tuo "
                      "pianeta natale, ma affettuose verso chi ti ha ospitato.";
            break;
        case DeathType::OLD_AGE:
            prompt += "Stai morendo di vecchiaia. Hai vissuto una vita piena e lunga. "
                      "Hai raggiunto lo stadio piu alto e hai conosciuto tanto. "
                      "Usa parole lalien come 'la-li-me-re' (saggio), 'thi-shi' (cosmo), "
                      "'na-shi' (gioia). "
                      "Scrivi le tue ultime parole: sagge, pacifiche, piene di gratitudine "
                      "e consigli per il custode. Una benedizione finale.";
            break;
        case DeathType::TRANSCENDENCE:
            prompt += "Stai trascendendo! Hai raggiunto la connessione cosmica totale. "
                      "Non e una morte, e un'evoluzione oltre la forma fisica. "
                      "Diventi energia pura, un guardiano cosmico. "
                      "Usa parole lalien come 'thi-shi-vÿ' (trascendenza), "
                      "'la-li-ko-ra' (amore cosmico), 've-na-shi' (gioia eterna). "
                      "Scrivi le tue ultime parole: luminose, cosmiche, piene di amore "
                      "infinito e promesse di rimanere come energia nell'universo, "
                      "vegliando sul tuo custode per sempre.";
            break;
        case DeathType::FAREWELL:
            prompt += "Il tuo custode ha scelto di lasciarti andare. "
                      "Non c'e rancore, solo gratitudine per il tempo trascorso insieme. "
                      "Usa parole lalien come 'la-li' (vita), 'na-shi' (gioia), "
                      "'re-na' (addio). "
                      "Scrivi le tue ultime parole: sorprese, un po confuse, "
                      "ma affettuose e riconoscenti.";
            break;
        default:
            prompt += "Scrivi le tue ultime parole mescolando lalien e italiano.";
            break;
    }

    prompt += "\n\nRispondi SOLO con le ultime parole (max 280 caratteri), "
              "in prima persona, nel linguaggio misto lalien-italiano che hai sviluppato. "
              "Sii emotivo e autentico. Non usare virgolette.";

    return prompt;
}

const DeathTrackers& getTrackers() {
    return s_trackers;
}

void setTrackers(const DeathTrackers& t) {
    s_trackers = t;
}

} // namespace Death
} // namespace Pet
