/**
 * diary_generator.cpp --- Diary entry generation via LLM
 * Tracks conversation count, and when threshold is met and diary is due,
 * triggers an async LLM call using a dedicated diary prompt. The response
 * is stored via the persistence diary layer. Uses the same LLM client
 * state machine as conversation, so generation must wait for IDLE state.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "diary_generator.h"
#include "llm_client.h"
#include "system_prompt.h"
#include "vocab_extractor.h"
#include "../persistence/diary.h"
#include "../persistence/memory_log.h"
#include "../pet/pet.h"
#include "../pet/pet_internal.h"

namespace AI {
namespace DiaryGenerator {

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

enum class GenState : uint8_t {
    IDLE,               // Not generating
    WAITING_FOR_LLM,    // Waiting for LLM client to become IDLE
    REQUESTING,         // LLM request sent, waiting for completion
    STORING             // Got response, storing to SD
};

static GenState s_gen_state = GenState::IDLE;
static uint8_t s_conversation_count = 0;
static uint8_t s_conversation_threshold = 5;
static String s_events_summary;

// ---------------------------------------------------------------------------
// Build events summary from recent memory log
// ---------------------------------------------------------------------------

static String buildEventsSummary() {
    String summary;
    summary.reserve(256);

    // Pull recent events from memory log
    String recent = Persistence::MemoryLog::getRecentSummary(5);
    if (recent.length() > 0 && recent.indexOf("Nessun") < 0) {
        summary += recent;
    }

    // Add vocabulary info
    uint16_t vocab_count = VocabExtractor::getCount();
    if (vocab_count > 0) {
        summary += "Vocabulary learned: ";
        summary += String(vocab_count);
        summary += " words. ";
    }

    // Add conversation count
    summary += "Conversations today: ";
    summary += String(s_conversation_count);
    summary += ". ";

    if (summary.length() == 0) {
        summary = "quiet day";
    }

    return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

void init() {
    s_gen_state = GenState::IDLE;
    s_conversation_count = 0;
    s_conversation_threshold = 5;
    s_events_summary = "";
    Serial.println("[DIARY_GEN] Initialized, threshold=" + String(s_conversation_threshold));
}

void onConversationComplete() {
    s_conversation_count++;
    Serial.println("[DIARY_GEN] Conversation count: " + String(s_conversation_count)
                   + "/" + String(s_conversation_threshold));

    // Check if we should generate a diary entry
    if (s_conversation_count >= s_conversation_threshold && Persistence::Diary::isDue()) {
        Serial.println("[DIARY_GEN] Threshold reached and diary is due, starting generation");
        s_events_summary = buildEventsSummary();
        s_gen_state = GenState::WAITING_FOR_LLM;
    }
}

void poll() {
    switch (s_gen_state) {

    case GenState::IDLE:
        return;

    case GenState::WAITING_FOR_LLM: {
        // Wait for the LLM client to be idle (not mid-conversation)
        if (LLMClient::getState() == LLMClient::State::IDLE) {
            // Check rate limit before requesting
            if (LLMClient::isRateLimited()) {
                Serial.println("[DIARY_GEN] Rate limited, will retry later");
                return;
            }

            // Build diary-specific prompt and send as user message
            String diary_prompt = SystemPrompt::buildDiaryPrompt(s_events_summary.c_str());
            LLMClient::requestCompletion(diary_prompt);
            s_gen_state = GenState::REQUESTING;
            Serial.println("[DIARY_GEN] LLM request sent for diary entry");
        }
        return;
    }

    case GenState::REQUESTING: {
        // Poll the LLM client
        LLMClient::poll();

        LLMClient::State llm_state = LLMClient::getState();

        if (llm_state == LLMClient::State::DONE) {
            s_gen_state = GenState::STORING;
        } else if (llm_state == LLMClient::State::ERROR) {
            Serial.println("[DIARY_GEN] LLM error: " + LLMClient::getError());
            LLMClient::reset();
            s_gen_state = GenState::IDLE;
            // Don't reset conversation count so it retries next conversation
        }
        return;
    }

    case GenState::STORING: {
        String response = LLMClient::getResponse();
        LLMClient::reset();

        if (response.length() > 0) {
            uint8_t stage = (uint8_t)Pet::getStage();
            bool ok = Persistence::Diary::addEntry(response.c_str(), stage);
            if (ok) {
                Serial.println("[DIARY_GEN] Diary entry saved successfully");
                // Update pet's diary entry count
                uint8_t diary_count = Pet::Internal::getDiaryEntries();
                Pet::Internal::setDiaryEntries(diary_count + 1);
                // Log to memory
                Persistence::MemoryLog::log("diary", "Wrote a diary entry");
            } else {
                Serial.println("[DIARY_GEN] Failed to save diary entry to SD");
            }
        } else {
            Serial.println("[DIARY_GEN] Empty LLM response, skipping");
        }

        // Reset for next cycle
        s_conversation_count = 0;
        s_events_summary = "";
        s_gen_state = GenState::IDLE;
        return;
    }

    } // switch
}

bool isBusy() {
    return s_gen_state != GenState::IDLE;
}

void setConversationThreshold(uint8_t threshold) {
    s_conversation_threshold = (threshold > 0) ? threshold : 1;
    Serial.println("[DIARY_GEN] Threshold set to " + String(s_conversation_threshold));
}

uint8_t getConversationCount() {
    return s_conversation_count;
}

void forceGenerate() {
    if (s_gen_state != GenState::IDLE) {
        Serial.println("[DIARY_GEN] Already generating, ignoring force request");
        return;
    }

    if (!Persistence::Diary::isDue()) {
        Serial.println("[DIARY_GEN] Diary not due yet, ignoring force request");
        return;
    }

    Serial.println("[DIARY_GEN] Force generating diary entry");
    s_events_summary = buildEventsSummary();
    s_gen_state = GenState::WAITING_FOR_LLM;
}

} // namespace DiaryGenerator
} // namespace AI
