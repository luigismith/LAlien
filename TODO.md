# TODO — Lalìen Companion

## Phase 0 — Bootstrap
- [x] Create project directory structure
- [x] Install arduino-cli
- [ ] Install arduino:mbed_giga core (in progress)
- [ ] Install Arduino libraries
- [x] Create HAL stubs (display, touch, IMU, mic, light, SD, audio)
- [x] Create main .ino with cooperative loop skeleton
- [ ] Create utility headers (config.h, debug.h)
- [ ] Create remaining module stubs (UI, pet, AI, persistence, network, i18n)
- [ ] Compile hello world sketch
- [ ] Test each peripheral with individual sketch
- [ ] Document test results in HARDWARE.md

## Phase 1 — Sprite Generator
- [ ] Write primitives.py (drawing functions)
- [ ] Write palettes.py (color palettes per personality/stage)
- [ ] Write stages.py (8 stage definitions)
- [ ] Write dna.py (DNA → visual params parser)
- [ ] Write animator.py (animation frame generation)
- [ ] Write generate.py (entry point)
- [ ] MVP: 2 stages, 1 variant, verify visually
- [ ] Scale to 8 stages × 16+ variants
- [ ] Contact sheet generation
- [ ] Validation tests

## Phase 2-10
See spec section 18 for full roadmap.

## Known Gaps
- `noise` Python package won't build on 3.14 — using numpy Perlin noise instead
- Audio output needs hardware verification (no speaker on Display Shield)
- LVGL integration needs testing on actual hardware
