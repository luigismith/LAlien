# TODO — Lalìen Companion

## ✅ Phase 0 — Bootstrap
- [x] Create project directory structure
- [x] Install arduino-cli + arduino:mbed_giga core
- [x] Create HAL stubs (display, touch, IMU, mic, light, SD, audio)
- [x] Create main .ino with cooperative loop skeleton
- [x] Create utility headers (config.h, crypto.h)
- [x] Document hardware in HARDWARE.md, DEPENDENCIES.md

## ✅ Phase 1 — Sprite Generator + Language & Lore
- [x] Write primitives.py (drawing functions, 9 eye expressions, mood particles)
- [x] Write palettes.py (color palettes per personality/stage/mood)
- [x] Write stages.py (8 stage definitions with mood-aware rendering)
- [x] Write dna.py (DNA -> visual params parser)
- [x] Write animator.py (13+ animations per stage)
- [x] Write generate.py (entry point + contact sheet)
- [x] 8 stages x 16 variants generated
- [x] Alien language pack (~130 words, 14 categories)
- [x] 5 UI language packs (it/en/es/fr/de)
- [x] 30 lore fragments (it+en)
- [x] LORE.md — full Echoa cosmology
- [x] Sprite art overhaul (expressive eyes, mood particles, stage color warmth)

## ✅ Phase 2 — Sprite Engine + UI Framework
- [x] R565 sprite loader with magenta transparency key
- [x] LRU cache (24 slots, 4MB SDRAM budget)
- [x] 4x nearest-neighbor scaling (64x64 -> 256x256)
- [x] LVGL 9.x image integration + minimal JSON parser for meta.json
- [x] UI Manager with 8 screen dispatches (MAIN, EGG, CONVERSATION, DIARY, SETTINGS, GRAVEYARD, LEXICON, MINIGAME)
- [x] Dark Mediterranean theme (black bg, gold accents, night blue)
- [x] Speech bubble with typewriter effect (30 cps, 6 mood variants)
- [x] Font manager

## ✅ Phase 3 — Pet State Machine + Persistence
- [x] 10-need system with configurable decay rates
- [x] 8 evolution stages with precise triggers (age + vocab + needs + interactions)
- [x] DNA phonetic system (SHA-256 from sensor data at hatching)
- [x] 5 personality trait dimensions + prompt block builder
- [x] 7 death types with duration-based triggers + timer persistence
- [x] Transcendence requirements (bond>90, cosmic>80, all needs>80 sustained 48h)
- [x] Save manager with atomic writes (.tmp/.bak pattern)
- [x] Pet serializer with death tracker fields for power-loss recovery
- [x] Graveyard (50 entries, last words, personality, DNA, gold transcended)
- [x] Diary (per-entry files with index tracking)
- [x] Vocabulary store (500 entries, atomic SD writes)
- [x] Memory store (20 entries FIFO, atomic SD writes)

## ✅ Phase 4 — Network Stack
- [x] WiFi station mode with reconnect
- [x] NTP sync via NTPClient
- [x] Captive portal (DNS hijack + lore-themed HTML setup wizard)
- [x] TLS root CAs (ISRG X1, Amazon CA 1, DigiCert G2)
- [x] AES-128 API key encryption via mbedtls

## ✅ Phase 5 — AI Pipeline
- [x] Async LLM client (Anthropic Claude + OpenAI GPT) with 6-state HTTP machine
- [x] 5-turn conversation history with rate limiting + retry with backoff
- [x] Dynamic system prompt builder (8 stage-specific language mixing instructions)
- [x] Whisper STT client with WAV builder + multipart upload
- [x] Wake word detection (VAD + fuzzy Levenshtein matching)

## ✅ Phase 6 — Diary, Vocabulary, Memory
- [x] Diary generator (auto after 5 conversations, LLM-written from creature POV)
- [x] Vocabulary extractor (200 words, LFU eviction, 5-language stop words)
- [x] Conversation memory log (20 entries FIFO, condensed summaries)
- [x] System prompt injects long memory + vocabulary blocks
- [x] Diary screen with scrollable list and detail view

## ✅ Phase 7 — STT Integration
- [x] Conversation screen with push-to-talk and virtual keyboard
- [x] Mic button widget (idle/recording/processing states, waveform ring)
- [x] 15-second max recording with visual feedback
- [x] STT client busy/error/reset methods

## ✅ Phase 8 — Evolutions & Death
- [x] 7 death types fully implemented with trigger conditions
- [x] Evolution triggers for all 8 stages
- [x] Evolution animation state flags for UI
- [x] Pet lifecycle: transcendence, farewell, automatic burial
- [x] Graveyard screen with memorial detail view (transcended = gold)

## ✅ Phase 9 — Localization & Lexicon
- [x] i18n system loading JSON lang packs from SD (it/en/es/fr/de)
- [x] All 5 locale files with 40+ UI string keys each
- [x] Alien vocabulary expanded to ~130 words, 14 categories
- [x] Lexicon screen (scrollable, category filter, detail panel, learned/total counter)
- [x] System prompt stage instructions rewritten with richer behavioral guidance

## ✅ Phase 10 — UI Polish
- [x] Theme: button press scale animation, loading spinner overlay, consistent spacing
- [x] Status bar (pet name, stage icon, 10 need dots, WiFi, time)
- [x] Need bars overlay (10 animated color-gradient bars with labels)
- [x] Main screen: breathing animation, quick action bar (5 buttons)
- [x] Screen transitions with fade animations

## ✅ Mini-Games (Bonding Rituals)
- [x] Thishi-Revosh (Echo Memory) — ancestral choral song replay, unlocks vocabulary
- [x] Miska-Vythi (Light Cleansing) — sevra membrane purification, deepens navresh
- [x] Selath-Nashi (Star Joy) — syrma path tracing, develops cosmic awareness
- [x] All 3 contextualized in Echoa lore with Lalien terminology
- [x] Pet::applyGameResult() bridges play to growth (needs + vocab + interactions + dreams)
- [x] Game selection popup on main screen with lore descriptions

## Remaining Work
- [ ] Run png_to_r565.py converter on full sprite set
- [ ] Generate all 16 DNA variants (currently only variant_00)
- [ ] Arduino IDE / PlatformIO compilation test
- [ ] Hardware integration testing on actual GIGA R1 + Display Shield
- [ ] 24h+ stability/stress test
- [ ] USER_GUIDE.md
- [ ] TROUBLESHOOTING.md

## Known Gaps
- `noise` Python package won't build on 3.14 — using numpy Perlin noise instead
- Audio output needs hardware verification (no speaker on Display Shield)
- LVGL integration needs testing on actual hardware
- arduino-cli core installation was problematic; may need manual setup
