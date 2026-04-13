/**
 * debug.h — Debug logging macros
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

#ifdef LALIEN_DEBUG
  #define DEBUG_LOG(msg)       Serial.println(msg)
  #define DEBUG_LOGF(fmt, ...) Serial.printf(fmt "\n", ##__VA_ARGS__)
#else
  #define DEBUG_LOG(msg)       ((void)0)
  #define DEBUG_LOGF(fmt, ...) ((void)0)
#endif

// Always-on log for critical events
#define LOG_ERROR(msg)   Serial.print("[ERR] "); Serial.println(msg)
#define LOG_INFO(msg)    Serial.print("[INF] "); Serial.println(msg)
