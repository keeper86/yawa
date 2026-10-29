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

Add to `DOMAIN_ERROR_CODES`, `CODE_BY_MESSAGE`, `en.json` and `de.json`:

`conceptNotFound`, `actNotFound`, `lectureNotFound`, `sourceNotFound`, `notOwner`, `lectureNotPublishable`, `relationCycle`, `relationExists`, `invalidBrief`, `actNotReviewable`, `publicationRefused`, `sourceInUse`.

`src/i18n/messages.test.ts` fails if any of them lacks a translation; `src/i18n/domainError.test.ts` should gain a case per new code so `CODE_BY_MESSAGE` cannot rot.

## Behaviour that is easy to get wrong

- **Reviewing an act you do not own** is `notOwner`, even if you can read it. Reading a published act is allowed; judging it is not.
- **Re-reviewing** an accepted act returns it unchanged instead of throwing — the review queue refetches after network flakiness.
- **Rejecting a published act** is `publicationRefused` (invariant 10: nothing published is silently withdrawn).
- **`lecture.setActs`** rejects acts owned by someone else. Foreign acts reach a learner through the concept graph at retrieval time, never through another creator's lecture.
- **`source.remove`** is refused while any act is grounded in it, with `sourceInUse`.

## Acceptance

- [ ] Every procedure has an explicit `.output()` and is covered by at least one happy-path and one authorization test.
- [ ] A non-owner cannot review, publish or reorder; each returns `notOwner`.
- [ ] `concept.link` refuses a cycle and a duplicate with distinct codes.
- [ ] `lecture.publish` with one proposed act fails and leaves `published_at` null on lecture and acts.
- [ ] Deleting a source that grounds an act fails with `sourceInUse`.
- [ ] `npm run test:all` green, including the message catalogue checks.

## Anti-goals

- No bulk endpoints, no GraphQL-style field selection, no pagination beyond a simple cursor.
- No admin role. Ownership is the only authority in the MVP.
- No OpenAPI metadata on these procedures; `/api/public` stays limited to health, logs and user-id.
