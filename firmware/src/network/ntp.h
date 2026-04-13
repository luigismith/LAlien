/**
 * ntp.h — NTP time synchronization
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Network {
namespace NTP {

    void init();
    bool sync(); // sync with NTP server
    uint32_t getEpoch(); // current Unix timestamp
    bool isSynced();

    // Convenience
    uint8_t getHour();   // 0-23
    uint8_t getMinute(); // 0-59
    bool isNight();      // 22:00-06:00

} // namespace NTP
} // namespace Network
