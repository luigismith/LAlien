# Lalìen Companion

Un companion AI permadeath ispirato al Tamagotchi. Un cucciolo alieno che impara la tua lingua, evolve attraverso 8 stadi, e alla fine muore o trascende — lasciando un'eredità linguistica nel suo diario.

## Versione Web (attiva)

Progressive Web App vanilla JS — nessun bundler, nessuna dipendenza frontend.

### Quick Start

1. Avvia il server NAS (QNAP a `192.168.1.80`):
   ```bash
   python httpd_lalien.py
   ```
2. Apri `https://192.168.1.80:9443/` dal browser (o accetta il cert self-signed)
3. Crea un account con PIN → il tuo Lalìen sta per schiudersi

### Deploy

```bash
python deploy_push.py   # SFTP verso NAS
```

### Struttura Web

```
web/
  index.html               # PWA entry point
  css/style.css            # Tema dark mediterraneo
  js/
    engine/                # Game loop, persistenza, cloud sync, eventi
    pet/                   # Pet state machine, needs, evolution, death
    ai/                    # LLM client, STT, system prompt, diary
    ui/                    # Renderer canvas, screens, status bar, tutorial
    i18n/                  # Internazionalizzazione (it/en/es/fr/de)
    audio/                 # Sound engine (Web Audio API procedurale)
```

### Server NAS

`httpd_lalien.py` — Python server (HTTP:9080 / HTTPS:9443)
- `POST /api/auth` — login con PIN
- `GET/POST /api/data` — salvataggio cloud per account
- `GET /api/status` — health check

## Licenza

Progetto personale di Luigi Massari. Tutti i diritti riservati.
