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

## D003 -- Mic button as LVGL obj, not lv_button (2026-04-13)
**Agent**: embedded-graphics
**Decision**: MicButton uses a plain lv_obj_t with manual PRESSED/RELEASED events rather than lv_button_class, to avoid the theme's button scale animation interfering with the custom pulse animation during recording.
**Rationale**: The global theme auto-applies press animations to all lv_button objects. The mic button needs distinct visual states (idle/recording/processing) with custom animations, so using a plain container with LV_OBJ_FLAG_CLICKABLE avoids conflicts.

## D004 -- Status bar creates NeedBars overlay internally (2026-04-13)
**Agent**: embedded-graphics
**Decision**: StatusBar::create() also calls NeedBars::create() on the same parent. The expand/collapse is managed by StatusBar, not by external callers.
**Rationale**: The need bars overlay is conceptually owned by the status bar (tap to expand). Keeping creation and lifecycle together reduces coupling. External code only needs to call StatusBar::update() with needs data.

## D005 -- Quick action bar on main screen duplicates toolbar (2026-04-13)
**Agent**: embedded-graphics
**Decision**: The bottom quick-action bar on the main screen provides the 5 most common actions (feed, play, talk, sleep, clean) as large touch-friendly buttons, even though the right-side toolbar already has them.
**Rationale**: The toolbar icons are 48x48 and harder to hit on a touch display. The quick bar provides larger targets (80x40) with labels for the most frequent interactions. The toolbar retains all 8 actions including less-common ones (diary, settings, meditate).
