# Dependencies — Lalìen Companion

## Arduino Core
- `arduino:mbed_giga` v4.5.0 — Board support for Arduino GIGA R1 WiFi (STM32H747XI)

## Arduino Libraries (via arduino-cli lib install)

| Library | Version | Purpose |
|---|---|---|
| Arduino_GigaDisplay | 1.0.2 | GIGA Display Shield integration |
| Arduino_GigaDisplayTouch | 1.0.1 | Capacitive touch input |
| Arduino_GigaDisplay_GFX | 1.1.0 | GFX graphics fallback |
| Arduino_LSM6DSOX | 1.1.2 | IMU (accelerometer + gyroscope) |
| Arduino_APDS9960 | 1.0.4 | Ambient light + RGB sensor |
| ArduinoHttpClient | 0.6.1 | HTTP/HTTPS requests |
| ArduinoJson | 7.4.3 | JSON serialization (v7) |
| NTPClient | 3.2.1 | NTP time synchronization |
| lvgl | 9.5.0 | UI framework |
| ArduinoGraphics | 1.1.5 | Graphics primitives (dep of GigaDisplay) |
| Adafruit GFX Library | 1.12.6 | GFX base (dep of GigaDisplay_GFX) |
| Adafruit BusIO | 1.17.4 | I2C/SPI bus (dep) |
| Arduino_BMI270_BMM150 | 1.2.3 | Motion sensor (dep of GigaDisplay) |

## Python (tools/.venv/)

| Package | Version | Purpose |
|---|---|---|
| Pillow | 12.2.0 | Sprite generation (drawing, PNG output) |
| numpy | 2.4.4 | Array ops, Perlin noise |

## Build Tools

| Tool | Version |
|---|---|
| arduino-cli | 1.4.1 |
| Python | 3.14.4 |
| git | (system) |
