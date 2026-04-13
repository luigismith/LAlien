# Installed Tools — Lalìen Companion

## Build toolchain

| Tool | Version | Purpose |
|---|---|---|
| arduino-cli | 1.4.1 | Firmware compilation and upload for Arduino GIGA R1 WiFi |
| arduino:mbed_giga core | (installing) | Board support package for STM32H747XI |
| Python | 3.14.4 | Sprite generator and build tools |

## Python venv (`tools/.venv/`)

| Package | Version | Purpose |
|---|---|---|
| Pillow | 12.2.0 | Procedural sprite generation (drawing primitives, PNG output) |
| numpy | 2.4.4 | Array operations for sprite manipulation, Perlin noise |

## Arduino libraries (via arduino-cli lib install)

| Library | Purpose |
|---|---|
| Arduino_H7_Video | Display output for GIGA Display Shield |
| Arduino_GigaDisplayTouch | Capacitive touch input |
| Arduino_GigaDisplay_GFX | Fallback graphics if LVGL has issues |
| Arduino_LSM6DSOX | IMU (accelerometer + gyroscope) |
| ArduinoHttpClient | HTTP/HTTPS requests to LLM/STT APIs |
| ArduinoJson | JSON serialization (v7) |
| NTPClient | Time synchronization |
| lvgl | UI framework (v9.x) |

## MCP servers

*None installed yet — filesystem and standard tools sufficient for current phase.*
