# 01 — Environment and AI smoke test

Depends on: nothing. Blocks: 04 (embedding dimension), 11, 12, 13.

## Decision gate

- Is the embedding model still `embeddinggemma` (768) or has `bge-m3` (1024) won on quality grounds? The chosen dimension is written into the migration in 05 and is expensive to change later.
- Is the chat provider still DeepSeek? Its API is OpenAI-compatible at `https://api.deepseek.com` and offers **no embeddings endpoint** — chat and embeddings are always separate providers.
- Is Ollama reachable from the app container (Docker networking) or only from the host?

## Deliverables

1. A running embedder with the model pulled.
2. Three successful smoke checks: embeddings, chat, pgvector.
3. `AI_*` variables in all three env example files.
4. A measured number for embedding throughput under CPU-only load, recorded in this document.

## Work

### 1. Embedder

```sh
docker run -d --name yawa-embedder -p 11434:11434 \
  --memory=2g -e OLLAMA_KEEP_ALIVE=5m \
  -v ollama:/root/.ollama ollama/ollama
docker exec yawa-embedder ollama pull embeddinggemma
```

`OLLAMA_KEEP_ALIVE=5m` matters: without it the model stays resident and competes with Postgres and Keycloak on a small VPS.

### 2. Smoke checks

Embedding must return exactly the dimension written into the schema later:

```sh
curl -s http://localhost:11434/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"embeddinggemma","input":["Die Ableitung ist die Steigung der Tangente."]}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["data"][0]["embedding"]))'
```

Chat — first list the models, because the model id is a hardcoded assumption everywhere else:

```sh
set -a && . ./.env && set +a
curl -s https://api.deepseek.com/models -H "Authorization: Bearer $AI_CHAT_API_KEY" | head -c 400
curl -s https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $AI_CHAT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$AI_CHAT_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Sag pong\"}],\"max_tokens\":500}"
```

`deepseek-flash` resolves to `DeepSeek-V4.1-Flash` with a 1 048 576-token context window and 393 216 max output tokens. It is a **reasoning** model: `content` arrives next to `reasoning_content`, and reasoning tokens are billed. What that means for the client is written down in [11-ai-client.md](11-ai-client.md), together with the failure mode it creates — a too-small `max_tokens` returns `content: ""` with `finish_reason: "length"`, which is an empty act if nobody checks.

Vector extension — pgvector 0.7.2 is present in `timescale/timescaledb:2.17.2-pg15`; only the extension needs enabling:

```sh
docker compose -f docker-compose.development.yaml up -d db
docker exec -it yawa-dev-db psql -U postgres -d yawadb \
  -c 'CREATE EXTENSION IF NOT EXISTS vector;' \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
```

### 3. Environment variables

Add to `.env.example.development`, `.env.example.production` and `.env.smoke`:

```
AI_CHAT_BASE_URL=https://api.deepseek.com
AI_CHAT_API_KEY=
AI_CHAT_MODEL=deepseek-flash

AI_EMBEDDING_BASE_URL=http://localhost:11434/v1
AI_EMBEDDING_API_KEY=ollama
AI_EMBEDDING_MODEL=embeddinggemma
AI_EMBEDDING_DIM=768
```

Both base URLs include the version prefix; the client appends `/chat/completions` and `/embeddings`. Ollama ignores the API key but requires one to be present. Development uses `localhost` because the app runs on the host; the production and smoke examples use `http://ollama:11434/v1`, which presumes an `ollama` service in `docker-compose.yaml` — added in chunk 11, not before.

### 4. Throughput measurement

`tools/bench_embeddings.mjs` (throwaway, excluded from lint, types and formatting — verified: eslint reports `File ignored because of a matching ignore pattern`, `tsconfig.json` excludes `./tools`, `.prettierignore` lists `/tools`).

It embeds 100 synthetic sections of 12 sentences (973 characters ≈ 250 tokens) in batch sizes 8, 16 and 32, after a warm-up call that loads the model. Run it on hardware that resembles the target: the development machine has 20 cores, so the embedder runs with `--cpus=4 --memory=2g` to approximate the 8 GB / 4 vCPU deployment. An unconstrained run would say nothing about capacity.

Recorded result (Ollama 0.40.12, `embeddinggemma:latest`, 621 MB model, 4 vCPU / 2 GB):

| batch | requests | sections/s | p50 ms | p95 ms |
| ----- | -------- | ---------- | ------ | ------ |
| 8     | 13       | **2.30**   | 3399   | 3882   |
| 16    | 7        | 2.13       | 7222   | 7964   |
| 32    | 4        | 1.72       | 18551  | 19871  |

**Batch size 8 wins and throughput falls with larger batches**, so chunk 12 uses 8 rather than the 16 originally planned. Per-section cost at 32 is 0.58 s against 0.42 s at 8.

What that means, without rounding in our favour:

- **138 sections/minute, not the 200–400 assumed while planning.** That number was wrong by a factor of two.
- A 60-act lecture embeds in ~26 s: fine for a synchronous "finish indexing" action, too slow to hide inside an ordinary mutation. Chunk 12 keeps its `limit` parameter for that reason.
- A 5,000-act corpus is ~36 minutes of CPU: acceptable as a one-off, impossible per request.
- Vectors come back L2-normalised (norm 1.000000, verified), so cosine and inner product agree and `vector_cosine_ops` is the right index opclass.

## Verified during execution

| check                                                    | result                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CREATE EXTENSION vector` on the dev database            | success, `extversion 0.7.2`                                                                                                                 |
| extensions after migrating                               | `pg_trgm 1.6`, `plpgsql 1.0`, `timescaledb 2.17.2`, `unaccent 1.1`, `vector 0.7.2`                                                          |
| `immutable_unaccent`                                     | present from `20260925000001_messages.js`, no redefinition needed                                                                           |
| embedding smoke                                          | 2 inputs → 2 vectors, `dim 768`, `norm 1.0`, order preserved, `usage.prompt_tokens` reported                                                |
| chat reachability                                        | `POST https://api.deepseek.com/chat/completions` without a key → `401 Authentication Fails (governor)` in 0.36 s; URL and auth path correct |
| chat round-trip                                          | `deepseek-flash` → `DeepSeek-V4.1-Flash`, `finish_reason: stop`, German answer, 387 reasoning chars, 148 completion tokens                  |
| json mode                                                | `response_format: {"type":"json_object"}` → `{"ok":true,"note":"Erledigt."}`, no markdown fences, parses directly                           |
| reasoning effort                                         | `reasoning_effort: "low"` accepted with 200 and visibly shorter reasoning                                                                   |
| `npm run db:migrate:latest` against the compose database | 3 migrations, batch 1                                                                                                                       |

## Acceptance

- [x] Embedding smoke returns `AI_EMBEDDING_DIM` floats (768, norm 1.0).
- [x] Chat smoke returns a completion (`deepseek-flash`, German prose, `finish_reason: stop`).
- [x] `SELECT extversion` returns `0.7.2` or newer.
- [x] All three env example files contain the same seven variables.
- [x] Throughput table filled in, and chunk 12 corrected to batch size 8.
- [x] `npm run test:all` green.

## Anti-goals

- No `openai` or `ai` npm package. The client in chunk 11 is plain `fetch`.
- No GPU setup, no model fine-tuning, no reranker yet.
- Do not put the embedder into `docker-compose.yaml` for production until chunk 11 defines the client config; a local-only embedder is acceptable for development.
