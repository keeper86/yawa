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

- [ ] Plan guardrail tests: missing `mustCover`, `mustAvoid` violation, unknown section id, unknown template, over-budget unit count — each fails with `planIncomplete` and the right rule in `error`.
- [ ] A valid plan is stored with `status='plan_ready'` and generates nothing until accepted.
- [ ] Generation writes one act per unit with correct grounding and `status='proposed'`.
- [ ] The prompt sent for a unit contains exactly two exemplars when two accepted acts of that template exist, and none when they do not (the fake provider captures prompts).
- [ ] Rejecting a unit on the plan screen results in no act for that unit.
- [ ] No test performs a network request.

## Anti-goals

- No autonomous act creation outside a job, no "generate more like this" button yet.
- No automatic acceptance, no auto-publish, no self-critique loop before human review.
- No multi-turn agent conversation. Two prompts, two schemas.
