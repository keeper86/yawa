# Yawa

A web application base: Next.js (App Router) + tRPC + next-auth (Keycloak) + Knex/PostgreSQL + next-intl, with a shadcn/ui component library, a guided-tour infrastructure and charting helpers.

## Prerequisites

**Note:** The following setup has been tested on **Ubuntu Linux** and **Windows Subsystem For Linux (WSL)**. Other distributions may require adjustments.

### Node.js and npm

Install [nvm](https://github.com/nvm-sh/nvm) and use it to install the node version specified in `.nvmrc`:

```sh
    nvm install
    nvm use  # only necessary if the auto-switch from .nvmrc is not configured
```

### Docker Setup

Install [docker](https://docs.docker.com/engine/install/)

## Production

### Initial Setup

Copy `.env.example.production` over to `.env` and adapt the variables (see below, do this before "Start" and "Local Development").

A first-time deployment imports a default Keycloak realm and client configuration. To set `rootUrl`, `adminUrl`, `baseUrl`, `redirectUris` and `webOrigins` correctly, generate the initial realm config from the template:

```sh
npm run generate-keycloak-realm
```

The settings can be adapted later in the Keycloak admin UI.

### User sync on startup

On server startup the app reconciles the Keycloak realm's users into the application database (`user_data`), so a valid Keycloak session keeps working after the database is wiped. It authenticates as the `yawa-app` client's **service account**, which needs only the `realm-management → view-users` role — no admin credentials are stored in the app.

Keycloak only imports a realm that does not already exist. On an existing deployment (persistent `keycloak_db_data` volume) enable the service account once:

1. Admin UI → Clients → `yawa-app` → Settings → Capability config → turn on **Service accounts roles** → Save. Keycloak then creates the `service-account-yawa-app` user automatically — do not add a user manually; it is a special, non-login user that is not shown in the Users list.
2. Open the client's **Service account roles** tab → **Assign role** → change the filter to **Filter by clients** → pick `realm-management` → check **`view-users`** → Assign.

Fresh deployments and local development pick this up from the imported realm automatically. The sync only inserts new users and refreshes `email`/`username` for existing ones; app-owned columns such as `display_name` and `avatar` are preserved.

### Start

```sh
docker compose up
docker compose down
```

## Local Development

Run the app locally and run infrastructure (Keycloak, database) in Docker.

### Initial Setup

```sh
cp .env.example.development .env
```

Adapt the variables as needed. The defaults work for most local development scenarios.

### Database

Migrations and type generation use [Knex](https://knexjs.org/).

```sh
npm run db:migrate:latest   # apply migrations
npm run db:seed             # seed development data
npm run db:types:update     # regenerate src/types/db_schemas.ts
```

### Run

```sh
docker compose -f docker-compose.development.yaml up   # db + keycloak
npm run dev                                            # app on http://localhost:3000
```

## Testing

```sh
npm run test:all
```

Runs formatting, linting, type-checking and all tests. The CI pipeline (`.github/workflows/website.yml`) runs on every push and pull request.

```sh
npm run test:unit       # jsdom unit/component tests (vitest)
npm run test:server     # integration tests against a throwaway Postgres (testcontainers)
npm run test:e2e        # Playwright end-to-end tests
```

## Types

This project uses strict TypeScript for all application and API code:

- All routes and navigation are type-safe via the `nextjs-routes` package (see `src/lib/appRoutes.ts`). Add a page or rename a route, then rebuild to regenerate the types.
- API endpoints use Zod schemas for input/output validation and tRPC for end-to-end type safety.

## Project layout

- `src/app` — App Router pages and API routes (`/api/trpc`, `/api/public` OpenAPI, `/api/auth`).
- `src/server` — tRPC root, context, routers and controllers.
- `src/components` — shadcn/ui base components, layout, navigation, tour and client widgets.
- `src/hooks` — reusable client hooks.
- `src/i18n` — next-intl configuration, catalogs and helpers.
- `src/lib` — framework-agnostic helpers (routing, charts, timeline, utils).
