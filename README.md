# Lalìen Companion

Un companion AI permadeath ispirato al Tamagotchi. Un cucciolo alieno che impara la tua lingua, evolve attraverso 8 stadi, e alla fine muore o trascende — lasciando un'eredità linguistica nel cimitero del dispositivo.

## Hardware

- Arduino GIGA R1 WiFi (STM32H747XI)
- Arduino GIGA Display Shield (800x480 touch, mic, IMU, light sensor, microSD)

## Quick Start

1. Prepara la microSD card con il contenuto di `sd_card_template/`
2. Carica il firmware sulla GIGA R1 WiFi
3. Al primo avvio, connettiti alla rete WiFi `Lalien-Setup-XXXX` dal tuo smartphone
4. Segui il setup guidato (lingua, WiFi, API key)
5. Il tuo Lalìen sta per schiudersi

## Build

```bash
# Installa toolchain
arduino-cli core install arduino:mbed_giga

# Compila
arduino-cli compile --fqbn arduino:mbed_giga:giga firmware/

# Upload
arduino-cli upload --fqbn arduino:mbed_giga:giga -p COM<N> firmware/
```

## Sprite Generator

```bash
cd tools/sprite_generator
python -m venv ../.venv
source ../.venv/Scripts/activate  # Windows
pip install -r requirements.txt
python generate.py --output-dir ../../sd_card_template/sprites
```

## Struttura

Vedi `docs/ARCHITECTURE.md` per i dettagli.

## Licenza

Progetto personale di Luigi Massari. Tutti i diritti riservati.
