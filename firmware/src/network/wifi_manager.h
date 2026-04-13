/**
 * wifi_manager.h — WiFi station mode management with auto-reconnect
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Network {
namespace WiFiMgr {

    void init();
    bool connect(const char* ssid, const char* password);
    bool isConnected();
    void disconnect();
    void checkConnection(); // auto-reconnect if dropped

    /// Get signal strength (RSSI).
    int32_t getRSSI();

    /// Get local IP as string.
    String getLocalIP();

} // namespace WiFiMgr
} // namespace Network
