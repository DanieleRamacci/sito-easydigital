# sito-easydigital

Scaffold Docker per pubblicare WordPress su Hetzner con Traefik e deploy via GHCR.

## 1) Crea la nuova repository

Opzione consigliata: copia il contenuto di questa cartella in una nuova repo dedicata.

Struttura attesa nella nuova repo:

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `.github/workflows/ghcr.yml`

## 2) GitHub Actions -> GHCR

Il workflow `ghcr.yml` fa build e push automatico su `ghcr.io/<owner>/<repo>:latest` ad ogni push su `main`.

Requisiti:

- Repo su GitHub.
- GitHub Packages abilitato.
- Workflow permissions: `Read and write permissions` (Settings -> Actions -> General).

## 3) Configurazione sul server Hetzner

Sul server:

```bash
mkdir -p /opt/sito-easydigital
cd /opt/sito-easydigital
# clona qui la repo nuova
cp .env.example .env
```

Aggiorna `.env` con valori reali:

- `WP_DOMAIN`
- credenziali DB
- `GHCR_OWNER`
- `GHCR_IMAGE`

Login a GHCR dal server:

```bash
docker login ghcr.io -u <github-username>
```

Deploy:

```bash
docker compose pull
docker compose up -d
```

## 4) Dominio e HTTPS

- DNS: record `A` del dominio verso IP Hetzner.
- Traefik deve gia avere entrypoints `web`/`websecure` e certresolver `myresolver`.
- La rete Docker `gruppo_proxy` deve esistere sul server.

## 5) Migrazione da cPanel

- Esporta DB WordPress da phpMyAdmin in `.sql`.
- Copia `wp-content`.
- Import DB nel container MariaDB:

```bash
docker exec -i easydigital-db mysql -u wp_user -p'PASSWORD' wordpress < backup.sql
```

- Ripristina `wp-content` dentro il volume `wp_data`.

## 6) Prefisso Tabelle (obbligatorio)

Questo progetto usa un dump con prefisso tabelle custom (`fmf5SsoeG_`).

Nel file `.env` deve essere presente:

```bash
WORDPRESS_TABLE_PREFIX=fmf5SsoeG_
```

Se il prefisso e errato, WordPress mostra la procedura di installazione guidata.

## 7) Content-As-Code per pagine servizi

Questa repo include uno scaffold per creare e aggiornare pagine servizio via API WordPress:

- `content/services/*.md`: un file per servizio.
- `content/templates/service-page.html`: template HTML comune per ogni pagina servizio.
- `content/templates/services-index.html`: template HTML della pagina madre servizi (non Elementor).
- `scripts/publish-services.sh`: crea/aggiorna pagina madre + pagine figlie.
- `content/.publish.env.example`: configurazione API.

### Formato file servizio

Esempio (`content/services/seo-locale.md`):

```md
slug: seo-locale-roma
title: SEO Locale Roma
card_title: SEO Locale
excerpt: Descrizione breve card e introduzione pagina.
service_class: eda-gestione-annuale
badge_label: Servizio continuativo
cta_primary_text: Richiedi un preventivo
cta_primary_url: /contatti
hero_services_title: Servizi inclusi
service_included_list: <div class="eda-service-item"><div class="eda-service-item-left"><span class="eda-service-bullet"></span><span class="eda-service-label">Gestione WordPress</span></div><span class="eda-service-tag">Core</span></div>
seo_title: SEO Locale Roma per PMI
seo_description: Descrizione SEO sintetica.
ai_prompt: Spiegami questo servizio in italiano.
status: draft

<section>
  <h2>Titolo sezione</h2>
  <p>Contenuto HTML della pagina servizio.</p>
</section>
```

### Setup API key (Application Password)

Sul sito WordPress (utente admin):

1. Vai su `Utenti` -> `Profilo`.
2. Sezione `Application Passwords`.
3. Crea una nuova password applicazione (es: `codex-publisher`).
4. Copia la password generata.

Poi crea il file locale:

```bash
cp content/.publish.env.example content/.publish.env
```

Compila:

```bash
WP_BASE_URL=https://staging.easydigitalagency.it
WP_USERNAME=<utente-admin-wordpress>
WP_APP_PASSWORD=<application-password>
SERVICES_PARENT_SLUG=servizi-digital-agency
SERVICES_PARENT_TITLE=I Servizi Web Agency Digital a Roma
SERVICES_PARENT_INTRO=Scopri i servizi digitali pensati per far crescere il tuo business online.
DEFAULT_PAGE_STATUS=draft
PARENT_PAGE_STATUS=publish
```

### Publish pagine servizi

```bash
chmod +x scripts/publish-services.sh
./scripts/publish-services.sh
```

Risultato:

- crea/aggiorna la pagina madre `/servizi-digital-agency/` con layout card snello
- crea/aggiorna pagine figlie sotto `/servizi-digital-agency/<slug>/`
- usa un template HTML unico SEO-friendly per ogni servizio
- genera file card/link pronto da incollare nella pagina madre:
  - `content/services/_generated-cards.html`
  - `content/services/_generated-services-index.html`

Nota: la pagina madre viene gestita dal contenuto WordPress standard (non Elementor). Dopo la prima pubblicazione aggiorna il menu del sito verso `/servizi-digital-agency/`.

## 8) Publish automatico al push

Workflow incluso: `.github/workflows/publish-services.yml`

Quando fai push su `main` con modifiche in `content/services` o template/script:

1. parte il workflow,
2. esegue `scripts/publish-services.sh`,
3. aggiorna pagina madre + pagine servizi su WordPress via API.

### Secrets GitHub necessari

In `Settings -> Secrets and variables -> Actions -> Secrets`:

- `WP_BASE_URL` (es: `https://staging.easydigitalagency.it`)
- `WP_USERNAME`
- `WP_APP_PASSWORD`

### Variables GitHub opzionali

In `Settings -> Secrets and variables -> Actions -> Variables`:

- `SERVICES_PARENT_SLUG`
- `SERVICES_PARENT_TITLE`
- `SERVICES_PARENT_INTRO`
- `DEFAULT_PAGE_STATUS`
- `PARENT_PAGE_STATUS`
