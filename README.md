# Easy Digital - Gestionale (Monorepo)

Riscrittura completa del gestionale MVP (`manager-app/server.js`) in architettura modulare:
- Frontend: Angular standalone
- Backend: NestJS + Prisma
- DB: PostgreSQL
- Shared package: DTO/validator comuni (`@eda/shared`)

## Struttura

```text
.
├── apps
│   ├── backend
│   │   ├── prisma
│   │   │   ├── migrations
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   ├── scripts
│   │   │   └── migrate-json-to-db.ts
│   │   └── src
│   │       ├── common
│   │       ├── modules
│   │       │   ├── auth
│   │       │   ├── area
│   │       │   ├── billing
│   │       │   ├── customers
│   │       │   ├── debt
│   │       │   ├── imports
│   │       │   ├── invites
│   │       │   ├── jobs
│   │       │   ├── services
│   │       │   ├── subscriptions
│   │       │   └── tickets
│   │       ├── app.module.ts
│   │       └── main.ts
│   └── frontend
│       └── src
│           ├── app
│           │   ├── core
│           │   ├── features
│           │   │   ├── root
│           │   │   ├── auth
│           │   │   ├── area
│           │   │   └── admin
│           │   ├── layouts
│           │   ├── shared
│           │   ├── app.config.ts
│           │   └── app.routes.ts
│           └── styles.css
├── packages
│   └── shared
│       └── src
│           ├── enums.ts
│           ├── schemas.ts
│           └── index.ts
├── docker-compose.yml
├── package.json
└── tsconfig.base.json
```

## Requisiti

- Node 20+
- Docker + Docker Compose

## Environment

Copia `.env.example` in `.env` e configura:

- `DATABASE_URL`
- `JWT_SECRET` oppure `JWT_PUBLIC_KEY`
- `COOKIE_DOMAIN`
- `NODE_ENV`
- `WP_LOGIN_URL`
- `APP_BASE_URL`
- `APP_ORIGIN` (opzionale, default derivato da `APP_BASE_URL`)

Per flusso SSO WordPress -> nuovo backend/frontend:
- `WP_LOGIN_URL` deve puntare all'endpoint WordPress SSO in modalita v2, ad esempio: `https://wp.tuodominio.it/wp-json/eda-auth/v1/sso-start?next=/gestionale&target=v2`
- `APP_BASE_URL` deve essere l'URL pubblico del frontend, ad esempio: `https://manager.tuodominio.it`

## Avvio rapido (Docker)

```bash
docker compose up --build
```

Servizi:
- Backend: `http://localhost:5050`
- Frontend dev: `http://localhost:4200`
- Postgres: `localhost:5432`

Frontend produzione (nginx):

```bash
docker compose --profile prod up --build frontend-prod
```

## Avvio locale

```bash
npm install
cp .env.example .env
npm --workspace @eda/backend run prisma:generate
npm --workspace @eda/backend run prisma:deploy
npm --workspace @eda/backend run prisma:seed
npm --workspace @eda/backend run start:dev
npm --workspace @eda/frontend run start
```

## Migrazioni Prisma

Schema source of truth: `apps/backend/prisma/schema.prisma` (allineato alla specifica con le note compatibilità sotto).

Nota compatibilità Prisma:
- `@db.Numeric` è stato convertito in `@db.Decimal` (equivalente su PostgreSQL).
- Le relazioni polimorfiche di comodità su `DebtItem.sourceId` non sono materializzate come FK Prisma (integrità gestita via codice e `@@unique([sourceType, sourceId])`).

Comandi:

```bash
npm --workspace @eda/backend run prisma:migrate
npm --workspace @eda/backend run prisma:deploy
```

## Seed

Seed minimo richiesto (2 services, 1 customer, 1 job, 1 subscription, 1 debt item):

```bash
npm --workspace @eda/backend run prisma:seed
```

## Migrazione JSON MVP

Importa lo store JSON legacy nel DB PostgreSQL:

```bash
npm --workspace @eda/backend run migrate:json -- /path/to/store.json
```

Default path fallback:
- `manager-app/data/store.json`

## Test

Unit test business rules:
- `syncJobServiceSubscriptions`
- `upsertDebtItemFromJob`
- `applyPayment`

Esegui:

```bash
npm --workspace @eda/backend run test
```

## Route principali frontend

- `/`
- `/logout`
- `/areapersonale`
- `/areapersonale/invito`
- `/gestionale`
- `/gestionale/servizi`
- `/gestionale/importazioni`
- `/gestionale/clienti`
- `/gestionale/clienti/new`
- `/gestionale/clienti/:id`
- `/gestionale/lavori`
- `/gestionale/lavori/new`
- `/gestionale/lavori/:id`
- `/gestionale/rinnovi`
- `/gestionale/abbonamenti/:id`
- `/gestionale/debiti`
- `/gestionale/ticket`

## Auth

- Cookie sessione: `eda_mgr_session` (`httpOnly`)
- `GET /api/me` legge il JWT validato lato backend
- Guard admin su route gestionali (`roles` include `administrator`)
- `POST /api/logout` cancella cookie

### Bridge WordPress (plugin `eda-auth-bridge`)

Per usare il nuovo stack, in `wp-config.php` del sito WordPress imposta:

```php
define('EDA_SSO_SECRET', 'stesso-valore-di-JWT_SECRET-backend');
define('EDA_AUTH_CALLBACK_URL', 'https://api.tuodominio.it/api/auth/callback');
```

Note:
- Il plugin supporta due modalita:
  - default legacy: callback su `/gestionale/auth/callback` o `/areapersonale/auth/callback` del dominio WordPress.
  - v2: se la richiesta include `target=v2`, usa `EDA_AUTH_CALLBACK_URL`.
- Se `target=v2` ma `EDA_AUTH_CALLBACK_URL` non e configurato, la richiesta SSO fallisce con errore.
- `EDA_SSO_SECRET` deve corrispondere al `JWT_SECRET` del backend NestJS.
