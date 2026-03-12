# EDA Manager Flask (HTMX + PostgreSQL)

Versione organizzata per produzione del gestionale, portata da `manager-app/server.js` a Flask.
Modello dati allineato a: `manager-app/docs/postgres-schema-v1.sql`.

## Stack

- Flask + Blueprints
- SQLAlchemy + Flask-Migrate
- PostgreSQL (default consigliato in produzione)
- HTMX lato UI tabellare
- SSO WordPress via JWT (`/gestionale/auth/callback`)

## Struttura

- `eda_manager/config.py`: configurazione ambiente
- `eda_manager/models.py`: schema dati
- `eda_manager/views/web.py`: route HTTP
- `eda_manager/services/query.py`: logica query/dashboard
- `eda_manager/importer.py`: import legacy da `store.json`
- `wsgi.py`: entrypoint WSGI per gunicorn

## Prerequisiti

- Python 3.9+
- PostgreSQL 14+

## Configurazione ambiente

Esempio variabili:

```bash
export SECRET_KEY='change-me'
export DATABASE_URL='postgresql+psycopg://eda_user:eda_pass@localhost:5432/eda_manager'
export WP_BASE_URL='https://www.easydigitalagency.it'
export EDA_SSO_SECRET='same-secret-used-by-wordpress-plugin'
export SESSION_COOKIE='eda_mgr_session'
export COOKIE_SECURE='false'
export DATA_DIR='./data'
```

Nota: se usi `postgres://...` o `postgresql://...`, viene convertito automaticamente nel driver `postgresql+psycopg://...`.

## Setup locale

```bash
cd manager-flask
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Inizializzazione DB

```bash
export FLASK_APP=app.py
flask init-db
```

`flask init-db` crea tutte le tabelle SQLAlchemy allineate allo schema v1.

## Import dati dal vecchio store.json (opzionale)

Se vuoi migrare i dati dal gestionale Node:

```bash
export DATA_DIR='../manager-app/data'
flask import-store
flask sync-debts
```

## Avvio sviluppo

```bash
PORT=5051 FLASK_DEBUG=true python app.py
```

Apri: `http://localhost:5051/gestionale`

## Avvio produzione (gunicorn)

```bash
cd manager-flask
source .venv/bin/activate
gunicorn -w 3 -b 0.0.0.0:5051 wsgi:app
```

## Endpoint principali

- `GET /health`
- `GET /gestionale`
- `GET /gestionale/clienti`
- `GET /gestionale/lavori`
- `GET /gestionale/debiti`
- `GET /gestionale/ticket`

## Stato funzionalità

La base attuale copre dashboard e aree operative principali già usate in `server.js` (clienti/lavori/debiti/ticket) con autenticazione WordPress.  
Le sezioni avanzate legacy (es. importazioni multi-file, areapersonale completa, rinnovi dettagliati, CRUD completo entità) possono essere aggiunte nel passo successivo mantenendo questo schema.
