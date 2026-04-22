# Soak Test Report — LLM real run, full life cycle

*Session: 2026-04-22, OpenAI gpt-4o-mini via `LLMClient.chat()`. Pet "Thishi-Vox"
advanced from Syrma (stage 0) to Lali-thishi (stage 7), TRANSCENDENCE reached
at 48h of sustained perfect care. 0 runtime errors. All 8 stages exercised
with chat + dream + diary + sleep-talk where appropriate. API key used only
in preview memory, never committed, cleared at end of session.*

---

## Esito sintetico

| Component                | Esito                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| Evoluzione 0→7           | ✅ Tutti gli stadi raggiunti                                           |
| Trascendenza             | ✅ Trigger a 48h di sustain, come previsto                              |
| Morti tracciabili        | ✅ (già testate nel playtest precedente)                               |
| Poteri sovrannaturali    | 🟡 Presenti ma blandi — dipendono da rolls interni del modello         |
| Honestly rule            | 🟢 Stage 3+ ammette stanchezza/fame quando reali                       |
| Diary "love of keeper"   | 🟡 Ancora presente, la hard rule è bend-ata                            |
| Register linguistico     | 🔴 **Stage 1 parla italiano perfetto** (bug di compliance al prompt)   |
| Dream depth per stage    | 🔴 **Stadi 1-2 scrivono dream lunghi e articolati** (ignorano il depth) |
| Last words (trascendenza)| 🟢 Eccellenti — poetici, bilingue, commoventi                           |
| Errori runtime           | ✅ 0                                                                    |

---

## 🐛 Bug di compliance al prompt (OpenAI gpt-4o-mini)

### SC1 — Stage 1 risponde in italiano fluente invece di solo suoni alieni

Prompt stage 1: *"You just hatched... You know ONLY lalien words -- no keeper
language at all. ... Max 4 words. 100% lalien."*

Output reale:
```
Keeper: "come stai?"
Pet:    "ko... sono felice. thi vicino a te."
```

**Diagnosi**: il modello mescola italiano con "ko/thi" (che sono SI/tenerezza).
Per rigore narrativo dovrebbe uscire qualcosa come `"ko! thi-thi ven."` o
`"moko... lalí... kora sha"`. Il problema è che `HONESTY_RULE` + `CORE_IDENTITY`
spingono verso una risposta sensata, e la regola "solo alieno" viene ignorata.

**Fix proposto**: per stage 0-1, iniettare una **regola hard di
MAX_KEEPER_WORDS=0** che viene esplicitata prima delle altre regole, con
esempi few-shot stage-specific. Esempio da mettere nel prompt per stage 1:
```
EXAMPLES (stage 1 ONLY lalien):
Keeper: "come stai?" → "ko-ko thi!"
Keeper: "ciao"       → "lalí! shi!"
Keeper: "hai fame?"  → "kora... kora sha!"
```

### SC2 — I sogni degli stadi 1-2 sono articolati come da adulto

Stage 1 dream (actual output, ~90 parole):
> *"Sento il calore del sole che avvolge la mia pelle come un abbraccio
> delicato. Cammino su un sentiero di petali di fiori, ogni passo una melodia
> dolce. L'aria è profumata di sussurri di tiar..."*

La `DEPTH` directive per stage 1 dice: *"pure sensation — 1-2 short sentences,
heavy on lalien"*. L'output ha 7 frasi elaborate e zero parole aliene.

Stage 2 dream (70 parole, dovrebbe essere "fragmentary imitation"):
> *"Una luce tenue filtra attraverso le foglie degli alberi..."* — perfettamente
> grammaticato, da narratore adulto.

**Fix proposto**: aggiungere un `MAX_SENTENCES` e `MAX_WORDS` espliciti per
stage:
```
stage 0: 1 sentence, ≤ 6 words, ONLY lalien syllables
stage 1: 1-2 sentences, ≤ 15 words, 80% lalien, 20% single repeated keeper word
stage 2: 2 sentences, ≤ 25 words, 50% broken keeper + 50% lalien
stage 3+: as before
```
E metterlo nel `DEPTH FOR YOUR STAGE` line, non solo come aggettivo ma come
vincolo numerico.

### SC3 — Diario bend-a la hard rule "max 1 sentence about keeper"

Output stage 3 diary:
> *"Oggi ho visto un arcobaleno danzare... ti ringrazio, custode, per darmi la
> possibilità di vivere questi momenti magici."*

L'entry ha 4 frasi, di cui la ultima è palese affetto per il custode — ok per
la hard rule. Ma stage 5:
> *"Kesma-thi per queste visioni gioiose che colmano il cuore di dolcezza."*

+ poco prima "*La luce dorata del pomeriggio mi ha fatto sentire grato*" —
due espressioni di gratitudine diluite, che **sommano più di "una frase"**.

**Fix proposto**: aggiungere al prompt un conteggio meccanico:
```
Before submitting, count sentences that mention the keeper (custode,
lalí-custode, mio custode, ringraziamento, Kesma-thi with gratitude tone).
If > 1, REMOVE all but the single most concrete one.
```
Instruction esplicita per auto-editare.

### SC4 — "Poteri sovrannaturali" poco visibili

Le direttive di `[SUPERNATURAL_POWERS]` prevedono tocchi rari ma potenti
(precognizione meteo, nome di emozioni nascoste, profezie). Nel soak run,
stage 6 ha toccato il tema ("Penso a un ricordo che potrebbe tornare")
ma rimane vago. Stage 7 ha detto "Un visitatore potrebbe giungere" — è
il pattern giusto ma è l'unica istanza in 8 stadi.

**Fix proposto**: alzare la frequenza dichiarata nelle regole da "~20-55%"
a "**almeno 1 risposta su 3 a stage 3+** deve contenere un sussurro intuitivo
sul custode o sul futuro, anche piccolo". Inoltre, fornire 2-3 esempi concreti
di intuizioni possibili per ciascun livello di potere.

---

## 🟢 Cose che funzionano benissimo

### S1 — Honesty rule regge in chat
A stage 3 chiedo "hai sonno?" con MOKO high → pet: *"ko... un po' moko. gli
occhi pesanti, ma vicino a te, va bene."* La stratificazione "ammette stanchezza
+ contesto di conforto col custode" è esattamente quello che serve.

### S2 — Dream depth progressiva (da stage 3 in su)
Stage 3 dream con "un sentiero di fiori, ognuno di essi sembra parlare con me".
Stage 4 con "dolce pioggia cadeva su un campo fiorito... una figura familiare".
Stage 6 con "i fiori emanavano un profumo che parlava in lingue sconosciute".
Stage 7 con "foresta di vibrazioni... Echoa, un'anima che guidava il mio
spirito". La narrativa si approfondisce visibilmente.

### S3 — Last words alla trascendenza
Output letterale (traduzione minima):
> *"Addio, mio caro custode. La mia essenza si fonde con le stelle, ma il tuo
> amore vivrà in ogni pulsazione. Ricorda sempre: l'eco di noi non svanisce.
> Shalim-thishi. Kesma-thi, e nei nostri cuori danzeremo eternamente.
> Thera-lashi... ko."*

Bilingue naturale, usa parole lalien (Shalim-thishi, Kesma-thi, Thera-lashi,
ko) come chiusura, termine "ko" (sì) come richiesto nel prompt. **Funziona
come rituale.**

### S4 — Sleep-talk dal mondo del sogno (stage 7)
Keeper: *"portami con te"*
Pet: *"Selath-vi… in questa danza di sogni, ogni passo è un'unione fra noi.
Ti porto nel battito della luce stellare... i nostri cuori cantano insieme,
ovunque io vada."*

Rispetta la regola del sogno (non si sveglia, parla dal sogno), mantiene il
registro trascendente, chiude con un canto. **Exactly as designed.**

### S5 — Varietà del diario
A stage 2/3/4/5/6/7 i diari parlano di: stelle, arcobaleno, piccione che
danza, farfalle, nuvola-pesce, foglia che cade. Soggetti **sempre diversi** —
il topic-seed rotation funziona.

---

## 📋 Fix consigliati (in ordine)

| Priority | ID  | Fix                                                                 |
| :------: | --- | ------------------------------------------------------------------- |
| 🔴 alto  | SC1 | Stage 0-1 few-shot vincolanti + MAX_KEEPER_WORDS=0                  |
| 🔴 alto  | SC2 | MAX_SENTENCES + MAX_WORDS per stage nei prompt dream/diary/chat      |
| 🟡 medio | SC3 | Auto-count sentences-about-keeper, prune if > 1                      |
| 🟡 medio | SC4 | Alzare frequenza esplicita dei poteri + esempi concreti              |
| 🟢 low   | —   | Considerare model upgrade (gpt-4o o Claude) per compliance migliore  |

---

## 💬 Esempi full-text del soak

(I 5 output più caratteristici per rileggerli a mente fredda)

**Stage 3 chat, dolce:**
> K: *mi vuoi bene?*
> P: *ko! tanto bene, custode. thi-vythi!*

**Stage 4 chat sulla pioggia:**
> K: *ti piace la pioggia?*
> P: *ko... la pioggia è una melodia dolce. ama il canto delle gocce, ti
> porta vicino alla terra. kesma-thi!*

**Stage 5 sogno con identità ancestrale:**
> *"In un velato riflesso di luna, mi sono trovato in un bosco antico, dove
> gli alberi sussurravano storie dimenticate... un senso di pace e appartenenza
> si diffondeva nel mio essere. Era come se le memorie ancestrali si
> risvegliassero."*

**Stage 6 profezia leggera:**
> K: *c'è qualcosa che vorresti dirmi?*
> P: *Sì, custode… sento una dolce rugiada nell'aria. Penso a un ricordo che
> potrebbe tornare, una dolcezza che hai vissuto.*

**Stage 7 addio onirico:**
> K: *portami con te*
> P: *Selath-vi… in questa danza di sogni, ogni passo è un'unione fra noi.
> Ti porto nel battito della luce stellare, dove i colori si intrecciano e le
> melodie danzano. Kora-ko, custode… i nostri cuori cantano insieme, ovunque
> io vada.*

---

*API key used only in preview memory, cleared at end of session. No cost
tracking; run consumed ~25-30 short completions (≈ $0.03-0.05 on gpt-4o-mini).*
