/**
 * lalien_companion.ino — Main entry point for Lalìen Companion firmware
 * Target: Arduino GIGA R1 WiFi + Giga Display Shield
 * Architecture: Cooperative event loop, dual-core M7 (main) + M4 (sensors/decay)
 * Author: Claude Code
 * Date: 2026-04-13
 */

#include "src/hal/display.h"
#include "src/hal/touch.h"
#include "src/hal/imu.h"
#include "src/hal/mic.h"
#include "src/hal/light.h"
#include "src/hal/sd_storage.h"
#include "src/hal/audio.h"

#include "src/ui/ui_manager.h"
#include "src/ui/sprite_engine.h"

#include "src/pet/pet.h"
#include "src/pet/needs.h"
#include "src/pet/evolution.h"
#include "src/pet/dna.h"
#include "src/pet/personality.h"
#include "src/pet/death.h"

#include "src/ai/llm_client.h"
#include "src/ai/stt_client.h"
#include "src/ai/system_prompt.h"

#include "src/persistence/save_manager.h"
#include "src/persistence/graveyard.h"

#include "src/network/wifi_manager.h"
#include "src/network/captive_portal.h"
#include "src/network/ntp.h"

#include "src/i18n/i18n.h"
#include "src/util/config.h"
#include "src/util/debug.h"

// ---------------------------------------------------------------------------
// Timing constants (ms)
// ---------------------------------------------------------------------------
static constexpr uint32_t INPUT_INTERVAL_MS       = 16;   // ~60 Hz
static constexpr uint32_t PET_STATE_INTERVAL_MS    = 1000; // 1 Hz
static constexpr uint32_t UI_INTERVAL_MS           = 33;   // ~30 Hz (LVGL tick)
static constexpr uint32_t AI_INTERVAL_MS           = 100;  // 10 Hz state machine poll
static constexpr uint32_t PERSISTENCE_INTERVAL_MS  = 60000; // 1 min autosave

// ---------------------------------------------------------------------------
// Task timing
// ---------------------------------------------------------------------------
static uint32_t last_input_ms       = 0;
static uint32_t last_pet_state_ms   = 0;
static uint32_t last_ui_ms          = 0;
static uint32_t last_ai_ms          = 0;
static uint32_t last_persistence_ms = 0;

// ---------------------------------------------------------------------------
// Forward declarations for cooperative tasks
// ---------------------------------------------------------------------------
static void input_task();
static void pet_state_task();
static void ui_task();
static void ai_task();
static void persistence_task();

// ---------------------------------------------------------------------------
// setup()
// ---------------------------------------------------------------------------
void setup() {
    Serial.begin(115200);
    while (!Serial && millis() < 3000) {} // wait up to 3s for serial

    DEBUG_LOG("Lalien Companion — booting...");

    // Initialize HAL
    HAL::Display::init();
    HAL::Touch::init();
    HAL::IMU::init();
    HAL::Mic::init();
    HAL::Light::init();
    HAL::SDStorage::init();
    HAL::Audio::init();

    // Initialize UI (LVGL)
    UI::Manager::init();

    // Check if config exists on SD → first boot or normal boot
    if (!HAL::SDStorage::fileExists("/lalien/config.json")) {
        DEBUG_LOG("First boot — starting captive portal");
        Network::CaptivePortal::start();
        // CaptivePortal blocks until setup is complete and config is saved
    }

    // Load config
    Config::load();

    // Initialize WiFi
    Network::WiFiMgr::connect(Config::getSSID(), Config::getPassword());
    Network::NTP::sync();

    // Initialize pet (load from SD or create egg state)
    Pet::init();

    // Initialize AI client
    AI::LLMClient::init(Config::getProvider(), Config::getAPIKey());

    // Initialize sprite engine
    UI::SpriteEngine::init();

    // Show main screen
    UI::Manager::showMainScreen();

    DEBUG_LOG("Boot complete — entering main loop");
}

// ---------------------------------------------------------------------------
// loop() — cooperative multitasking
// ---------------------------------------------------------------------------
void loop() {
    uint32_t now = millis();

    if (now - last_input_ms >= INPUT_INTERVAL_MS) {
        last_input_ms = now;
        input_task();
    }

    if (now - last_pet_state_ms >= PET_STATE_INTERVAL_MS) {
        last_pet_state_ms = now;
        pet_state_task();
    }

    if (now - last_ui_ms >= UI_INTERVAL_MS) {
        last_ui_ms = now;
        ui_task();
    }

    if (now - last_ai_ms >= AI_INTERVAL_MS) {
        last_ai_ms = now;
        ai_task();
    }

    if (now - last_persistence_ms >= PERSISTENCE_INTERVAL_MS) {
        last_persistence_ms = now;
        persistence_task();
    }
}

// ---------------------------------------------------------------------------
// Task implementations
// ---------------------------------------------------------------------------

static void input_task() {
    HAL::Touch::poll();
    HAL::IMU::poll();
    HAL::Mic::pollLevel();
    HAL::Light::poll();

    // Process touch events → UI manager
    if (HAL::Touch::hasEvent()) {
        UI::Manager::handleTouch(HAL::Touch::getEvent());
    }

    // Process IMU events → pet reactions
    auto imu_event = HAL::IMU::getEvent();
    if (imu_event.type != HAL::IMUEventType::NONE) {
        Pet::handleIMUEvent(imu_event);
    }
}

static void pet_state_task() {
    Pet::update(); // decay needs, check evolution triggers, check death conditions
}

static void ui_task() {
    UI::Manager::update(); // LVGL tick + animation updates
}

static void ai_task() {
    AI::LLMClient::poll(); // advance async HTTP state machine
}

static void persistence_task() {
    Persistence::SaveManager::autosave();
}
