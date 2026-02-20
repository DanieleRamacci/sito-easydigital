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
