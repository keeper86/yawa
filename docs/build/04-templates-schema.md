# 04 — Templates schema

Depends on: 03. Blocks: 05, 14, 18.

## Decision gate

- Are the five templates below still the starting set? Each one costs a prompt, a zod schema, a rubric and an evaluation. Five measured beats fifteen guessed.
- Does a template change bump `version` (new row) or is the row edited in place? Always a new row: acts freeze `template_version`, so in-place edits would silently change the meaning of existing acts.

## Deliverables

Migration `migrations/20261029000003_templates.js` creating `templates` and inserting the five seed rows with fixed UUIDs. A code registry `src/server/templates/` with one zod schema per `key@version` and a drift test.

## Why a table and not a constant

The template is content the community argues about: which intervention fits which situation, what a reviewer should check, what the script may contain. It is queried (the agent filters by trigger), joined (labels in the graph view) and versioned (acts freeze a version). A TypeScript constant can be read but not referenced by foreign key.

The _validation schema_ stays in code — JSON Schema in a database column would need a validator anyway, and code has the type safety.

## DDL

```sql
CREATE TABLE templates (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    key          TEXT        NOT NULL,
    version      INTEGER     NOT NULL,
    name         TEXT        NOT NULL,
    intent       TEXT        NOT NULL,
    trigger      TEXT        NOT NULL,
    brief_fields TEXT[]      NOT NULL DEFAULT '{}',
    rubric       TEXT[]      NOT NULL DEFAULT '{}',
    status       TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (key, version)
);

CREATE UNIQUE INDEX idx_templates_active_key ON templates (key) WHERE status = 'active';
```

`trigger` is what the selection step in chunk 15 matches against a diagnosis; `brief_fields` names the brief fields the template cannot work without. `rubric` holds **stable criterion codes**, not prose (`grounded-in-source`, `cases-differ-in-one-feature`, …). The review surface maps those codes to English and German labels from the i18n catalogue, because `i18nScan.test.ts` would otherwise be satisfied by a German UI rendering English database strings. Same reason the template's display name is translated in the UI while `name` here is the canonical English one used in prompts and logs.

## Seed rows

Inserted by the migration with fixed UUIDs so tests and dev databases agree.

| key                       | name                               | trigger                                                | literature anchor                                           |
| ------------------------- | ---------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `worked-example`          | Worked example with faded practice | novice, procedural concept, high element interactivity | Sweller (cognitive load); Renkl & Atkinson (faded guidance) |
| `self-explanation`        | Self-explanation prompt            | learner follows steps but cannot justify them          | Chi et al. (self-explanation)                               |
| `contrasting-cases`       | Contrasting cases                  | two confusable concepts or a known misconception       | Schwartz & Bransford (_A time for telling_)                 |
| `predict-observe-explain` | Predict, observe, explain          | intuition likely wrong, observable phenomenon          | White & Gunstone                                            |
| `retrieval-practice`      | Retrieval practice                 | concept previously mastered but not durable            | Roediger & Karpicke (testing effect)                        |

Second tier, only after the first five are measured: refutation text (Posner et al.), productive failure (Kapur), structure-mapping analogy (Gentner), cognitive apprenticeship (Collins & Brown), whole-task sequencing (van Merriënboer), ICAP grading (Chi & Wylie).

## Script schema

Shared shape, one zod schema per template file:

```ts
{
    steps: {
        role: string;
        text: string;
    }
    []; // 3..8 steps, linear
    success: {
        criterion: string;
    }
}
```

Template files narrow `role` and `text` and may add widget parameters. `role` values are template-specific (`setup`, `model`, `ask`, `show`, `fade`, `predict`, `observe`, `explain`, `check`). Anything richer is out of scope (invariant on no branching).

## Registry

```
src/server/templates/
    index.ts              registry: Map<`${key}@${version}`, TemplateDefinition>
    workedExample.ts
    selfExplanation.ts
    contrastingCases.ts
    predictObserveExplain.ts
    retrievalPractice.ts
```

`TemplateDefinition` carries the zod script schema and the prompt fragment used in chunk 14. A test asserts the registry and the active rows agree in both directions: every active row has a definition, every definition has a row. That test is the guard against a template existing only in one of the two places.

## Down migration

Drop `templates`. Acts do not exist yet at this point.

## Acceptance

- [x] Migration up/down/up succeeds; five rows present with `status='active'`.
- [x] `npm run db:types:update` adds `Templates`.
- [x] Registry drift test fails if a row is added without a definition or vice versa.
- [x] Each zod schema rejects a script with a missing `success.criterion` and a script with more than 8 steps.
- [x] A second row with the same `key` and `status='active'` is rejected by the partial unique index.

## State after execution

Files: `migrations/20261029000003_templates.js` (table plus five seed rows with fixed ids `00000000-0000-4000-8000-00000000000N`), `src/server/templates/{types,script,workedExample,selfExplanation,contrastingCases,predictObserveExplain,retrievalPractice,index}.ts`, `src/server/templates/templates.test.ts` (8 tests), `templateStatusSchema` in `src/types/enums.ts`, `templates` in `TABLES`.

`tests/vitest/enumConstraint.ts` now holds `constraintEnumValues(table, column)`, reading `pg_get_constraintdef` for `${table}_${column}_check`. Two enums use it already (`sources.kind`, `templates.status`); every later CHECK constraint should reuse it rather than copy the query.

Registry shape: `templateDefinitions` is the authority in code, `templateId(key, version)` builds `key@version`, and `getTemplateDefinition` / `getActiveDefinition` look it up. The drift test compares code against `status='active'` rows in both directions and also compares `name`, so a rename on one side fails.

Script shape: `baseScriptSchema` is `{ steps[3..8] of {role, text}, success: { criterion } }` with `text ≤ 1200` and `criterion ≤ 400` characters. `scriptSchemaWithRoles([...])` narrows the role union per template. Verified behaviour: missing success → reject, 1 step → reject, 9 steps → reject, `observe` on `worked-example` → reject.

Domain note worth recording: the five templates were written for a numerics corpus without special-casing. `predict-observe-explain` is the one whose trigger the corpus has to earn — it fires only when a consequence is _observable_, and in numerics that means an error curve, a convergence table or a blow-up, not a proof. If chunk 17 shows it never fires, it is retired by inserting a later version, not by deleting the row.

## Anti-goals

- No template authoring UI yet; templates arrive by migration until the community flow exists.
- No template marketplace, no per-lecture template overrides.
- Do not model template inheritance or composition.
