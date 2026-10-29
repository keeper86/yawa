# 10 — Content controllers

Depends on: 02–09. Blocks: 12, 13, 14, 18.

## Decision gate

- Are the review mutations (`acceptAct`, `rejectAct`) separate procedures or one `reviewAct({ actId, decision })`? One procedure with a decision enum: it keeps the rubric-driven UI a single round trip and one cache invalidation.
- Does `publishAct` remain separate from acceptance? Yes. Acceptance is a judgement, publication is a visibility decision; merging them makes it impossible to accept a batch and publish a lecture atomically.

## Deliverables

```
src/server/controller/concept.ts        concept CRUD and search
src/server/graph/relations.ts           link/unlink with cycle guard (query from chunk 06)
src/server/controller/source.ts         add text source, list, delete
src/server/controller/act.ts            list, get, review, publish
src/server/controller/lecture.ts        create, brief, scope, ordering, publish
src/server/access.ts                    visibility and ownership predicates
```

Plus domain error codes, English and German strings, and one `*.test.ts` per controller.

## Shared access helpers

Every visibility question is answered here, nowhere else:

```ts
export const visibleActFilter = (viewerUserId: string) => ({
    clause: '(acts.published_at IS NOT NULL OR acts.owner_user_id = ?)',
    bindings: [viewerUserId],
});

export const isActVisible = (act: { published_at: Date | null; owner_user_id: string }, viewerUserId: string) =>
    act.published_at !== null || act.owner_user_id === viewerUserId;
```

Concepts are readable by everyone. Lectures are visible when published or owned. Sources follow the same rule as lectures. If a controller needs a second predicate, that is a signal that the model is wrong, not that a new predicate is needed.

## Procedures

Each has `.input()` and `.output()`; all are `protectedProcedure` (PAT access is not enough for authoring).

| Procedure                      | Input                                    | Notes                                                                                                                      |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `concept.resolve`              | title, language                          | creates or returns, never throws on duplicate                                                                              |
| `concept.search`               | query, language, limit                   | trigram plus exact match, returns id, title, wikidataQid                                                                   |
| `concept.get`                  | conceptId                                | includes relations and act counts                                                                                          |
| `concept.link`                 | sourceId, targetId, type                 | cycle guard for `requires`, canonical order for `contrasts_with`                                                           |
| `concept.unlink`               | relationId                               | refused if the relation is referenced by nothing but still `published`? no — allowed, records `rejected` instead of delete |
| `source.addText`               | lectureId, title, text, language         | splits into sections on blank-line-plus-heading heuristic, dedupe by hash                                                  |
| `source.list`                  | lectureId                                |                                                                                                                            |
| `source.remove`                | sourceId                                 | refused while `act_grounding` references its sections                                                                      |
| `act.list`                     | lectureId or conceptId, status, cursor   | the review queue's data source                                                                                             |
| `act.get`                      | actId                                    | includes grounding sections and rubric                                                                                     |
| `act.review`                   | actId, decision `accepted` \| `rejected` | sets `reviewed_by_user_id`, `reviewed_at`                                                                                  |
| `act.publish`                  | actId                                    | guard: `status='accepted'`, grounding present for generated                                                                |
| `lecture.create`               | title, language                          | owner from context                                                                                                         |
| `lecture.updateBrief`          | lectureId, brief                         | validates against the brief schema                                                                                         |
| `lecture.setScope`             | lectureId, conceptIds, sourceIds         | replaces scope in one transaction                                                                                          |
| `lecture.setActs`              | lectureId, actIds in order               | refuses acts the creator does not own                                                                                      |
| `lecture.publish`              | lectureId                                | publication gate from chunk 07                                                                                             |
| `lecture.list` / `lecture.get` | filters / id                             |                                                                                                                            |

Mutating procedures return the updated row, not a boolean, so the review UI can patch its cache without a refetch.

## Domain errors

The mechanism, decided while executing: services throw `DomainFailure(code, message, params)` from `src/server/domainError.ts`. One middleware in `trpcRoot` converts it into a `TRPCError` with the domain packet, so no procedure needs a `try`/`catch` and no message string is ever pattern-matched to guess a code. `CODE_BY_MESSAGE` stays only for the handful of legacy messages that predate this.

Codes added to `DOMAIN_ERROR_CODES`, `en.json` and `de.json`: `conceptNotFound`, `sourceNotFound`, `actNotFound`, `lectureNotFound`, `notOwner`, `relationCycle`, `invalidBrief`, `lectureNotPublishable`, `sourceInUse`, `publicationRefused`.

Two planned codes were dropped:

- **`relationExists`** — linking an existing edge is idempotent and returns `created: false` (chunk 06). A code for a non-error would be dead weight.
- **`actNotReviewable`** — a published act already answers with `publicationRefused`, and an accepted act re-reviewed as accepted is a no-op. One code, one meaning.

`src/i18n/messages.test.ts` fails if a code lacks a translation.

## Behaviour that is easy to get wrong

- **Reviewing an act you do not own** is `notOwner`, even if you can read it. Reading a published act is allowed; judging it is not.
- **Re-reviewing** an accepted act returns it unchanged instead of throwing — the review queue refetches after network flakiness.
- **Rejecting a published act** is `publicationRefused` (invariant 10: nothing published is silently withdrawn).
- **`lecture.setActs`** rejects acts owned by someone else. Foreign acts reach a learner through the concept graph at retrieval time, never through another creator's lecture.
- **`source.remove`** is refused while any act is grounded in it, with `sourceInUse`.

## Acceptance

- [x] Every procedure has an explicit `.output()` and is covered by at least one happy-path and one authorization test.
- [x] A non-owner cannot review, publish or reorder; each returns `notOwner`.
- [x] `concept.link` refuses a cycle with `relationCycle`; a duplicate link is idempotent and reports `created: false`.
- [x] `lecture.publish` with one proposed act fails and leaves `published_at` null on lecture and acts.
- [x] Deleting a source that grounds an act fails with `sourceInUse`.
- [x] `npm run test:all` green, including the message catalogue checks.

## State after execution

Files: `src/server/access.ts`, `src/server/controller/{concept,source,act,lecture}.ts`, `src/server/controller/content.test.ts` (11 integration tests), `src/lib/sourceText.ts` + 7 unit tests, router wiring, ten domain codes with English and German strings.

18 procedures are live: `concept.{resolve,search,get,link,unlink}`, `source.{addText,list,remove}`, `act.{list,get,review,publish}`, `lecture.{create,list,get,updateBrief,setScope,setActs,publish}`.

Deviations from the plan, all narrowing:

- **`act.review` instead of `acceptAct`/`rejectAct`** — one procedure with a decision enum, as the decision gate suggested. Re-reviewing an accepted act as accepted returns it unchanged instead of throwing, so a flaky refetch does not surface an error.
- **`concept.unlink` records `rejected`, never deletes.** A tombstone stops the creation agent proposing the same edge again.
- **`lecture.setActs` validates ownership of every act** before touching the table, so a partially applied order is impossible.
- **`source.addText` is idempotent per text.** The same text in the same lecture reuses the source and does not duplicate sections; the external id is `paste:<sha256>`.

Not done, deliberately: no `domainError.test.ts` case per code. The existing test guards `CODE_BY_MESSAGE`; the new codes reach the wire through `DomainFailure`, and the integration test asserts the codes themselves, which is the stronger check.

Two traps hit while building this, both worth remembering:

1. **A `DomainFailure` thrown inside a resolver is not a `TRPCError`.** The error formatter shapes HTTP responses, so it cannot fix what a direct caller sees; the fix belongs in a middleware. That is why `procedure` now wraps `trpcRoot.procedure`.
2. **Five test failures came from my own fixture**, not the code: `insertAct` created a concept of its own, so a lecture whose `mustCover` named a different concept was correctly refused. The gate was right both times this happened today.

## Anti-goals

- No bulk endpoints, no GraphQL-style field selection, no pagination beyond a simple cursor.
- No admin role. Ownership is the only authority in the MVP.
- No OpenAPI metadata on these procedures; `/api/public` stays limited to health, logs and user-id.
