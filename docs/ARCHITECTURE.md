# Architecture — Lalìen Companion

## Runtime Model

Cooperative event loop (non-preemptive) with 5 logical tasks:

```
main loop (M7 core):
  ├── input_task        (16ms / 60Hz)  — touch, IMU events, mic level, light
  ├── pet_state_task    (1000ms / 1Hz) — needs decay, evolution check, death check
  ├── ui_task           (33ms / 30Hz)  — LVGL tick, sprite animation, screen updates
  ├── ai_task           (100ms / 10Hz) — async HTTP state machine for LLM/STT
  └── persistence_task  (60s)          — autosave dirty data to SD
```

M4 core handles sensor sampling at lower frequency and needs decay computation, communicating with M7 via RPC.

## Module Map

```
firmware/src/
  hal/         — Hardware abstraction (display, touch, IMU, mic, light, SD, audio)
  ui/          — LVGL screens, sprite engine, speech bubble, theme
  pet/         — State machine, needs, evolution, DNA, personality, death
  ai/          — LLM client (Anthropic/OpenAI), STT (Whisper), system prompt builder
  persistence/ — Save manager, serializers, diary, graveyard
  network/     — WiFi, captive portal, NTP, TLS certs
  i18n/        — Internationalization (5 languages)
  util/        — Config, debug macros
```

## Data Flow

1. **Sensors** → HAL → pet state + UI reactions
2. **Touch** → UI manager → care actions / conversation input
3. **Conversation** → system prompt builder → LLM provider → response → speech bubble
4. **Needs decay** → evolution/death checks → state transitions → sprite changes
5. **Persistence** → SD card (atomic writes with .bak recovery)

## Memory Layout

- Internal RAM (1MB): code, stack, small buffers
- External SDRAM (8MB): LVGL framebuffer (800x480x2 = 768KB), draw buffers (2x 96KB), sprite LRU cache (~4MB), conversation buffers
- microSD: all persistent data (pet state, diary, vocabulary, sprites, config)

## AI Pipeline

```
User input (text or STT) → system prompt assembly → HTTP POST (async state machine)
→ JSON parse → response text → speech bubble (typewriter) → vocabulary extraction
→ persistence (conversation log, vocabulary update)
```

Provider abstraction: `LLMProvider` interface with Anthropic and OpenAI implementations.
