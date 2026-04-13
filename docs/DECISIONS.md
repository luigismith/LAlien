# Design Decisions — Lalìen Companion

Non-obvious decisions not covered by the spec, with rationale.

---

## D001 — Audio output: visual-only as default (2026-04-13)
**Agent**: firmware-architect
**Decision**: Default to visual-only "song" effects (concentric circles from core, pixel particles). The GIGA Display Shield has no built-in speaker. DAC output on A12 is available but requires external piezo/amplifier.
**Rationale**: Per spec section 15 — verify audio output first, fallback to visual. Hardware verification pending, so visual path is primary. DAC code is stubbed for optional activation.

## D002 — Python `noise` library unavailable on Python 3.14 (2026-04-13)
**Agent**: orchestrator
**Decision**: Use numpy-based Perlin noise implementation instead of the `noise` package, which fails to build wheels on Python 3.14.
**Rationale**: The `noise` package has C extensions that don't compile on Python 3.14. A pure-Python/numpy Perlin noise generator is sufficient for sprite pattern generation.
