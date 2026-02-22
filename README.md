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
- `content/articles/*.md`: un file per articolo.
- `content/seo/topical-map.csv`: mappa pillar/cluster.
- `content/seo/internal-links.csv`: piano link interni.
- `content/seo/board.csv`: stato editoriale.
- `content/seo/editorial-rules.md`: regole standard per scrittura articoli.
- `content/seo/content-graph.json`: fotografia nodi/collegamenti (generata).
- `content/templates/service-page.html`: template HTML comune per ogni pagina servizio.
- `content/templates/article-page.html`: template HTML comune per ogni articolo.
- `content/templates/services-index.html`: template HTML della pagina madre servizi (non Elementor).
- `scripts/publish-services.sh`: crea/aggiorna pagina madre + pagine figlie.
- `scripts/publish-articles.sh`: crea/aggiorna articoli.
- `scripts/publish-blog-index.sh`: crea/aggiorna pagina hub articoli (la pagina legge i post direttamente da WordPress REST API).
- `scripts/build-content-graph.sh`: genera JSON con relazioni servizi/articoli.
- `scripts/publish-content.sh`: pipeline completa.
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
context_title: Perche investire in questo servizio
context_intro: Intro problema/contesto.
seo_title: SEO Locale Roma per PMI
seo_description: Descrizione SEO sintetica.
focus_keyword: seo locale roma
canonical_url: https://staging.easydigitalagency.it/servizi-digital-agency/seo-locale-roma/
ai_entities: SEO locale, Google Business Profile, web agency roma
ai_prompt: Spiegami questo servizio in italiano.
related_service_slugs: altro-servizio-slug
related_article_slugs: articolo-collegato-slug
inline_links_html: <p><a href="/slug-articolo/">Anchor interna</a></p>
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
DEFAULT_ARTICLE_STATUS=draft
ARTICLE_BASE_PATH=
BLOG_INDEX_SLUG=articoli-e-guide-digitali
BLOG_INDEX_TITLE=Articoli e Guide Digitali
BLOG_INDEX_INTRO=Approfondimenti pratici su SEO, WordPress, performance e crescita online.
BLOG_INDEX_STATUS=publish
BLOG_INDEX_TEMPLATE=elementor_header_footer
SERVICE_PAGE_TEMPLATE=elementor_header_footer
PARENT_PAGE_TEMPLATE=elementor_header_footer
```

### Publish completo (servizi + articoli + graph)

```bash
chmod +x scripts/publish-content.sh
./scripts/publish-content.sh
```

Risultato:

- crea/aggiorna la pagina madre `/servizi-digital-agency/` con layout card snello
- crea/aggiorna pagine figlie sotto `/servizi-digital-agency/<slug>/`
- crea/aggiorna articoli da `content/articles/*.md`
- crea/aggiorna la pagina hub articoli in `/${BLOG_INDEX_SLUG}/` (inclusi anche articoli creati manualmente in WordPress)
- usa un template HTML unico SEO-friendly per ogni servizio
- aggiorna meta SEO Rank Math (title, description, focus keyword, canonical opzionale)
- include JSON-LD strutturato (Organization + WebPage + Service + entita "about")
- genera file utili:
  - `content/services/_generated-cards.html`
  - `content/services/_generated-services-index.html`
  - `content/articles/_generated-blog-index.html`
  - `content/seo/content-graph.json`

Nota: la pagina madre viene gestita dal contenuto WordPress standard (non Elementor). Dopo la prima pubblicazione aggiorna il menu del sito verso `/servizi-digital-agency/`.

## 8) Stato publish da GitHub Actions (attuale)

La pubblicazione automatica via GitHub Actions e disabilitata: il workflow
`.github/workflows/publish-services.yml` non parte piu al `push` su `main`.

Per ora la procedura consigliata e solo manuale da locale:

```bash
cp content/.publish.env.example content/.publish.env
# compila il file con le credenziali WordPress corrette
bash scripts/publish-content.sh
```

In questo modo eviti conflitti tra variabili GitHub e variabili locali (es. slug pagina madre diversi).

### Se vuoi riattivare in futuro il publish automatico

1. Ripristina il trigger `push` nel file `.github/workflows/publish-services.yml`.
2. Verifica che le variabili GitHub (`SERVICES_PARENT_SLUG`, ecc.) siano allineate a `content/.publish.env`.
3. Mantieni solo una sorgente di verita per slug e stati di pubblicazione.

## 9) Demo Gestionale (Plugin WordPress)

Nel repo e inclusa una demo plugin:

- `wp-content/plugins/eda-manager-demo/eda-manager-demo.php`

Funzioni demo incluse:

- Dashboard admin (`EDA Manager`)
- Catalogo servizi (una tantum / annuale)
- Assegnazione servizi ai clienti (utenti WP)
- Elenco rinnovi in scadenza
- Ticket base (admin + cliente)
- Reminder email giornaliero per rinnovi vicini
- Shortcode area cliente: `[eda_client_portal]`
- Shortcode tabella prezzi: `[eda_service_pricing]`

### Installazione rapida su sito esistente

1. Crea zip plugin dalla root repo:

```bash
cd wp-content/plugins
zip -r eda-manager-demo.zip eda-manager-demo
```

2. In WordPress:
   - `Plugin -> Aggiungi nuovo -> Carica plugin`
   - carica `eda-manager-demo.zip`
   - attiva plugin

3. Crea una pagina cliente e inserisci shortcode:

```text
[eda_client_portal]
```

4. (Opzionale) nella pagina servizi o prezzi inserisci:

```text
[eda_service_pricing]
```

### Creazione automatica 2 pagine demo (senza passare dall'admin)

```bash
bash scripts/create-eda-demo-pages.sh
```

Pagine create/aggiornate:

- `/area-cliente-demo/` con shortcode `[eda_client_portal]`
- `/tabella-prezzi-servizi-demo/` con shortcode `[eda_service_pricing]`

Note:
- questa e una base demo, non un CRM completo;
- per produzione conviene aggiungere ruoli/capability dedicate, audit log e notifiche avanzate.

## 10) Gestionale Separato (Docker App) con Login WordPress

Questa repo ora include anche un gestionale separato dal backend WordPress:

- App Docker: `manager-app/`
- Bridge SSO WordPress: `wp-content/plugins/eda-auth-bridge/eda-auth-bridge.php`

Path pubblici previsti:

- `https://<dominio>/gestionale` (admin)
- `https://<dominio>/areapersonale` (cliente)
- `https://<dominio>/areapersonale/registrazione` (registrazione custom)

### Requisiti

1. Variabili `.env`:

```bash
EDA_SSO_SECRET=metti-un-segreto-lungo-e-casuale
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

2. Plugin WordPress da attivare (bridge auth):

- zip folder `wp-content/plugins/eda-auth-bridge`
- carica da `Plugin -> Aggiungi nuovo -> Carica plugin`
- attiva `EDA Auth Bridge`

3. Stack aggiornato:

- `docker-compose.yml` include `manager-app`
- routing Traefik su `/gestionale` e `/areapersonale`
- `WORDPRESS_CONFIG_EXTRA` definisce `EDA_SSO_SECRET` in WP

### Deploy

```bash
docker compose up -d --build manager-app wordpress
```

Se usi Portainer, aggiorna lo stack con il nuovo `docker-compose.yml`.

### Flusso login

1. utente apre `/areapersonale` o `/gestionale`
2. se non autenticato, redirect su endpoint WP `sso-start`
3. WordPress richiede login standard
4. redirect di ritorno all'app con token SSO
5. app crea sessione e mostra dashboard personalizzata

### Funzioni MVP incluse nell'app separata

- Dashboard admin (KPI)
- Gestione servizi
- Assegnazione servizi ai clienti
- Lista rinnovi in scadenza
- Ticket base (admin e cliente)
- Reminder email giornaliero (se SMTP configurato)
