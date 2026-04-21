# Lalìen Companion

Un companion AI **permadeath** ispirato al Tamagotchi, pensato come piccolo rituale quotidiano. Un cucciolo alieno schiudersi da un uovo-seme, impara la tua lingua, attraversa 8 stadi di crescita, vive o muore — e lascia un lessico, un diario e una reliquia.

> Ogni Lalìen è unico: DNA, personalità, cibo preferito, momento preferito del giorno. La sua vita è finita; se muore non torna più. Ma il lessico condiviso, il cimitero e le polaroid restano.

Live demo: **[lalien.comesspa.it](https://lalien.comesspa.it)**

---

## Caratteristiche

- **10 bisogni** interdipendenti con accoppiamento emotivo (non puoi essere euforico e apatico insieme)
- **Mente AI autonoma** (Anthropic Claude / OpenAI GPT): il pet fa domande, ricorda, sogna, commenta
- **Meteo reale** via OpenWeatherMap + giorno/notte con alba/tramonto della tua posizione
- **Casetta-rifugio** interattiva — dove il pet si ripara da paura, pioggia, stanchezza
- **7 minigiochi** — Tetris, Pac-Lalì, e 5 synth musicali (arpa pentatonica, theremin a due assi, Orchid-like chord synth, step sequencer, respiro guidato)
- **Drone ambient procedurale** per-stage con chord drift, melodie sparse, contro-melodie, swell di filtro — tutto generato in Web Audio API, zero sample
- **Reliquiario** con 4 collezionabili: sogni LLM, polaroid auto-catturate, pietre della memoria seeded dal DNA, 8 costellazioni lalien con miti
- **Esportazione PDF** del diario e dell'epitaffio come reliquia stampabile
- **Lessico condiviso**: ogni parola aliena scoperta rallenta il decay di COGNITION (saggezza passiva) e dà un burst immediato
- **PWA installabile**, offline-first, cloud sync opzionale via PIN

---

## Installazione

### Requisiti

- Python 3.9+ (per il server e gli script di deploy)
- Un browser moderno (Chrome, Firefox, Safari, Edge)
- Opzionale: chiave API [Anthropic](https://console.anthropic.com/settings/keys) o [OpenAI](https://platform.openai.com/api-keys) per la mente AI del pet
- Opzionale: chiave [OpenWeatherMap](https://openweathermap.org/api) personale (una condivisa è già inclusa nel codice)

### Esecuzione locale

```bash
# clona il repo
git clone https://github.com/luigismith/LAlien.git
cd LAlien

# dipendenze del server
pip install paramiko  # solo se vuoi usare deploy_push.py

# avvia il server locale sulla porta 9080 (HTTP)
python httpd_lalien.py
```

Apri `http://localhost:9080/` nel browser.

Per **HTTPS** (richiesto dalla geolocalizzazione e dalle PWA installabili):

```bash
python setup_https.py   # genera un cert self-signed
python httpd_lalien.py  # serve su :9443 con TLS
```

Accetta il certificato self-signed e apri `https://localhost:9443/`.

### Prima configurazione

1. Crea un **PIN** (4-8 cifre) — serve per rientrare da qualsiasi dispositivo
2. Scegli lingua e provider AI (Anthropic / OpenAI)
3. Incolla la tua chiave API
4. Dai un nome al tuo Lalìen e pianta il seme
5. Dopo 10 minuti + 3 tocchi l'uovo si schiude

La chiave API viene **cifrata con AES-128** prima di essere salvata in IndexedDB — non lascia mai il tuo dispositivo non cifrata.

### Opzionale: meteo reale

Le funzioni meteo sono già attive con una chiave OpenWeatherMap condivisa di free tier. Per usare la tua: **Impostazioni → Meteo reale (OpenWeatherMap)** → incolla la tua chiave.

### Deploy su server remoto (SFTP)

Lo script `deploy_push.py` carica i file su un NAS via SFTP. Configura tramite variabili d'ambiente:

```bash
export NAS_HOST=il-tuo-host.example.com
export NAS_USER=utente
export NAS_PASS='la-tua-password'
python deploy_push.py
```

Nessuna credenziale è hardcoded nei file — tutto legge da env.

---

## Struttura del progetto

```
LAlien/
├── README.md
├── httpd_lalien.py           # Server Python (HTTP + HTTPS + API auth/sync)
├── setup_https.py            # Genera cert self-signed
├── deploy_push.py            # Deploy SFTP (env-driven)
├── restart_server.py         # Helper NAS
├── web/                      # Progressive Web App
│   ├── index.html
│   ├── css/style.css
│   ├── manifest.json
│   ├── sw.js                 # Service worker (offline-first)
│   ├── lang/                 # i18n: it, en, es, fr, de + lessico alieno
│   ├── sprites/              # Sprite pixel-art per stage & variante
│   └── js/
│       ├── engine/           # Game loop, persistenza IndexedDB, cloud sync,
│       │                     # meteo, reliquie, comandi pet, pdf export
│       ├── pet/              # State machine del pet, needs, evoluzione, morte,
│       │                     # attività, autonomia, mente AI, minigiochi, solo games
│       ├── ai/               # Client LLM (Anthropic/OpenAI), STT Whisper,
│       │                     # system prompt dinamico, diary generator
│       ├── ui/               # Renderer canvas, schermate, speech bubble,
│       │                     # status bar, casetta, meteo overlay, gestures
│       ├── i18n/             # Loader traduzioni + gestione lessico alieno
│       ├── audio/            # Sound engine procedurale (Web Audio, 0 sample)
│       └── tools/            # Headless sim-tests (invarianti balance)
├── tools/                    # Script ausiliari (generazione sprite, ecc.)
└── docs/                     # Note di design
```

Nessun bundler, nessun npm. JS vanilla con moduli ES6 nativi.

---

## Come si gioca

Vedi il **Manuale del Custode** integrato nell'app (Impostazioni → Manuale) per la guida completa. In sintesi:

- **Barra alta** (chips): interagisci col pet. Long-press esegue, drag sul pet esegue col gesto.
- **Hotbar inferiore**: trascina oggetti sul pavimento, il pet li userà da solo.
- **Chat testuale** sempre visibile: parla col tuo Lalìen. Riconosce comandi espliciti (salta, dormi, mangia…) e decide se obbedire in base a umore/personalità.
- **Gesti**: tap = poke, striscia = carezza, scrub circolare = pulizia, scuoti il telefono = mini-giochi.
- **Impostazioni**: lingua, chiave AI, meteo, volume, Time multiplier (solo con app aperta — offline il tempo scorre sempre a 1x), tutorial, notifiche push, cimitero, reliquiario, manuale.

---

## Test

Headless simulation harness per verificare invarianti di balance senza dover giocare per ore:

```js
// Da DevTools Console del sito:
(await import('/js/tools/sim-tests.js')).runAllTests()
```

Output colorato con pass/fail per decay a 2h/8h/24h/72h, cura real-time, trascuratezza, accoppiamento emotivo, saggezza passiva del lessico, ecc.

---

## Sicurezza & privacy

- Tutte le chiavi API dell'utente sono cifrate con AES-128 derivata dal PIN prima di essere salvate in IndexedDB locale.
- Il server di cloud sync riceve SOLO il blob cifrato — non ha accesso al contenuto.
- Le conversazioni con l'LLM avvengono in **chiamata diretta dal browser** al provider scelto. Lalìen Companion non fa da proxy.
- Nessun tracking analytics. Nessuna telemetria.
- Il codice non contiene chiavi API private — la chiave OpenWeatherMap condivisa (free tier) è pubblica per comodità; gli utenti possono sovrascriverla con la propria.

---

## Licenza

Progetto personale di **Luigi Massari**. Tutti i diritti riservati. Se vuoi distribuire una versione derivata o esplorare collaborazioni, apri un issue.
