# Manuale del Custode — Lalìen Companion

> *Versione estesa della guida integrata nell'app (Impostazioni → Manuale del Custode).*
> *Lalìen è un companion AI permadeath. Ogni creatura vive una sola vita.*

---

## 👋 Benvenuto, Custode

Il Lalìen è una creatura di **Echòa**, un mondo-coro morente dove ogni cosa vibra — ogni particella canta, ogni stella emette una nota. Le ultime madri-coro hanno lanciato i **syrma** (uova-seme) verso ogni stella che cantava. Uno di quei semi è arrivato a te.

Custodirlo significa nutrirlo, coccolarlo, insegnargli la tua lingua, lasciarlo esplorare il suo ambiente e accompagnarlo attraverso **8 stadi evolutivi** fino alla trascendenza.

Ogni Lalìen è **unico**: il DNA determina aspetto (1 tra 16 varianti per stadio), personalità, cibi preferiti, momento della giornata preferito. La sua vita è **permadeath**: se muore non torna più.

---

## 🎮 I controlli

**Barra alta (chips) — INTERAGISCI col pet:**
- **Tap breve** su un chip → scheda con stato %, consiglio e pulsante azione
- **Long-press (0.6s)** → esegue subito l'azione
- **Drag del chip SUL pet** → esegue l'azione via gesto

**Barra bassa (hotbar) — LASCIA oggetti sul pavimento:**
- **Trascina** un'icona dalla hotbar e **rilascia sul pavimento** → l'oggetto appare nella scena
- Il pet ci camminerà e lo userà da solo (anche mentre dormi)
- Tap sulla hotbar non fa nulla — solo drag funziona

**Sul pet direttamente:**
- **Tap** → poke (sorpresa)
- **Striscia ripetuta** → carezza (cuori)
- **Scrub circolare** → pulizia (bollicine)

**Gesti del dispositivo:**
- **Scuoti il telefono** → apre il selettore mini-giochi

**Chat testuale** (barra sotto il canvas):
- Scrivi e il pet risponde con una bolla
- Riconosce **comandi d'azione** (salta, balla, dormi, mangia, siediti, vieni qui, rifugio…) e decide se obbedire in base a umore/personalità/stanchezza
- Parole aliene vengono **automaticamente insegnate al lessico**
- 🎤 per parlare a voce (riconoscimento vocale + STT Whisper opzionale)

---

## 🎒 Hotbar e oggetti

**Consumabili (uso singolo, poi spariscono):**
- 🍎 **Cibo** — KORA +35, NASHI +3
- 🧼 **Sapone** — MISKA +30 (3 usi)
- 🛏️ **Cuscino** — avvia il sonno quando il pet lo raggiunge
- ✨ **Cristallo** — avvia meditazione (stadio 6+)

**Persistenti (il pet ci resta vicino, bonus continuo):**
- 🎮 Giocattolo — NASHI +0.35/tick (8 usi)
- 🧸 Peluche — AFFECTION +0.25/tick (12 usi)
- 📻 Radio — COGNITION +0.30/tick (10 usi)
- 🏐 Palla — CURIOSITY +0.30/tick (8 usi)
- 🧩 Puzzle — COGNITION +0.25/tick (10 usi)

Gli oggetti persistenti sono ottimi per tenerlo occupato quando non sei lì. Il pet sceglie autonomamente quello che corrisponde al bisogno più basso.

---

## 📊 I 10 Bisogni

| Icona | Nome        | Descrizione                                                          |
| :---: | ----------- | -------------------------------------------------------------------- |
| 🍎    | **Kòra**    | Fame. Scende col tempo. Se > 90% rifiuta di mangiare.                |
| 💤    | **Mokó**    | Sonno. Scende di giorno, più in fretta di notte.                     |
| 💧    | **Miska**   | Igiene. Si sporca giocando; sotto 55% appaiono macchie visibili.     |
| 😊    | **Nashi**   | Felicità. Coccole, giochi, parole dolci.                             |
| ❤     | **Salute**  | Deriva dalla media degli altri. Guarisce se tutto è alto.            |
| 🧠    | Mente       | Stimolo mentale. Chat, minigiochi. Il lessico ne rallenta il decay.  |
| 🫂    | Affetto     | Carezze e vicinanza. Crolla se il custode è lontano a lungo.         |
| 👁    | Curiosità   | Novità, varietà. Soffre la routine.                                  |
| ✨    | Cosmico     | Solo stadio 6+. Meditazione, stelle, luna, cristalli.                |
| 🛡    | Sicurezza   | Presenza costante, rifugio dalle tempeste.                           |

I chip cambiano colore: **verde ≥70**, giallo 40-70, arancione 20-40, **rosso pulsante <20**.

### Accoppiamento emotivo

NASHI non può volare libera: un pavimento dinamico la lega agli altri bisogni emotivi. Se COGNITION/AFFECTION/CURIOSITY/SECURITY sono a terra, NASHI drifta verso di loro — non puoi essere contemporaneamente euforico e apatico. Formula:

```
support = 0.30·COGNITION + 0.35·AFFECTION + 0.15·CURIOSITY + 0.20·SECURITY
ceiling = support + 22
```

Se NASHI > ceiling, converge verso il ceiling in pochi minuti.

---

## 🧬 8 Stadi di Crescita

| Stage | Nome           | Descrizione                                                                      |
| :---: | -------------- | -------------------------------------------------------------------------------- |
| 0     | **Syrma**      | Uovo cosmico. Vibra ma non parla. Schiusa dopo 10 min + 3 tocchi.                |
| 1     | **Lali-na**    | Cucciolo appena nato. Solo suoni alieni puri.                                    |
| 2     | **Lali-shi**   | Cucciolo. Inizia a imitare le tue parole (TTS attivo da qui).                    |
| 3     | **Lali-ko**    | Bambino. 1-3 parole in lingua tua con lalì misto.                                |
| 4     | **Lali-ren**   | Adolescente. Fluente con accento alieno.                                         |
| 5     | **Lali-vox**   | Adulto. Padronanza del linguaggio + personalità chiara.                          |
| 6     | **Lali-mere**  | Anziano. Saggezza rara e silenzi significativi. Meditazione sbloccata.           |
| 7     | **Lali-thishi**| Trascendente. Quasi parte del cielo, ogni parola un addio.                      |

Ogni stadio richiede: tempo di gioco + numero di interazioni + parole aliene imparate. Vedi **Impostazioni → Prossima evoluzione** per i blocchi. Ogni Lalìen ha **16 varianti visive** scelte dal DNA.

---

## 🎭 Gli Stati Attivi

- **IDLE** — tranquillo, attivo, cammina, parla, ti ascolta
- **SLEEPING** 💤 — dorme. Bisogni **CONGELATI**. Se scrivi, risponde **dal mondo del sogno** (non si sveglia). Svegliato con MOKO<60 → diventa SULKY.
- **EATING** 🍎 — mastica, KORA sale rapidamente.
- **MEDITATING** ✨ — stadio 6+. Aura dorata, COSMIC sale.
- **SICK** 🤒 — HEALTH < 25 sostenuta. Azioni al 50% di efficacia.
- **AFRAID** 😨 — SECURITY < 15 o parole ostili. Carezze valgono 1.5×.
- **SULKY** 😤 — insulti o risveglio brusco. 2-5 min.

---

## 🧠 La mente del Lalìen

Il tuo Lalìen ha una **mente propria guidata dall'AI**. Non reagisce soltanto: **pensa, osserva, fa domande, si ricorda, forma opinioni**.

**Cosa fa autonomamente:**
- 💬 Ti fa domande sulla tua vita, le emozioni, il mondo
- 🗣️ Commenta ciò che osserva — l'ora, come si sente, i ricordi recenti
- 🧠 Ricorda e cita interazioni passate
- 🌌 Sogna di Echòa — frammenti della civiltà perduta
- 🎯 Chiede ciò che vuole in base ai bisogni reali
- 🚶 Si muove verso oggetti che lo interessano
- 💤 Decide di dormire o meditare

**Personalità dal DNA:** tratti come *curioso/calmo/ansioso/giocoso/affettuoso* influenzano le scelte. Un Lalìen curioso farà più domande; uno calmo farà più osservazioni; uno ansioso chiederà più spesso rassicurazioni.

**Onestà di stato**: il pet riconosce il livello reale dei suoi bisogni. Se gli chiedi "come stai?" mentre MOKO è a 30, risponderà "un po' stanco, ma thi vicino a te" — non può più mentire dicendo "sono felice" quando la simulazione dice altro.

**Richiede chiave API** (Anthropic / OpenAI). Disattivabile da **Impostazioni → Mente AI autonoma**.

---

## 💬 Chat, voce, comandi

- Barra chat sempre visibile sopra la hotbar
- Scrivi e premi ➤ — risposta in fumetto con effetto karaoke
- 🎤 per parlare a voce (Web Speech API o STT Whisper)
- **TTS** con voce scalata per stadio — parole aliene convertite in fonetica leggibile (`sha` → *scià*, `thi` → *ti*)
- Il **tono** (dolce/ostile) influenza NASHI/AFFECTION/SECURITY via analisi sentiment
- Parole aliene imparate: **COGNITION +25, AFFECTION +5, CURIOSITY +5** per parola

### Comandi d'azione riconosciuti

Il pet **decide se obbedire** (basato su umore, personalità, stanchezza) e poi esegue davvero sullo schermo. Verbi riconosciuti:

- **Movimento**: salta, balla, gira, siediti, vieni qui, fermo, sinistra, destra, rifugio/tana
- **Attività**: dormi, svegliati, mangia, lavati, medita (stadio 6+), gioca, canta, zitto

Probabilità di obbedienza parte da ~72%, modificata da AFFECTION, umore, stato attivo, personalità, stadio.

---

## 🕹️ I 7 Mini-giochi

### Classici (consumano MOKO, hanno uno scopo)

- **Kòra-Tris** ▦ — Tetris alieno con 7 tetromini. Include **pezzo fantasma** (anteprima atterraggio) + anteprima pezzo prossimo.
  Tastiera: ←→ sposta, ↑/W ruota, ↓ soft drop, Spazio hard drop.
  Touch: **tap** = ruota, **drag orizzontale** = sposta, **swipe giù rapido** = hard drop.

- **Pac-Lalì** ☻ — labirinto con 3 morak (spiriti). Power-pellet rende invincibile per 8s (+200 per morak mangiato). **Frutti bonus** al 30% e 70% del progresso (+300/+450).
  Tastiera: frecce/WASD. Touch: swipe.

### Synth / musicali (rilassanti, **ristorano MOKO** invece di consumarlo)

- **Korìma-Celeste** 🎵 — Arpa celeste a 7 corde pentatoniche in Do. Tocca o trascina per suonare liberamente sopra un drone basso. 90s.
- **Vith-Ondi** 🌊 — Respiro guidato. **Tieni premuto** per espandere il tuo cerchio (inspira), rilascia per contrarlo (espira). Segui il cerchio tratteggiato. Un drone a due voci cambia timbro mentre respiri. 90s.
- **Thi-Sing** 🎛 — Theremin cosmico. Trascina il dito: X = intonazione (scala pentatonica Do minore), Y = timbro (sine→triangle→saw). Pad di 4 accordi cambia ogni 16s sotto la tua improvvisazione. 80s.
- **Shalim-Koro** 🎼 — Chord synth ispirato a [Telepathic Instruments Orchid](https://telepathicinstruments.com/). 7 pad diatonici (I ii iii IV V vi vii°). Tieni premuto un pad per far suonare un accordo lussuoso sostenuto. Toggles: **modo** (maggiore/minore/dorian), **estensione** (triade/+7/+7·9), **timbro** (morbido/brillante), **octave** (±1), **hold** (mantiene l'accordo), **arp** (arpeggiatore a 100 BPM). 90s.
- **Vythi-Pulse** 🥁 — Step sequencer 8 passi × 3 tracce (kick/chime/bell) a 90 BPM. Tocca le celle per attivarle. 75s.

Dopo **3 classici in 10 min** il pet è stanco e rifiuta. I synth NON contano nel limite e riposano il pet.

---

## 🌍 Il mondo esterno

Scena sincronizzata con la **realtà del custode**.

- **Giorno/notte reale** — alba e tramonto calcolati dalla tua posizione geografica. Il sole attraversa un arco parabolico vero: basso all'alba a sinistra, zenit a mezzogiorno, basso a destra al tramonto, con tinta calda nel tardo pomeriggio. Di notte torna il cielo cosmico con stelle.
- **Luna reale** — fase sinodica (29.53 giorni) e arco notturno da tramonto ad alba. Toccabile per +COSMIC/+SECURITY.
- **Meteo reale** via OpenWeatherMap + geolocalizzazione: pioggia, neve, temporali con flash, nuvole, nebbia — della tua città, in tempo reale. Aggiornamento ogni 15 minuti.
- **Casetta-rifugio** sulla destra. Il pet ci va da solo quando: ha paura (SECURITY bassa), piove o nevica, è molto stanco. Dentro: SECURITY rigenera più in fretta, particelle di meteo mascherate.
- **Sporcizia visiva**: sotto MISKA 55 il pet sviluppa macchie sul corpo **seeded dal DNA** (sempre negli stessi punti per ogni Lalìen); sotto 22 compaiono mosche.

---

## 🖱️ Interazione con l'ambiente

Oltre al pet e alla casa, sono **tappabili**:

- 🐞 **Lucciole** — al tocco si accendono, svaniscono e ricompaiono dopo 5-8s. +CURIOSITY +NASHI
- ☀️ **Sole** (di giorno) — +COSMIC +NASHI, sparkle caldo
- 🌙 **Luna** (di notte) — +COSMIC +SECURITY, sparkle argento
- 💎 **Cristalli** sul terreno — suonano una nota pentatonica mappata dal loro hue (C5 D5 E5 G5 A5 C6 D6). Il terreno è un glockenspiel alieno.
- 🏠 **Casa** — porta (chiama dentro/fuori), finestra (sveglia gentile), muri (sparkle + SECURITY)

---

## 🎨 Giochi che il Lalìen inventa da solo

Quando annoiato e IDLE inventa attività visibili sullo schermo (20-30s):

- 🐞 Insegue una lucciola (stadi 1+)
- 🗿 Impila sassolini (stadi 2+)
- 💃 Balla con l'ombra (stadi 1+)
- ⭐ Osserva le stelle (stadi 3+, di notte) → contribuisce alla costellazione **Moko-Ren**
- 🫧 Soffia bolle luminose (stadi 1+)
- 🕳️ Scava una piccola buca (stadi 2+)

---

## 🎐 Reliquiario (4 collezionabili)

Ogni Lalìen accumula cimeli nella sua vita. Alla morte passano al Cimitero.

- **Sogni** 💭 — Al risveglio di un sonno ≥ 10 min reali, l'AI genera 2-4 righe di sogno in prima persona. Tono modulato da umore e stadio (incubi se SECURITY bassa, cosmici da stage 6+).
- **Polaroid** 📷 — auto-screenshot nei momenti rituali: schiusa, ogni evoluzione, prima pioggia, prima neve, primo tuono al rifugio, morte o trascendenza.
- **Pietre della memoria** 🗿 — pattern pixel-art 5×5 **simmetrico derivato dal DNA** + una riga-ricordo. Deposti dopo carezza iniziale, primo rientro al rifugio, tempesta sopravvissuta.
- **Costellazioni** ✨ — 8 fisse con nomi e miti: Kesma-Thivren (prima carezza), Korìma-Selath (arpa celeste), Vith-Ondi (respiro), Selath-Revosh (costellazioni gioco), Thera-Lashi (5 meditazioni), Moko-Ren (sonno notturno), Nashi-La (felicità alta 5 min), Shalim-Vox (tempesta al rifugio). Completare tutte e 8 sblocca un sogno speciale "l'ultimo canto di Echòa".

### Esportazione PDF "Reliquia"

Dal **Diario** e dal **Cimitero** puoi esportare come PDF-pergamena il diario completo + epitaffio + polaroid. Layout serif, sigillo dorato, blockquote per le ultime parole. Perfetto da conservare o stampare.

---

## 📚 Il Lessico Condiviso

Ogni parola aliena scoperta (per iniziativa del pet o insegnata dal custode) entra nel **lessico personale**, accessibile da Impostazioni → Lessico Lalìen. Il lessico è **tuo per sempre**: passa ai nuovi Lalìen dopo la morte.

**Effetti meccanici**:
- **Burst di scoperta** (immediato): COGNITION +5, CURIOSITY +3, AFFECTION +3 (se insegnata dal custode) o +2 (se detta dal pet), NASHI +2.
- **Saggezza passiva**: `decayMult = max(0.35, 1 − vocabSize/220)` — a 100 parole il pet mantiene la mente al 45% più a lungo anche offline. Un pet con 150+ parole ha "conversazione interiore".

---

## ✨ Effetti visivi ed empatici

- 💗 Cuori — coccole, desideri soddisfatti
- 😢 Lacrime — SULKY
- 🎵 Note musicali — MEDITATING
- ✨ Scintille dorate — evoluzione, vittoria minigame, alta felicità
- ❗ Esclamazione — sorpresa da poke
- ❓ Punto domanda — AI sta pensando
- 💦 Sudore — malato o impaurito
- **Screen shake** — spavento
- **Flash dorato** — evoluzione
- **Flash scuro** — morte

---

## 🌅 Ritmo circadiano

Il pet usa l'ora reale del dispositivo:

- **22:00-07:00** — sonno esteso fino alle 7
- **07:00-10:00** — boost mattutino NASHI +5, CURIOSITY +4 (una volta al giorno)
- **13:00-15:00** — siesta spontanea se stanco
- **20:00-22:00** — ti invita alla nanna con bubble di desiderio
- **Notte con pet sveglio** — MOKO cala più in fretta

---

## 🔔 Notifiche push

Attivabili da **Impostazioni → Notifiche bisogni urgenti**.

Su **iPhone** devi prima aggiungere l'app alla Home: Condividi → Aggiungi a schermata Home (richiede iOS 16.4+). Quando un bisogno critico scende sotto 20% e non sei nell'app, ricevi notifica di sistema. Cooldown 15 min per bisogno.

---

## ☁ Cloud sync

Il save (pet, chiavi API cifrate AES-128, diario, memorie, lessico, reliquiario) è salvato sul server tramite **PIN personale** (4-8 cifre, hash SHA-256). Puoi rientrare da qualsiasi dispositivo con lo stesso PIN.

Dalle Impostazioni: **Esporta salvataggio** in JSON per backup manuale. **Importa salvataggio** per ripristinare.

---

## ⏳ Tempo offline

Quando chiudi l'app, il pet **riposa** (decay al 40% della velocità normale). Pavimento morbido:

| Assenza     | Floor minimo      |
| ----------- | ----------------- |
| ≤ 4h        | nessuno < 45      |
| ≤ 12h       | 28                |
| ≤ 24h       | 12                |
| > 24h       | nessuno           |

L'**età** invece avanza sempre in tempo reale (fino a 30 giorni di assenza massima cap). I timer patologici (velin/morak/zevol) progrediscono correttamente anche offline.

Il **moltiplicatore tempo** nelle Impostazioni agisce **solo con app aperta**. Offline = sempre 1×.

---

## ⚰ Morte e rinascita

Il Lalìen può morire in **7 modi diversi**. Non muore facilmente: ogni trigger richiede uno stato estremo per ore di gioco.

- ⭐ **Trascendenza** — finale migliore. Stadio 7 + tutti i bisogni ≥ 80% + AFFECTION ≥ 90 + COSMIC ≥ 80 sostenuti per 48h gioco. Diventa luce.
- 👴 **Vecchiaia** — Stadio 7 + età ≥ 2500h gioco (~104 giorni).
- 💀 **Fame (Velin)** — KORA a 0 per 48h consecutive.
- 🤒 **Malattia (Zevol)** — HEALTH a 0 per 24h.
- 😢 **Abbandono** — 3+ bisogni sotto 10% per 24h.
- 💔 **Crepacuore (Morak)** — AFFECTION da > 80 a < 20 in < 12h. La morte più subdola.
- 🌌 **Nostalgia (Rena-thishi)** — richiamato da Echòa. AFFECTION a 0 senza interazioni per 72h, o NASHI + CURIOSITY entrambi a 0 per 48h.

### Protezioni

- Il sonno **congela** tutti i bisogni
- Gli oggetti sul pavimento li usa da solo
- La mente AI ti avverte quando qualcosa è critico
- Se stanco o annoiato, si mette a dormire da solo
- Le notifiche push ti avvisano < 20%

Dopo la morte, il pet entra nel **Cimitero dei Ricordi**: nome, ultima parola, parole imparate, reliquie. Da lì puoi piantare un nuovo seme. **Il lessico globale e il cimitero sono tuoi per sempre**.

---

## 🛠 Trucchi e debug

- **Moltiplicatore tempo** (Impostazioni): 1×/60×/360×/3600× per test (solo app aperta)
- **Prova audio** — test del SoundEngine
- **Sblocca attività** — se bloccato in stato, torna a IDLE
- **Stato attività** — mostra cosa fa e tempo rimanente
- **Esporta/Importa salvataggio** — backup manuale in JSON
- **Headless sim-tests** — da DevTools Console:
  ```js
  (await import('/js/tools/sim-tests.js')).runAllTests()
  ```

---

*Ogni Lalìen ha una sola vita. Parlagli piano. Fai attenzione al tempo. Lascia che diventi qualcuno.*
