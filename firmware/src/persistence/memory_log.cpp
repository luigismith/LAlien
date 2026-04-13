/**
 * memory_log.cpp — Compact event log for LLM context (memory.jsonl)
 * Appends JSONL entries to SD card and provides recent event summaries
 * for inclusion in LLM system prompts.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "memory_log.h"
#include <ArduinoJson.h>
#include "../hal/sd_storage.h"

namespace Persistence {
namespace MemoryLog {

static const char* LOG_PATH = "/lalien/pets/current/memory.jsonl";

void log(const char* event_type, const char* description) {
    JsonDocument doc;
    doc["ts"] = millis() / 1000; // seconds since boot as approximate epoch
    doc["type"] = event_type;
    doc["desc"] = description;

    String line;
    serializeJson(doc, line);
    line += "\n";

    HAL::SDStorage::appendFileString(LOG_PATH, line);
}

String getRecentSummary(uint8_t max_events) {
    String content = HAL::SDStorage::readFileString(LOG_PATH);
    if (content.length() == 0) return "Nessun evento recente.";

    // Parse JSONL: find last N lines
    // Count total lines first
    int total_lines = 0;
    int pos = 0;
    while (pos < (int)content.length()) {
        int nl = content.indexOf('\n', pos);
        if (nl < 0) break;
        total_lines++;
        pos = nl + 1;
    }

    // Skip to last max_events lines
    int skip = (total_lines > max_events) ? (total_lines - max_events) : 0;
    int current_line = 0;
    pos = 0;

    String summary = "Eventi recenti:\n";
    while (pos < (int)content.length()) {
        int nl = content.indexOf('\n', pos);
        if (nl < 0) break;

        if (current_line >= skip) {
            String line = content.substring(pos, nl);

            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, line);
            if (!err) {
                const char* type = doc["type"] | "?";
                const char* desc = doc["desc"] | "?";
                uint32_t ts = doc["ts"] | 0;

                summary += "- [";
                summary += String(ts);
                summary += "] ";
                summary += type;
                summary += ": ";
                summary += desc;
                summary += "\n";
            }
        }

        current_line++;
        pos = nl + 1;
    }

    return summary;
}

uint32_t getCount() {
    String content = HAL::SDStorage::readFileString(LOG_PATH);
    if (content.length() == 0) return 0;

    uint32_t count = 0;
    int pos = 0;
    while (pos < (int)content.length()) {
        int nl = content.indexOf('\n', pos);
        if (nl < 0) break;
        count++;
        pos = nl + 1;
    }
    return count;
}

} // namespace MemoryLog
} // namespace Persistence
