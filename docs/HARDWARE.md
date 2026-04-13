# Hardware Documentation — Lalìen Companion

## Target Hardware

### Arduino GIGA R1 WiFi
- MCU: STM32H747XI dual-core (Cortex-M7 @ 480MHz + Cortex-M4 @ 240MHz)
- Flash: 2MB
- RAM: 1MB internal + 8MB SDRAM external
- WiFi/BT: Murata 1DX module
- DAC: A12 (for optional audio output)
- USB-C power

### Arduino GIGA Display Shield
- Display: TFT 800x480 capacitive touchscreen
- Microphone: MEMS PDM
- IMU: LSM6DSOX 6-axis (accelerometer + gyroscope)
- Light sensor: APDS-9960 (ambient + RGB)
- Storage: microSD card slot
- Camera connector: not used

## Peripheral Test Results

| Peripheral | Status | Notes |
|---|---|---|
| Display (800x480 TFT) | STUB | HAL created, awaiting hardware test |
| Capacitive touch | STUB | HAL created, awaiting hardware test |
| IMU (LSM6DSOX) | STUB | HAL created with shake/tilt/impact detection |
| PDM Microphone | STUB | HAL created with level monitoring + recording buffer |
| Light sensor (APDS-9960) | STUB | HAL created with ambient + RGB + hue derivation |
| microSD | STUB | HAL created with full file operations |
| Audio (DAC A12) | STUB | Visual-only fallback as default (no speaker on shield) |
| SDRAM (8MB) | STUB | Used for framebuffer + sprite cache |

## Architecture Notes

- M7 core: UI (LVGL) + AI (HTTPS) + main event loop
- M4 core: sensor sampling (IMU, light, mic level) + needs decay computation
- Inter-core communication: RPC.h
- Cooperative event loop (non-preemptive), all tasks non-blocking
