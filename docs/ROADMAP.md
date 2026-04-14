# Lalìen Companion — Roadmap

Ideas for evolving the project beyond its current state. Each item has an
estimated impact (🔥 high / 🎨 emotional / 🛠 technical / 🌌 long-term) and a
rough implementation cost.

---

## 🔥 High impact, low effort

### 1. Service Worker + offline PWA
Make the app installable from iOS / Android home screen and playable offline.
- Add `manifest.json` (icon set, theme, display=standalone)
- Register `sw.js` caching static assets (stale-while-revalidate)
- Unlocks true Web Push (see item #21)
- Size: ~1 day

### 2. Sentiment analysis on user input
Today the user's text is invisible to the pet's stats. Classify sentiment
(positive / neutral / negative) and use it to modulate NASHI and AFFECTION:
kind words → mood+, aggressive words → mood-.
- Implementation: local keyword-based classifier (no extra API cost) or a
  `sentiment` field requested from the LLM alongside the reply.
- Size: ~2 h
- **Status: in progress**

### 3. Bidirectional vocabulary
Currently only the LLM reply contributes new alien words. Also extract alien
words from **user input** — when the keeper uses a word first, the pet
"learns it from them". Track provenance (taught vs. spoken).
- Enables co-created language, stronger emotional bond.
- Size: ~1.5 h
- **Status: in progress**

### 4. Passkey / WebAuthn login
Replace PIN with passkeys for cross-device sync. Phishing-proof, no password
management, smoother onboarding.
- Size: 1 day (needs small backend change)

### 5. Local telemetry buffer
Ring-buffer (1000 events) of need-changes, actions, evolutions, deaths in
IndexedDB. Surfaced in a "Life log" tab in settings. Gold for debugging and
for players who want to retrospect.
- Size: ~half day

---

## 🎨 Emotional engagement

### 6. Persistent mood & temperament
Move from instantaneous mood (derived from current needs) to an EMA-smoothed
"temperament" that takes days/weeks to drift. A neglected pet stays distrustful
for days after being fed again.
- Size: ~1 day

### 7. Dreams
When pet sleeps (MOKO > 80, screen backgrounded / dark), the LLM generates
a short dream narrative using the pet's recent memories. Readable in the
diary on wake-up. Concretizes memory as story.
- Size: ~1 day

### 8. Sensory keepsakes
On milestone events (first evolution, first illness, first mini-game win)
auto-save a canvas snapshot + DNA state + needs array. Browsable as a photo
album in settings.
- Size: ~1 day

### 9. Real circadian cycle
Use local clock. Pet sleeps at night, is active by day. Meditation is more
effective at dawn/dusk. Aligns game time to the keeper's real life.
- Size: ~4 h

---

## 🛠 Technical quality

### 10. TypeScript or strict JSDoc
Codebase is big enough to benefit from types. Minimum: JSDoc `@typedef` for
`PetState`, `NeedsArray`, `DNA`. Free autocomplete + error catching.
- Size: incremental

### 11. Optional Vite bundler
Dev stays ES-module direct (no build needed). Production: tree-shaken and
minified — halves initial payload.
- Size: ~half day

### 12. Unit tests on pet state machine
Needs decay, evolution triggers, death conditions. 30 lines of Vitest setup.
Hardens the most fragile part of the game.
- Size: ~half day

### 13. Content Security Policy on `httpd_lalien.py`
Restrictive CSP header. Protects against future XSS if we ever surface
untrusted LLM output as HTML.
- Size: 30 min

### 14. Split LLM contract
`system-prompt.js` and `llm-client.js` are tightly coupled. Extract
`LLMPromptBuilder` — pure function from an immutable pet snapshot to the
prompt string. Makes the voice of the pet testable offline.
- Size: ~half day

---

## 🌌 Long-term vision

### 15. Asynchronous multiplayer — "Lalìen colony"
Each keeper owns their own pet, but pets can "meet in dreams" when both
sleep. They exchange one alien word. The lexicon becomes viral and cultural.
- Needs: cloud backend aware of multiple users, rendezvous algorithm
- Size: 2-3 weeks

### 16. Public epitaph + family tree
On pet death, with keeper consent, epitaph is added to a shared graveyard
browsable from the menu. New pet inherits a name-suffix from predecessor.
- Size: ~1 week (needs moderation layer)

### 17. Deep DNA-driven sprite variation
Sprites are currently stage-keyed procedural. Expand DNA so no two Lalìens
look identical. Already partially done — push further with features like
ear shape, fur pattern, eye layout as DNA traits.
- Size: 1 week

### 18. "Absent keeper" ritual
If you don't open the app for N days, on return the pet asks where you've
been. Attitude shifts (distrustful, anxious, serene) based on absence length.
- Size: ~2 days

### 19. Exportable biography PDF
Post-mortem: generate a printable document with diary, learned words,
evolutions, needs-over-time graph. Monument + shareability.
- Size: ~1 day

### 20. Public read API for the pet
Opt-in endpoint returning the current pet state. Enables home dashboard, Siri
shortcuts ("how's my Lalìen?"), iOS widget.
- Size: ~2 days (API) + platform-specific widgets on top

### 21. Web Push (true background notifications)
Current notifications require the browser to be running. Real Web Push needs
Service Worker + VAPID keys + a tiny push server that sends messages when
`httpd_lalien.py` detects a critical need.
- Depends on #1 (Service Worker)
- Size: ~2-3 days

---

## Already shipped
- PIN-based cloud saves with per-user isolation
- Procedural sound engine (54 methods)
- Stage-evolving TTS voice
- Tutorial system
- Death/rebirth with epitaph
- Needs as emoji chips with conic rings
- Drag-to-action, shake-to-play, circular-scrub gestures
- Local need notifications
- Audio master toggle
- Meditation dormant before stage 6 (bug fix)

---

## Picking the next item

If unsure, the ideal next trio is: **#2 (sentiment) + #3 (bidirectional
vocab) + #1 (Service Worker)**. Combined they transform the pet from a
reactive automaton into something that listens, co-creates with you, and
lives in your pocket.
