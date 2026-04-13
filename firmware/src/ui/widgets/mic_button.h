/**
 * mic_button.h -- Reusable push-to-talk microphone button widget
 * Circular LVGL button with mic icon, pulsing red while recording,
 * spinning animation while processing STT.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>
#include "lvgl.h"

namespace UI {
namespace MicButton {

    enum class State : uint8_t {
        IDLE,           // grey, ready for input
        RECORDING,      // pulsing red, waveform ring
        PROCESSING,     // spinning indicator, waiting for STT
    };

    /// Callback signature: called when recording stops with audio data.
    typedef void (*RecordingDoneCallback)(const int16_t* data, uint32_t sample_count);

    /// Create the mic button widget as child of parent.
    void create(lv_obj_t* parent);

    /// Destroy the widget and free resources.
    void destroy();

    /// Update animations (call at ~30Hz). Handles pulse, waveform, spinner.
    void update();

    /// Get current state.
    State getState();

    /// Set state externally (e.g., PROCESSING -> IDLE when STT completes).
    void setState(State state);

    /// Set the callback for when recording completes.
    void setRecordingDoneCallback(RecordingDoneCallback cb);

    /// Get the LVGL button object (for external layout).
    lv_obj_t* getButton();

    /// Set recording time limit in milliseconds (default 15000).
    void setMaxRecordingMs(uint32_t ms);

} // namespace MicButton
} // namespace UI
