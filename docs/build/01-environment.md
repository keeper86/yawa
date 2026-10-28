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

Chat:

```sh
curl -s https://api.deepseek.com/chat/completions \
  -H "Authorization: Bearer $AI_CHAT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-flash","messages":[{"role":"user","content":"ping"}]}'
```

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

Both base URLs include the version prefix; the client appends `/chat/completions` and `/embeddings`. Ollama ignores the API key but requires one to be present.

### 4. Throughput measurement

`tools/bench_embeddings.mjs` (throwaway, excluded from lint, types and formatting): embed 100 synthetic sections of ~250 tokens, in batches of 16, and print sections/second and total wall time. Run it on the machine that will host the app, not on a workstation.

Recorded result:

| Host                       | Model          | Sections/s | Notes |
| -------------------------- | -------------- | ---------- | ----- |
| _fill in during execution_ | embeddinggemma |            |       |

This number decides two things: whether a 5,000-act corpus is a coffee break or an afternoon, and whether `bge-m3` is affordable if quality is insufficient.

## Acceptance

- [ ] Embedding smoke returns `AI_EMBEDDING_DIM` floats.
- [ ] Chat smoke returns a completion.
- [ ] `SELECT extversion` returns `0.7.2` or newer.
- [ ] All three env example files contain the same seven variables.
- [ ] Throughput table filled in.
- [ ] `npm run test:all` still green (nothing should have changed).

## Anti-goals

- No `openai` or `ai` npm package. The client in chunk 11 is plain `fetch`.
- No GPU setup, no model fine-tuning, no reranker yet.
- Do not put the embedder into `docker-compose.yaml` for production until chunk 11 defines the client config; a local-only embedder is acceptable for development.
