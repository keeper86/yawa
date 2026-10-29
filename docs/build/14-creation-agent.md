# 14 — Creation agent

Depends on: 04, 05, 07, 09, 11, 12, 13. Blocks: 18.

## Decision gate

- Still two phases (plan, then acts)? Yes. The plan is a dozen lines that the creator can fix in seconds; the acts are hundreds of lines that are expensive to produce and boring to discard.
- May the creator edit the plan? Yes. The no-edit rule applies to generated act prose, not to a compact outline. Editing the plan is the highest-leverage human action in the system.
- Does the agent ever publish? No. It creates `proposed` acts; acceptance is human (invariant 5).

## Deliverables

```
src/server/agent/jobs.ts        creation job lifecycle
src/server/agent/plan.ts        plan prompt, schema, guardrails
src/server/agent/generate.ts    per-unit act generation, exemplars, grounding
src/server/agent/*.test.ts
migrations/20261029000008_creation_jobs.js
```

## The job

```sql
CREATE TABLE creation_jobs (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    lecture_id          UUID        NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    requested_by_user_id VARCHAR(255) NOT NULL REFERENCES user_data(user_id) ON DELETE CASCADE,
    status              TEXT        NOT NULL DEFAULT 'planning'
                                    CHECK (status IN ('planning', 'plan_ready', 'generating', 'completed', 'failed')),
    plan                JSONB,
    error               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_creation_jobs_lecture ON creation_jobs (lecture_id, created_at DESC);
```

One active job per lecture, enforced in the controller (`lectureNotFound`-style guard: `creationJobActive`).

## Phase 1 — plan

Input to the model: the brief, the lecture's concepts (slug, title, summary), the prerequisite closure at depth 2 (titles only), the catalogue of active templates (key, intent, trigger), and the lecture's source sections as `(sectionId, sourceTitle, heading, first 200 characters)`.

Output schema:

```ts
z.object({
    units: z
        .array(
            z.object({
                conceptSlug: z.string(),
                templateKey: z.string(),
                order: z.number().int().nonnegative(),
                rationale: z.string().max(400),
                sourceSectionIds: z.array(z.string()).max(6),
            }),
        )
        .min(1)
        .max(40),
    proposedPrerequisites: z.array(z.object({ from: z.string(), to: z.string() })).default([]),
});
```

`sourceSectionIds` is the whole point of the plan: the model selects the passages each unit will be built from, so generation receives a bounded, inspectable context instead of "the lecture's sources". Sections are not embedded, so this selection is the only retrieval that happens at creation time.

Guardrails, applied before the plan becomes `plan_ready`:

1. every `conceptSlug` exists in `lecture_concepts`;
2. every `templateKey` is an active template;
3. every `sourceSectionIds` entry belongs to a source in `lecture_sources`;
4. every `mustCover` concept is covered by at least one unit;
5. no unit teaches a `mustAvoid` concept;
6. unit count within the lecture's duration budget (one unit ≈ 10 minutes, ±50%).

A violation fails the job with `planIncomplete` and the violated rule in `error`, rather than silently generating a lecture that misses its own brief. `proposedPrerequisites` become `suggested` relations; a human publishes them.

## Phase 2 — generation

One call per unit. Prompt contains: the brief (audience, objectives for this concept, tone, language), the unit's grounded sections in full, the template's script schema and prompt fragment, its rubric, and **two exemplars** — accepted acts with the same `template_key`, ranked by embedding similarity between the act's embedding and `concept.title + objective.depth`, excluding the unit's own concept.

The exemplar step is why there is no editing: accepted acts are the training signal, and a creator's taste transfers through examples instead of through hand-edited prose.

Output is validated with the template's zod schema, then written as an `act` with `origin='generated'`, `status='proposed'`, `template_version` from the template row, `script_text`/`content_hash` from chunk 12's helpers, `embedding=NULL`, and `act_grounding` rows for the unit's sections. `act_references` gets the concepts named in the plan's rationale that are not the primary one.

## Failure handling

- A unit that fails schema validation twice is recorded in `error` and skipped; the job continues and completes with a count of failures.
- A failed job leaves already-created proposed acts in place. Deleting a creator's partially reviewed queue because the last unit failed is hostile.
- The job never embeds. The lecture page's "finish indexing" action (chunk 12) does that, and the job returns fast enough to be a synchronous mutation with a progress toast.

## Acceptance

## Acceptance

- [x] Plan guardrail tests: missing `mustCover`, missing brief, foreign lecture, active-job collision — each fails with the right domain code and the job is marked `failed`.
- [x] A valid plan is stored with `status='plan_ready'` and generates nothing until `runCreationJob` is called.
- [x] Generation writes one act per unit with correct grounding and `status='proposed'`.
- [ ] The prompt sent for a unit contains exactly two exemplars when two accepted acts of that template exist — **not tested**: the smoke run happened before any accepted act existed, so there was nothing to select. The query is in `generateActDraft` and takes the two most recently accepted acts of the template.
- [ ] Rejecting a unit on the plan screen results in no act for that unit — **deferred to chunk 18**: the plan editor does not exist yet, so there is no rejection path. Deleting a unit from the stored plan before `runCreationJob` already achieves it.
- [x] No test performs a network request, except the explicitly gated smoke test.

## Real run against the model

`AGENT_SMOKE=1 npx vitest --run --config vitest.server.config.ts src/server/agent/smoke.test.ts` runs the whole agent against `deepseek-flash` on the recorded Trapezoidal-rule section. It is skipped without the flag, so CI stays offline.

Result of the first successful run (plan + 2 acts, ~62 s):

```
PLAN  1 unit, template worked-example, rationale: "Prozedurales Verfahren mit hoher
      Elementinteraktion und ohne gesicherte Routine ..." citing the one passage
ACT   "Trapezregel über zwei Intervalle von Hand berechnen"
      setup -> model (Δx und Stützstellen) -> model (Funktionswerte) -> model (Einsetzen)
      -> fade -> fade -> check   (∫₀²x² mit N=2 ergibt 1·(0+1+2)=3, exakt 8/3)
ACT   "Trapezregel für zwei Teilintervalle: Rechnen und Begründen"
      setup -> prompt -> setup -> prompt -> reflect -> check
```

Three defects the run exposed, all fixed:

1. **Truncation.** With the default 4096-token budget the answer was cut off mid-JSON (`finish_reason: length`, 11536 reasoning characters). Generation now asks for 16 000 tokens, and `complete` throws a message naming the token limit instead of letting a truncated string masquerade as invalid JSON.
2. **Invented roles.** The model wrote `role: 'Problemstellung'` because nothing told it which roles are legal. `TemplateDefinition` now carries `roles`, and the generation prompt lists them. The schema was right and unhelpful; the prompt had to say it.
3. **Omitted `success`.** The model returned the criterion as a bare string. `successSchema` accepts either a string or `{criterion}`, normalising to the object — refusing work over the shape of a wrapper is fussiness, not validation.

Also fixed: `chatStructured` used to throw on unparsable JSON without spending its repair attempt. Parse failure and schema failure now both trigger the single repair.

## One quality finding for review

The two acts do not share a register. The worked example addresses the learner formally ("Übernehmen Sie Schritt 1"), the self-explanation uses the informal imperative ("Wähle N=2", "was kauft dir die Festlegung"). The brief said `tone: 'formal'`. So tone adherence is _not_ reliably enforced by a single sentence in the prompt — it is currently a per-act accident. Options: repeat the register with an example sentence, add a `tone` assertion to the review rubric, or accept it as a review concern. Not fixed here, because a wrong guess would hide the problem.

## State after execution

Files: `migrations/20261029000008_creation_jobs.js`, `src/server/agent/{plan,context,generate,jobs}.ts`, `src/server/agent/agent.test.ts` (7 tests), `src/server/agent/smoke.test.ts` (gated), `lecture.{plan,generate,latestJob}` procedures, `planIncomplete` and `creationJobActive` domain codes.

`planLecture` loads and validates the brief, refuses a second active job (also guarded by a partial unique index), calls the model, runs the guardrails, stores the plan, and turns `proposedPrerequisites` into `suggested` relations, skipping any that would create a cycle. `runCreationJob` generates unit by unit, counts failures instead of aborting, and marks the job `completed` or `failed`.

## Anti-goals

- No autonomous act creation outside a job, no "generate more like this" button yet.
- No automatic acceptance, no auto-publish, no self-critique loop before human review.
- No multi-turn agent conversation. Two prompts, two schemas.
