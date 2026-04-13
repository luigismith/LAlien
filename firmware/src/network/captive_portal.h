/**
 * captive_portal.h — Soft AP + DNS hijack + web server for initial setup
 * Serves lore intro, language selector, WiFi form, API key form
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Network {
namespace CaptivePortal {

    /// Start captive portal (blocking until setup is complete).
    /// Creates soft AP, DNS hijack, serves HTML pages.
    void start();

    /// Start reduced portal (WiFi-only change, no pet loss).
    void startWiFiOnly();

    /// Returns true if portal is currently active.
    bool isActive();

} // namespace CaptivePortal
} // namespace Network
