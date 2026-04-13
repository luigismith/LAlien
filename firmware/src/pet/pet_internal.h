/**
 * pet_internal.h — Internal accessors for pet state (used by persistence layer)
 * Not for use by game logic — only for save/load operations.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include "pet.h"
#include "needs.h"
#include "dna.h"

namespace Pet {
namespace Internal {

    // Setters (for loading saved state)
    void setStage(Stage stage);
    void setAlive(bool alive);
    void setTranscended(bool t);
    void setDeathType(DeathType dt);
    void setName(const char* name);
    void setAgeSeconds(uint32_t age);
    void setBirthTimestamp(uint32_t ts);
    void setLastEvolutionStage(uint32_t s);
    void setNeeds(const NeedsState& needs);
    void setDNA(const DNA::DNAData& dna);
    void setVoiceInteractions(uint32_t v);
    void setTouchInteractions(uint32_t t);
    void setPlayInteractions(uint32_t p);
    void setConversations(uint16_t c);
    void setVocabularySize(uint16_t v);
    void setDiaryEntries(uint8_t d);
    void setMorakStart(uint32_t s);
    void setVelinStart(uint32_t s);
    void setRenaStart(uint32_t s);
    void setBuried(bool b);
    void setLastWords(const char* w);

    // Getters (for saving state)
    NeedsState& getNeeds();
    DNA::DNAData& getDNA();
    uint32_t getAgeSeconds();
    uint32_t getBirthTimestamp();
    uint32_t getLastEvolutionStage();
    uint32_t getVoiceInteractions();
    uint32_t getTouchInteractions();
    uint32_t getPlayInteractions();
    uint16_t getConversations();
    uint16_t getVocabularySize();
    uint8_t getDiaryEntries();
    uint32_t getMorakStart();
    uint32_t getVelinStart();
    uint32_t getRenaStart();
    bool getBuried();
    bool getTranscended();
    const char* getMoodString();

} // namespace Internal
} // namespace Pet
