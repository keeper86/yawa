# Text embedding implementation plan

## Summary

Add a backend module that accepts a text string and returns its embedding as a `number[]`.
Use EmbeddingGemma 1 through Ollama, running on CPU in a Docker container. Use the fixed Ollama model
identifier `embeddinggemma:300m` and its full 768-dimensional output. Do not expose model selection as
an argument or environment variable.

Development and production Compose startup must start Ollama, download the model automatically when
needed, and retain downloaded model files in a named volume. A Vitest-discovered smoke test under
`tests/` and a separate manual debugging script must exercise the same module that application code
will import.

## Phase 1: Verify runtime behavior and settle the error contract

**Files to create:**

- `src/server/embedding.ts` — establish the public signature, fixed model identifier, and expected dimension.

**Work:**

1. Select and pin a concrete official `ollama/ollama` image version compatible with EmbeddingGemma;
   the model requires Ollama 0.11.10 or later. Use the same image version for serving and initialization.
2. Verify the fixed model on CPU using `POST /api/embed`. Confirm one text produces one vector of 768
   finite numbers. Record the downloaded model digest for reproducibility.
3. Probe empty strings, whitespace-only strings, and text beyond the model's context window. Input
   validation in our module must check only that the input is a string; do not trim or reject strings
   based on their contents. Set `truncate: false` so Ollama reports oversized input instead of silently
   changing it.
4. Inspect actual HTTP status codes and error bodies for rejected input, a missing model, and service
   failures. Also handle transport failures, request timeouts, and invalid successful responses.
5. Define a small error contract that preserves the original cause and HTTP status where available.
   Do not invent a catalog of model-specific errors before observing the runtime. Never return a dummy
   vector after a failure or log the submitted text.

**Completion check:** The selected runtime/model combination works on CPU, and observed edge cases
are documented without assuming that every string necessarily produces a usable vector.

## Phase 2: Add Ollama to the Compose stacks

**Files to update:**

- `docker-compose.development.yaml`
- `docker-compose.yaml`
- `docker-compose.local.yaml`
- `.env.example.development`
- `.env.example.production`

**Work:**

1. Add an `ollama` service using the pinned official image. No custom inference Dockerfile is required.
   Use CPU execution with no GPU reservations or device mappings. Persist `/root/.ollama` in a named
   volume and add a daemon health check using a command available in the selected image, such as
   `ollama list`.
2. Add an `ollama-init` one-shot service using the same image. Point its Ollama client at
   `http://ollama:11434`, wait for the daemon health check, and pull `embeddinggemma:300m`. Initialization
   must exit unsuccessfully if downloading fails and must reuse cached model data on later starts.
3. Distinguish daemon health from model readiness. In the production and local containerized stacks,
   make the app depend on successful completion of `ollama-init`. Keep existing database, migration,
   and Keycloak dependencies intact.
4. In development, publish Ollama on `127.0.0.1:11434` so the host-run Node.js app and terminal script can
   reach it. Document a startup command that waits for model initialization before running the module.
5. In production and the local containerized stack, keep Ollama on the Compose network without a
   published host port. Supply `OLLAMA_BASE_URL=http://ollama:11434` explicitly to containerized callers.
6. Add `OLLAMA_BASE_URL=http://127.0.0.1:11434` to the development environment example and the internal
   service URL to the production example. Compose must supply the correct internal URL to the app
   even when the host's `.env` contains the development value.
7. Apply the same service definitions and fixed model consistently across the three existing Compose
   variants. Leave the current databases and their images unchanged.

**Completion checks:** Validate each file with `docker compose -f <file> config --quiet`. Verify a
fresh model volume downloads successfully, a later startup reuses it, and initialization failure
prevents dependent services from starting. Do not remove existing application or database volumes.

## Phase 3: Implement the text-to-vector module

**Files to update:**

- `src/server/embedding.ts`

**Files to create:**

- `src/server/embedding.test.ts`

**Work:**

1. Export `embedText(text: string): Promise<number[]>`. Also check `typeof text === 'string'` at runtime
   so JavaScript callers receive a clear error for invalid input.
2. Read the service address from `OLLAMA_BASE_URL`, with a documented localhost default for development.
   Keep the model fixed in code. Avoid database imports, authentication dependencies, and network calls
   during module import or application build.
3. Use Node.js's built-in `fetch` to call `/api/embed` with the fixed model, the original string, and
   `truncate: false`. Bound the entire request, including response-body reading, with a timeout that
   accommodates CPU model loading. Document the selected timeout after checking a cold request.
4. Validate the response as untrusted data: exactly one embedding, 768 entries, and finite numeric
   components. Return only that vector, without Ollama metadata. Treat an unusable response as an
   error, including an empty embedding result if Ollama returns one for an empty string.
5. Apply the error contract from Phase 1. Do not automatically download models from application code,
   silently retry requests, or substitute another model.
6. Add focused mocked-HTTP tests for the public contract and meaningful failure paths: invalid input,
   connection failure, timeout, HTTP rejection, invalid JSON, and invalid vector shape or values.
   Include the verified handling of empty strings and confirm the request preserves the input.
   Use the existing server test configuration; these tests must not require a running Ollama service.

**Completion check:** The module can be imported by backend code and the terminal script without
starting the app, and returns only a valid vector or a documented error.

## Phase 4: Add a Vitest smoke test and a manual debugging script

**Files to create:**

- `tests/smoke/embedding.test.ts`
- `vitest.smoke.config.ts`
- `tools/embedding_debug.ts`

**Files to update:**

- `package.json`
- `vitest.config.ts`
- `Dockerfile`
- `.dockerignore`
- `docker-compose.yaml`
- `docker-compose.local.yaml`

**Work:**

1. Put the real-model smoke test in `tests/smoke/embedding.test.ts`. Import `src/server/embedding.ts`
   and call the real Ollama service, without mocking the embedding request.
2. Add a dedicated Node.js Vitest configuration that discovers `tests/smoke/**/*.test.ts`. Load `.env`
   while preserving explicitly supplied environment values, enable the repository's TypeScript alias
   resolution, and set a test timeout suitable for CPU model loading. Do not inherit the existing
   database test setup or browser setup: neither is required for embedding inference.
3. Add `npm run test:smoke` as `vitest --run --config vitest.smoke.config.ts`. Exclude `tests/smoke/**`
   from the default jsdom configuration so these tests run only in their intended Node.js suite.
   The existing server configuration already includes only tests under `src/server/`. The smoke suite
   must fail when Ollama or the model is unavailable rather than silently skipping the test.
4. Embed two fixed, unrelated, nonempty texts. Use Vitest assertions to check that each vector has
   exactly 768 finite numeric entries, a nonzero norm, and nonconstant components. Assert that the two
   vectors differ using a small numerical tolerance rather than a semantic similarity threshold.
   A failed assertion or request must produce a failing Vitest run and a nonzero exit code.
5. Separately add `npm run embedding:debug -- "Text to embed"`, using the already-installed `tsx`
   package to run `tools/embedding_debug.ts`. Accept caller-supplied text, load `.env` without overriding
   supplied environment values, and call the same module. Print the vector and useful diagnostics,
   including the model, dimension, norm, and elapsed time. Report errors and exit unsuccessfully on
   failure. This is a manual inspection utility; keep smoke-test assertions in the Vitest test file.
6. Add an independent `embedding-smoke` Docker build target based on the existing dependency stage.
   Copy the module, Vitest smoke test, dedicated Vitest configuration, debug script, and required
   TypeScript configuration into that target. Its default command must run `npm run test:smoke`.
   Keep it separate from the Next.js build and production runtime stages.
7. Update `.dockerignore`, which currently excludes all of `tests/`, to allow the smoke-test directory
   and its parent into the build context while keeping unrelated test artifacts excluded. Verify the
   new Docker target can actually copy every required file.
8. Add a profile-gated `embedding-smoke` service to production and local Compose, building that target,
   using the internal Ollama address, and waiting for successful model initialization. Keep it out of
   normal application startup. This supplies Vitest and the debugging utility without assuming that
   the standalone Next.js image contains source files or test tools.
9. Document that building this optional runner on a deployment host requires the repository checkout
   and dependency-download access. It does not require publishing the Ollama port. Support overriding
   its command to run `npm run embedding:debug -- "Text to embed"` against the same internal service.

**Completion check:** Vitest discovers and runs the smoke test through `npm run test:smoke`, and the
separate debug command accepts arbitrary text. Both work against the development container.
`docker compose -f docker-compose.yaml --profile embedding-smoke run --build --rm embedding-smoke`
runs the Vitest suite against the production Compose service. Overriding its command runs the debug
utility. The analogous commands must work with `docker-compose.local.yaml`.

## Phase 5: Integrate verification and finish documentation

**Files to update:**

- `.github/workflows/website.yml`
- `README.md`

**Work:**

1. Update CI's existing development Compose startup to wait explicitly for `ollama-init` to complete,
   then run `npm run test:smoke`. Use a bounded startup timeout that allows a first model download
   and CPU inference. Preserve the existing failure logs and unconditional Compose cleanup.
2. Keep mocked module tests in the normal server suite. Run the Vitest smoke suite as an explicit
   integration step after Compose initialization, separately from browser unit tests and database
   integration tests. No unit-test invocation should download a model.
3. Document development and production startup, initial internet/download requirements, persistent
   storage, service addresses, the fixed model and dimension, module usage, timeout/error behavior,
   and both the Vitest smoke-test and manual debugging commands. Explain that daemon health alone
   does not establish model readiness.
4. Run formatting checks, lint, TypeScript checking, the existing unit/server suites, and the Next.js
   build. Run the smoke test on CPU through development and production Compose configurations and
   check the local Compose variant for consistency.
5. Verify restart behavior with cached model files and confirm a failed smoke assertion produces a
   nonzero exit code. Report measured startup/inference behavior without promising a latency or RAM
   budget that has not been specified or tested on the deployment hardware.

**Completion check:** Both required environments start with an initialized embedder, the terminal
test passes through the shared module, and another developer can reproduce the result from the README.

## Reference documentation

- [Ollama EmbeddingGemma model and minimum runtime version](https://ollama.com/library/embeddinggemma)
- [Google's EmbeddingGemma 1 model card and dimensions](https://huggingface.co/google/embeddinggemma-300m)
- [Ollama embedding request and response contract](https://docs.ollama.com/api/embed)
- [Ollama HTTP errors](https://docs.ollama.com/api/errors)
- [Ollama CPU-only Docker setup and persistent model storage](https://docs.ollama.com/docker)
