/**
 * ntp.cpp — NTP time synchronization
 * Uses the NTPClient library over WiFiUDP to keep a Unix epoch clock
 * in sync.  Provides convenience helpers for hour/minute/night detection.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "ntp.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include <NTPClient.h>

namespace Network {
namespace NTP {

// --- Internal state ---------------------------------------------------

static WiFiUDP   s_udp;
static NTPClient s_ntp(s_udp, "pool.ntp.org", 0, 3600000); // UTC, refresh 1 h
static bool      s_synced = false;

// --- Public API -------------------------------------------------------

void init() {
    s_ntp.begin();
}

bool sync() {
    bool ok = s_ntp.forceUpdate();
    if (ok) s_synced = true;
    return ok;
}

uint32_t getEpoch() {
    return s_ntp.getEpochTime();
}

bool isSynced() {
    return s_synced;
}

uint8_t getHour() {
    return static_cast<uint8_t>(s_ntp.getHours());
}

uint8_t getMinute() {
    return static_cast<uint8_t>(s_ntp.getMinutes());
}

bool isNight() {
    uint8_t h = getHour();
    return (h >= 22 || h < 6);
}

} // namespace NTP
} // namespace Network
