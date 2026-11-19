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

Run the app locally and run infrastructure (Keycloak, database, Ollama) in Docker.

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
docker compose -f docker-compose.development.yaml up -d
# Wait for model initialization and propagate a failed download's exit status.
docker compose -f docker-compose.development.yaml up --no-deps --exit-code-from ollama-init ollama-init
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
npm run test:smoke      # real CPU embeddings; requires initialized Ollama
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

## Text embeddings

Backend callers import the shared module directly; importing it requires no database, authentication,
app startup, or network access:

```ts
import { embedText } from '@/server/embedding';

const vector: number[] = await embedText('A text to embed');
```

The model is fixed to `embeddinggemma:300m`, with the full 768-dimensional output. The official
`ollama/ollama:0.11.10` image is pinned in all three Compose stacks; this release introduced
[EmbeddingGemma support](https://github.com/ollama/ollama/releases/tag/v0.11.10).
Inference runs on CPU with no GPU devices assigned. The first startup requires internet access to
pull the image and download the model (approximately 622 MB). Model files persist in the
`ollama_data` named volume. Later initializations pull the same fixed tag and reuse cached layers;
registry access can still be required to check the manifest. `docker compose down` retains volumes;
avoid `down -v` if you want to retain model and database data.

`ollama list` establishes daemon health only. The `ollama-init` service pulls the model and must exit
successfully before containerized apps and smoke runners start. A failed download prevents those
dependent services from starting. The host-run development app must use the explicit initialization
wait command above. CI bounds infrastructure startup and model initialization to 15 minutes.

Development publishes Ollama only on `127.0.0.1:11434`. The module defaults to
`http://127.0.0.1:11434` when `OLLAMA_BASE_URL` is unset. Production (`docker-compose.yaml`) and local
containerized development (`docker-compose.local.yaml`) keep Ollama private on the Compose network.
They explicitly set `OLLAMA_BASE_URL=http://ollama:11434` for callers, overriding a host development
value. Production starts with `docker compose up -d`; the local stack starts with
`docker compose -f docker-compose.local.yaml up -d --build`.

The module sends the original string unchanged to `/api/embed` with `truncate: false`; it never trims
or rejects strings based on their contents. Non-string input throws `TypeError`. Empty and
whitespace-only strings reach Ollama, but an empty or malformed embedding response is rejected.
Over-context input is sent without truncation so the service can reject it. See the
[Ollama embedding API](https://docs.ollama.com/api/embed).

All service, transport, timeout, JSON and vector validation failures throw `EmbeddingError`.
Its `status` holds the HTTP status once headers have arrived (including 200 for an invalid successful
response), otherwise `undefined`. Its standard `cause` retains the original exception, timeout
exception, or HTTP error response body. Invalid vector shapes have no underlying exception.
Messages contain neither submitted text nor service response bodies; the module never logs input.
Treat `cause` as potentially sensitive if you log it. Requests have a fixed 120-second timeout covering
connection, model loading, inference and response-body reading. This allows headroom over the measured cold request below;
it is not a latency guarantee. There are no retries, fallback vectors, model substitutions, or
model downloads in application code.

After development initialization:

```sh
npm run test:smoke
npm run embedding:debug -- "Text to embed"
```

Both commands load `.env` without overriding explicitly supplied environment values. The smoke suite
uses Node.js, calls the real shared module, and fails if the service/model is unavailable or the
vectors are unusable or indistinguishable. It is excluded from the browser suite and has no database
setup. Mocked module tests run in the server suite's `embedding` project without a database:

```sh
npm run test:server -- --project embedding
```

The separate debugging utility prints the vector, model, dimension, norm and elapsed milliseconds;
errors produce a nonzero exit status. An explicitly supplied empty argument is supported.

An optional Docker runner includes Vitest, TypeScript source and the debugging utility, independently
of the Next.js production image. Building it on a deployment host requires a repository checkout and
access to dependency downloads. No Ollama host port is needed:

```sh
docker compose -f docker-compose.yaml --profile embedding-smoke run --build --rm embedding-smoke
docker compose -f docker-compose.yaml --profile embedding-smoke run --build --rm embedding-smoke npm run embedding:debug -- "Text to embed"
```

Use the same commands with `-f docker-compose.local.yaml` for the local stack. The profile keeps the
runner out of normal application startup.

### Runtime verification

Verified on 2026-11-06 using the official Ollama 0.11.10 Linux runtime on CPU (no GPU offload),
with the same fixed model as Compose. The full downloaded model manifest digest was
`sha256:85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1` (621,875,917 bytes of model data).
The real Vitest smoke suite and manual debugging command passed through the shared module.

| Probe                                              | Observed result                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| First download into an empty temporary cache       | Approximately 13.4 seconds                                                                       |
| First embedding after model download               | HTTP 200, one 768-value vector; 959 ms wall time, including 812 ms reported load time            |
| Subsequent unrelated text                          | HTTP 200, one 768-value vector; 217 ms wall time                                                 |
| Empty string                                       | HTTP 200 with `embeddings: []`; the module rejects this as an invalid vector                     |
| Whitespace only (`"   \n\t"`)                      | HTTP 200, one 768-value vector                                                                   |
| 5,000 repetitions of `"hello "`, `truncate: false` | HTTP 400, `{"error":"input length exceeds maximum context length"}`                              |
| Missing model                                      | HTTP 404, error body identifying the missing model and suggesting a pull                         |
| Numeric input sent directly to Ollama              | HTTP 400, `{"error":"invalid input type"}`; module callers are rejected earlier with `TypeError` |

A repeated pull succeeded using cached layers in approximately 0.81 seconds. The smoke suite also
passed after restarting the standalone daemon with the same cache. A temporary service returning
zero-norm vectors confirmed that a failed smoke assertion exits with status 1. These are individual
observations on the implementation host, not deployment performance guarantees. The fixed 120-second request timeout leaves room for
slower CPU loading; review it on deployment hardware. No latency or RAM budget has been established.
Service-side 5xx failures were covered by mocked HTTP tests rather than induced in the real runtime.

This environment has no Docker daemon. All three Compose configurations validate, but Docker image
builds, fresh/cached named-volume startup and initialization-failure dependency gating still require
verification on a Docker-capable host. The real CPU tests used a temporary standalone Ollama process,
not Compose. No application or database volumes were removed.

For reproducibility, record the full model digest after initialization (the fixed model tag can be
updated upstream):

```sh
docker compose -f docker-compose.development.yaml exec ollama ollama list
curl --fail http://127.0.0.1:11434/api/tags
```

Probe edge inputs using the debugging utility and inspect HTTP statuses/bodies directly with
`POST /api/embed` when recording runtime behavior. Restart with the same volume and repeat the
initialization wait and smoke commands to verify cached startup. Do not delete application or
database volumes for embedding checks. The dedicated smoke suite returns a failing process exit
status on a failed request or assertion.
