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

Install [docker](https://docs.docker.com/engine/install/). Use Docker Compose v2.

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
npm run infra:up   # db + keycloak + ollama, waits for the embedding model
npm run dev        # app on http://localhost:3000
```

`npm run infra:up` starts the database, Keycloak and Ollama and waits for the embedding model;
`npm run infra:down` stops them.

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

## Text embeddings

Backend callers import the shared module directly; importing it requires no database, authentication,
app startup, or network access:

```ts
import { embedDocument, embedDocuments, embedQuery, embedText, embedTexts } from '@/server/embedding';

const documentVector: number[] = await embedDocument('One chunk');
const documentVectors: number[][] = await embedDocuments(['First chunk', 'Second chunk']);
const questionVector: number[] = await embedQuery('How do I grow tomatoes?');
const rawVector: number[] = await embedText('Unprefixed text');
```

`embedQuery`, `embedDocument` and `embedDocuments` apply EmbeddingGemma's recommended task prompts
(`task: question answering | query: …` and `title: none | text: …`). Retrieval and ingestion should use
them. `embedText` and `embedTexts` send the input unchanged and remain available for diagnostics and
prompt experiments.

`embedTexts` sends at most `EMBEDDING_BATCH_SIZE` (8) inputs per request, sequentially, and returns one
vector per input in input order. An empty array returns an empty array without a request. Ollama's
batch endpoint takes an array, so a 100-chunk document costs 13 requests instead of 100.

The model is fixed to `embeddinggemma:300m`, with the full 768-dimensional output. Production
(`docker-compose.yaml`) and development (`docker-compose.development.yaml`) each define the same Ollama
service; development only adds the published host port. The model tag lives in
`docker/ollama-entrypoint.sh` and `src/server/embedding.ts`.
This release introduced [EmbeddingGemma support](https://github.com/ollama/ollama/releases/tag/v0.11.10).
Inference runs on CPU with no GPU devices assigned.

Ollama is one unit, not a daemon plus a separate initializer: `docker/ollama-entrypoint.sh` starts
`ollama serve`, waits for the daemon, attempts `ollama pull` to refresh the tag and falls back to the
cached model (`ollama show`) when the registry is unavailable. The healthcheck calls the same script
with `--check`, so `service_healthy` means "daemon running and model ready". Containerized apps depend
on that health, and `npm run infra:up` is a single `docker compose up -d --wait` that returns only when
Ollama, the database and Keycloak are healthy.

The first startup requires internet access to pull the image and download the model (approximately
622 MB). Model files persist in the `ollama_data` named volume. Every start attempts `ollama pull` to
refresh the tag and falls back to the cached model when the registry is unavailable, so a warm start
works offline. `docker compose down` retains volumes; avoid `down -v` if you want to retain model and
database data. Startup fails only when neither the registry nor the cache can provide the model.
CI bounds infrastructure startup and model download to 15 minutes.

Development publishes Ollama only on `127.0.0.1:11434`. Without `OLLAMA_BASE_URL` the module falls
back to `http://127.0.0.1:11434` outside production; with `NODE_ENV=production` it throws
`EmbeddingError` instead of silently calling localhost. Production keeps Ollama private on the Compose
network and explicitly sets `OLLAMA_BASE_URL=http://ollama:11434` for the app, overriding a host
development value. Production starts with `docker compose up -d`; development with `npm run infra:up`.

The module sends raw text unchanged to `/api/embed` with `truncate: false` through `embedText` and
`embedTexts`; the role-aware helpers only add the model prompt. It never trims or rejects strings based
on their contents. Non-string input throws `TypeError`. Empty and whitespace-only strings reach Ollama,
but an empty or malformed embedding response is rejected. Over-context input is sent without truncation
so the service can reject it. See the [Ollama embedding API](https://docs.ollama.com/api/embed).

All service, transport, timeout, JSON and vector validation failures throw `EmbeddingError`.
Its `status` holds the HTTP status once headers have arrived (including 200 for an invalid successful
response), otherwise `undefined`. Its standard `cause` retains the original exception, timeout
exception, or HTTP error response body. Invalid vector shapes have no underlying exception, and a
missing production `OLLAMA_BASE_URL` is reported the same way. Messages contain neither submitted text
nor service response bodies; the module never logs input. Treat `cause` as potentially sensitive if
you log it. Each attempt has a fixed 120-second timeout covering connection, model loading, inference
and response-body reading. A batch is all-or-nothing: if any vector is missing, has the wrong
dimension or contains a non-finite value, the whole call rejects. Transport failures, HTTP 429 and 5xx
are retried up to `EMBEDDING_MAX_ATTEMPTS` (3) with a 250/500 ms backoff. HTTP 4xx, invalid
JSON/vectors, missing configuration and timeouts are not retried. Every request sets
`keep_alive: EMBEDDING_KEEP_ALIVE` (30m) so the model stays loaded between calls. There are no fallback
vectors, model substitutions, or model downloads in application code.

After `npm run infra:up`:

```sh
npm run embedding:debug -- "Text to embed"
```

The debugging utility loads `.env` without overriding explicitly supplied environment values, calls
the same module, and prints the vector, model, dimension, norm and elapsed milliseconds; errors produce
a nonzero exit status. An explicitly supplied empty argument is supported. Mocked module tests,
including single and batched requests, run in the server suite's `embedding` project without a
database:

```sh
npm run test:server -- --project embedding
```

### Embedding research

On 2026-11-23, ten technical questions were ranked against ten matching sentences and ten unrelated
sentences (20 candidate chunks, one relevant chunk per question):

| Query form                             | hit@1 | hit@3 |
| -------------------------------------- | ----- | ----- |
| raw `embedText`                        | 7/10  | 9/10  |
| `task: search result \| query: …`      | 10/10 | 10/10 |
| `task: question answering \| query: …` | 10/10 | 10/10 |

Document prompts (`title: none | text: …`) were used for both prefixed runs. The raw miss was "How many
numbers does the embedding model return per text?", which ranked the 768-dimension sentence seventh.
This is why the role-aware helpers exist.

Dilution: a 3,023-character text scored cosine 0.67, 0.45 and 0.57 against its three parts (1,020, 909
and 1,092 characters). A long chunk averages several ideas, so chunking well below the context limit
is justified.

Context: 2,047 repetitions of `hello ` succeed with `truncate: false`; 2,048 fail with HTTP 400. The
Ollama model reports `num_ctx: 2048`, so the ceiling is effectively the full context window. The
2,000-character chunk cap is far below it.

### Runtime verification

Verified on 2026-11-06 and re-verified on 2026-11-23 using the official Ollama 0.11.10 Linux runtime on
CPU (no GPU offload), with the same fixed model as Compose. The full downloaded model manifest digest was
`sha256:85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1` (621,875,917 bytes of model data).
The manual debugging command passed through the shared module.

| Probe                                              | Observed result                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| First download into an empty temporary cache       | Approximately 13.4 seconds (network-dependent)                                                   |
| First embedding after model download               | HTTP 200, one 768-value vector; 959 ms wall time, including 812 ms reported load time            |
| Subsequent unrelated text                          | HTTP 200, one 768-value vector; 217 ms wall time                                                 |
| Empty string                                       | HTTP 200 with `embeddings: []`; the module rejects this as an invalid vector                     |
| Whitespace only (`"   \n\t"`)                      | HTTP 200, one 768-value vector                                                                   |
| 5,000 repetitions of `"hello "`, `truncate: false` | HTTP 400, `{"error":"input length exceeds maximum context length"}`                              |
| Missing model                                      | HTTP 404, error body identifying the missing model and suggesting a pull                         |
| Numeric input sent directly to Ollama              | HTTP 400, `{"error":"invalid input type"}`; module callers are rejected earlier with `TypeError` |

A pull that runs reuses cached layers (approximately 0.81 seconds in this run). Every start attempts
`ollama pull` to refresh the tag; if the registry is unavailable, the entrypoint falls back to the
cached model via `ollama show`, so a warm restart works offline. These are individual observations on
the implementation host, not deployment performance guarantees. Each attempt has a fixed 120-second
timeout and timeouts are not retried. Requests use a 30-minute `keep_alive`, so shorter idle periods do
not pay the cold load again. Review the timeout and keep-alive on deployment hardware. No latency or
RAM budget has been established. Service-side 5xx failures were covered by mocked HTTP tests rather
than induced in the real runtime.

For reproducibility, record the full model digest after initialization (the fixed model tag can be
updated upstream):

```sh
docker compose -f docker-compose.development.yaml exec ollama ollama list
curl --fail http://127.0.0.1:11434/api/tags
```

The development stack runs in CI; validate the production configuration with
`docker compose -f docker-compose.yaml config --quiet` after changing it. Probe edge inputs with the
debugging utility and inspect HTTP statuses/bodies directly with `POST /api/embed` when recording
runtime behavior. Do not delete application or database volumes for embedding checks.
