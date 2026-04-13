/**
 * system_prompt.h — Dynamic system prompt builder for LLM calls
 * Assembles: identity, DNA, stage instructions, state, memory, vocabulary, language, rules
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace AI {
namespace SystemPrompt {

    /// Build complete system prompt for a conversation turn.
    String build();

    /// Build prompt for diary entry generation.
    String buildDiaryPrompt(const char* events_today);

    /// Build prompt for last words generation.
    String buildLastWordsPrompt(const char* death_type, const char* milestones);

} // namespace SystemPrompt
} // namespace AI
