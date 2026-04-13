/**
 * wifi_manager.cpp — WiFi station mode management with auto-reconnect
 * Handles WPA2 connection, disconnect, signal strength, and periodic
 * reconnect attempts when the link drops.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "wifi_manager.h"
#include <WiFi.h>

namespace Network {
namespace WiFiMgr {

// --- Internal state ---------------------------------------------------

static constexpr uint32_t CONNECT_TIMEOUT_MS   = 15000; // 15 s
static constexpr uint32_t RECONNECT_INTERVAL   = 30000; // 30 s cooldown

static char     s_ssid[64]     = {0};
static char     s_password[64] = {0};
static uint32_t s_lastReconnectAttempt = 0;
static bool     s_initialized  = false;

// --- Public API -------------------------------------------------------

void init() {
    // Ensure the WiFi radio is in station mode and idle.
    WiFi.disconnect();
    delay(100);
    s_initialized = true;
}

bool connect(const char* ssid, const char* password) {
    if (!s_initialized) init();

    // Store credentials for reconnect
    strncpy(s_ssid,     ssid,     sizeof(s_ssid) - 1);
    strncpy(s_password, password, sizeof(s_password) - 1);

    WiFi.begin(ssid, password);

    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start >= CONNECT_TIMEOUT_MS) {
            WiFi.disconnect();
            return false;
        }
        delay(250);
    }

    s_lastReconnectAttempt = millis();
    return true;
}

bool isConnected() {
    return (WiFi.status() == WL_CONNECTED);
}

void disconnect() {
    WiFi.disconnect();
}

void checkConnection() {
    if (isConnected()) return;
    if (s_ssid[0] == '\0') return; // no stored credentials

    uint32_t now = millis();
    if (now - s_lastReconnectAttempt < RECONNECT_INTERVAL) return;

    s_lastReconnectAttempt = now;

    // Non-blocking-ish reconnect: just kick off WiFi.begin and let the
    // next call to checkConnection() observe whether it succeeded.
    WiFi.begin(s_ssid, s_password);
}

int32_t getRSSI() {
    return WiFi.RSSI();
}

String getLocalIP() {
    return WiFi.localIP().toString();
}

} // namespace WiFiMgr
} // namespace Network
