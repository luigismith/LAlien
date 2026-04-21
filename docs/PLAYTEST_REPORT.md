# Playtest Report — Lalìen Companion

*Session data: automated playtest agent, 2026-04-21, feat/phase-4-5-network-ai @ main.
Target: `web/` PWA on `localhost:8080`, pet forced to stage 3 (Lali-ko) with DNA.
24/24 sim-tests pass. 0 console errors during the session.*

---

## ✅ Cosa funziona già bene

| Area                   | Esito |
| ---------------------- | ----- |
| Sim-tests headless     | **24/24** asserzioni verdi (decay 2/8/24/72h, accoppiamento emotivo, saggezza lessico, convergenza HEALTH, floor offline) |
| Parser comandi chat    | 11/11 verbi riconosciuti con decisione corretta (`salta/balla/siediti/vieni/dormi/svegliati/mangia/lavati/canta/zitto/rifugio`). "ciao come va / hai sonno? / ti voglio bene" → pass-through all'LLM, **niente falsi match** (vecchio bug di "come" risolto) |
| Activity transitions   | SLEEPING/EATING/MEDITATING/SICK/AFRAID/SULKY entrano/escono senza leak |
| Evoluzione             | Stage 3 blockers rilevati correttamente (Età, Parole aliene) |
| Hit-test ambientale    | Pet, pod (portale/corona/guscio), lucciole, cristalli, sole/luna, farfalle, stelle cadenti — tutti cliccabili con kind corretto |
| Reliquiario            | 8 costellazioni, add stone funziona, archiviazione cimitero OK |
| PDF export             | `exportLivePet` / `exportGraveyardEntry` esposti e callable |
| Minigames lifecycle    | Tutti e 7 i tipi (Tetris, Pac-Lalì, Korìma, Vith, Thi, Shalim, Vythi) startano/renderizzano/endano senza throw. Classici **costano** MOKO, synth lo **restituiscono** — segno corretto. |
| Offline catch-up       | Floor 4h=45, 12h=28, 24h=12 rispettati; oltre 24h permadeath possibile |
| TTS fonetica           | "sha" → "scià", "thi" → "ti" — niente più spelling letterale |
| Volume slider          | Controlla Web Audio + TTS; a 0 silenzio totale |
| Stati emotivi coerenti | HONESTY_RULE + HOW_YOU_FEEL nel prompt eliminano "felice ma affamato" |

---

## 🐛 Bug oggettivi trovati

### B1 — "Sei sazio" detto mentre affamato
**Severity: media.** `Commands.doEat` rifiuta con `REPLIES.refuse.eat = 'mmh… sha, kora ko già'` (lett. *"hmm, no, sono già sazio"*) anche quando KORA è basso. Il rifiuto dipende dal roll di `complianceProb`, non dallo stato reale. **Test riprodotto**: KORA=20, tap "mangia" → pet risponde "sazio" pur essendo affamato.

**Fix suggerito**: `doEat` deve controllare lo stato PRIMA di rifiutare. Se KORA < 60, il rifuso non deve mai dire "sazio". Differenziare: `REPLIES.refuse.eat_full` vs `REPLIES.refuse.eat_sulky`. Oppure gate semplice: se KORA < 60 forza obbedienza.

### B2 — SECURITY recupera mentre il pet muore
**Severity: media-alta.** La regola `RECOVERY_SECURITY = 0.005/s` è applicata SEMPRE, anche quando tutti gli altri bisogni (incluso HEALTH) sono a zero. In 1 ora di morte per fame + disidratazione + trascuratezza, SECURITY risale da 0 → 18. Narrativamente incoerente: un pet che sta morendo non dovrebbe sentirsi "più al sicuro".

**Fix suggerito**: gate la recovery dietro `HEALTH > 35` e `othersAvg > 25`. Se il pet è in stato critico, SECURITY deve decadere (non recuperare). Codice ~1 riga in `needs.js`:
```js
if (state[NeedType.HEALTH] > 35 && needsAvgExcludingHealth(state) > 25) {
    addNeed(state, NeedType.SECURITY, RECOVERY_SECURITY * timeMult);
}
```

### B3 — "window" hit-region del pod è visivamente la corona (rune)
**Severity: bassa, confusione UX.** Il tap-test restituisce `'window'` per la corona del pod, ma non c'è una finestra: c'è una runa pulsante. Il codice eredita i nomi del cottage precedente. Funziona, ma è **confuso da debuggare**.

**Fix suggerito**: rinominare `'window' → 'crown'` in `shelter.hitTest()` + `game-loop shelter-tap` handler + manual. Semantica aggiornata: **porta**=entrare/uscire, **corona**=sveglio gentile (attualmente resta), **guscio**=sparkle+security.

---

## ⚖ Osservazioni di bilanciamento

### O1 — Offline 24h collassa a HEALTH=12 con pet curato prima
Se lasci il pet al 85% tutti e sparisci per 24h, torni e lo trovi a **HEALTH=12**. Gli attuali floor (12 a 24h) sono ok in teoria (permadeath raggiungibile) ma 24h → HEALTH=12 è spaventoso per un player medio.

**Suggerimento**: aumentare il floor a 24h da 12 → 25, e introdurre un "aid ritual" prima che il pet vada a dormire (se ha un cuscino vicino e MOKO<30, entra in sonno protetto che lo conserva a HEALTH=40 minimo per la notte).

### O2 — Minigioco classico Tetris score=0 con touch veloce
Nel test agentico, Kòra-Tris è partito, ricevuto un tap+drag, finito con score=0. Plausibile (non c'è stato tempo di clear line), ma vale controllare che con touch controls iPhone reale scores > 0 siano normali.

**Suggerimento**: aggiungere un indicatore visivo "punteggio=0 finora — prova a muovere i pezzi con drag orizzontale" per onboarding.

### O3 — Lessico passivo: a 150 parole COGNITION -45% decay
Formula `wisdomMult = max(0.35, 1 − vocab/220)` raggiunge il floor di 0.35 a ~145 parole. Su 151 parole totali nel lessico, questo significa che un pet che conosce TUTTO il lessico è comunque al floor. Va bene ma i pet difficilmente conoscono >50 parole senza custode dedicato.

**Suggerimento**: nessun cambio adesso. Monitor: se nessun pet raggiunge >100 parole nella vita, considerare rampa più rapida (divide by 150 invece di 220).

---

## 🎨 Osservazioni UX / design

### U1 — "Hai fame" quando KORA è alto
Osservazione del custode durante il gameplay reale (già fixato con `fullness=99/100` invece di `hunger=99/100` nel system-prompt, + HONESTY_RULE). **Da verificare con chiave LLM valida** che il nuovo prompt tenga.

### U2 — Diario ripetitivo sull'amore per il custode
Bug osservato dal custode, **fix appena deployato**: topic-seed a 16 categorie, last-3-entries passate al prompt per evitare ripetizioni, HARD_RULE "max 1 frase su amore". Da validare su più entries generate.

### U3 — Risposte oniriche non abbastanza oniriche a Lali-ko
Bug segnalato, **fix deployato**: 8 prompt oniriche stage-specifiche + poteri sovrannaturali da stage 3. Da validare con gameplay reale.

### U4 — Evoluzione "età richiesta" opaca
Lo screen impostazioni mostra "Età: 10h / 15h richieste" ma non mostra quanto tempo REALE aspettare. Con moltiplicatore 1x sono 5 ore reali. Confonde.

**Suggerimento**: aggiungere "ETA stimata: ~5h con gioco normale · ~5 min a 60x" accanto al blocker Età.

### U5 — Onboarding tutorial non menziona il Reliquiario né le farfalle-eco
Feature aggiunte dopo il tutorial originale.

**Suggerimento**: aggiungere 2-3 nuovi step tutorial trigger-based quando appare il primo sogno, la prima polaroid, le prime farfalle.

---

## ➕ Integrazioni/feature suggerite

### I1 — Casa: inventario di comfort
Il pod ora è muto internamente. Il custode potrebbe **depositare un cuscino / un cristallo** dentro la casa via drag, e il pet li userebbe da solo durante le assenze. Richiede una "hotspot" di drop all'entrata del pod.

### I2 — Settimana in un minuto — time-lapse cimetrale
Al termine della vita del pet, animazione di 30-60 secondi che **ripassa i momenti forti** (polaroid + prime/ultime parole + evoluzioni) prima dell'epitaffio. Dà peso emotivo alla permadeath.

### I3 — Clima a stagioni
Le stagioni (inverno / estate) modificano palette + comportamenti: meteo invernale rallenta decay KORA ma accelera MOKO; estate viceversa. Agganciabile al mese del calendario reale.

### I4 — Radio del custode
Il custode può "accendere una radio" dall'hotbar — suona un sample procedurale di 20 secondi (SoundEngine). Il pet ascolta, balla, la mente AI commenta. Stimolo CURIOSITY+COGNITION.

### I5 — Bidirezionalità delle farfalle-eco
Attualmente il pet le nota passivamente. Idea: il pet le **insegue** se IDLE+CURIOSITY<50 (estensione di solo-games.js), la keeper può guardare senza interagire.

### I6 — Interazione sociale fra generazioni
Il pet, durante i sogni, può **"incontrare" il pet precedente dal cimitero** (ci sono già i dati). Mostrare nel sogno un frammento di dialogo col predecessore: rafforza il senso di continuità.

### I7 — Lucida lingua: meta-pagina del lessico
Il lessico attuale mostra parole scoperte. Aggiungerei: **categorie grammaticali** (verbi / nomi / particelle), **esempi di frasi** dove sono state sentite, e un pulsante "pratica": mini-quiz dove il custode deve tradurre una parola. +COGNITION +AFFECTION.

### I8 — Suoni del meteo reale
Quando piove secondo OWM, aggiungere un **layer audio pioggia** (rumore rosa filtrato) che duchsa con la musica ambient. Immersione ulteriore.

### I9 — Log eventi recenti sul status bar
Un pulsante piccolo in alto che apre una **timeline** degli ultimi 20 eventi (evoluzione, scoperta parola, prima pioggia, primo sogno, ecc.) — aiuta il custode a capire cosa è successo mentre non guardava.

### I10 — Modalità "canvas grande" per desktop
Su desktop l'app usa una frazione dello schermo. Aggiungerei una modalità **fullscreen-canvas** per chi gioca su monitor grande: scala il pet proporzionalmente ma la scena diventa immersiva.

---

## 🎯 Prioritizzazione suggerita

| Priority | Item  | Motivo                                                                 |
| :------: | ----- | ---------------------------------------------------------------------- |
| 🔴 alto  | B1    | Bug oggettivo e confonde il player: "sazio" quando affamato            |
| 🔴 alto  | B2    | Bilanciamento narrativo rotto: SECURITY cresce mentre si muore         |
| 🟡 medio | U4    | Opacità dei blocchi di evoluzione                                      |
| 🟡 medio | B3    | Rinomina semantica 'window' → 'crown'                                  |
| 🟡 medio | I2    | Time-lapse cimetrale — forte valore emotivo, scope medio               |
| 🟢 basso | I1    | Customizzazione pod (drag items)                                       |
| 🟢 basso | I6    | Dialogo con pet defunto nei sogni                                      |
| 🟢 basso | I7    | Gamificazione del lessico                                              |
| 🟢 basso | I8    | Audio pioggia (quick win se budget)                                    |

---

## 📦 Dati sessione (diagnostici grezzi)

```
sim-tests            24/24 pass
commands recognized  11/11
shelter hit-test     door@bottom, crown@top, body@middle (all correct)
env hit-test         fireflies/sun/moon/crystals/moths/shooting-stars all reachable
minigames completed  7/7 types (Tetris, PacLali, Korima, Vith, Thi, Shalim, Vythi)
console errors       0
console warnings     0

balance (6h untreated at full rate, start 85 all):
  KORA MOKO MISKA NASHI HEALTH COGN AFF CURI COSM SECY
   0   0    0    0    44    0    21   0   100  100    ← SECURITY still 100 = B2

catch-up floor compliance:
   1h → min=63 · HEALTH=100 ✓
   6h → min=28 · HEALTH=86  ✓
  24h → min=12 · HEALTH=12  (floor respected; see O1)
  72h → min= 0 · HEALTH= 0  (permadeath open ✓)

eat command:
  KORA=85 → accepted, "shi! kora!"          ✓
  KORA=20 → REFUSED with "sazio"            ✗ (B1)
```
