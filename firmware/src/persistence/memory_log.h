/**
 * memory_log.h — Compact event log for LLM context (memory.jsonl)
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Persistence {
namespace MemoryLog {

    /// Log a significant event.
    void log(const char* event_type, const char* description);

    /// Get summary of recent events for LLM system prompt (last N).
    String getRecentSummary(uint8_t max_events = 10);

    /// Get total event count.
    uint32_t getCount();

} // namespace MemoryLog
} // namespace Persistence
