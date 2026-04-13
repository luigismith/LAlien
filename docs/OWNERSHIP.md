# Path Ownership — Lalìen Companion

This document defines which subagent owns which paths. **Never parallelize two agents writing to the same paths.**

## Phase 0 — Bootstrap

| Path | Owner |
|---|---|
| `firmware/` (all) | firmware-architect |
| `docs/HARDWARE.md` | firmware-architect |
| `docs/DEPENDENCIES.md` | firmware-architect |

## Phase 1 — Sprite Generator

| Path | Owner |
|---|---|
| `tools/sprite_generator/` | pixel-artist-procedural |
| `sd_card_template/sprites/` | pixel-artist-procedural |
| `tools/lang_packs/alien.json` | lore-and-language-curator |
| `docs/ALIEN_LANGUAGE.md` | lore-and-language-curator |

## Phase 2 — Sprite Engine Firmware

| Path | Owner |
|---|---|
| `firmware/src/ui/sprite_engine.*` | embedded-graphics-engineer |
| `firmware/src/ui/ui_manager.*` | embedded-graphics-engineer |
| `firmware/src/ui/theme.*` | embedded-graphics-engineer |
| `firmware/src/ui/screens/` | embedded-graphics-engineer |

## Phase 3 — Pet State Machine

| Path | Owner |
|---|---|
| `firmware/src/pet/` | pet-systems-designer |
| `firmware/src/persistence/` | persistence-engineer |
| `firmware/src/util/config.*` | pet-systems-designer |

## Phase 4 — Captive Portal

| Path | Owner |
|---|---|
| `firmware/src/network/` | network-engineer |
| `firmware/src/util/crypto.*` | persistence-engineer |

## Phase 5 — LLM Client

| Path | Owner |
|---|---|
| `firmware/src/ai/` | ai-integration-engineer |
| `firmware/src/ai/system_prompt.cpp` (templates only) | lore-and-language-curator |

## Phase 6-10 — See matrix in spec 17bis.4

Ownership is updated at the start of each phase.
