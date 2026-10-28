# 16 — Tutor loop

Depends on: 08, 09, 11, 15. Blocks: 17, 18.

## Decision gate

- Does the agent ever _invent_ an act at runtime? No, not in this chunk. Selection only. Synthesis is deferred (see anti-goals) because it is the highest-risk feature in the product and needs its own evaluation.
- Is grading done by the model? Yes, against `script.success.criterion`, with `chatStructured` returning a bounded score. A heuristic grader is a separate chunk if it proves necessary.

## Deliverables

```
src/server/tutor/session.ts    start, next, respond, close
src/server/tutor/diagnose.ts   diagnosis object from learner state
src/server/tutor/mastery.ts    pure update function
src/server/tutor/grade.ts      answer grading against the act's success criterion
src/server/controller/tutor.ts tRPC procedures
src/server/tutor/*.test.ts
```

## Diagnosis

```ts
type Diagnosis = {
    mastery: number;
    confidence: number;
    evidenceCount: number;
    lastSeenDaysAgo: number | null;
    misconception: boolean;
};
```

Built from `learner_concept_state` and the last three evidence rows for the concept. `misconception` is true when the last two outcomes on the same concept are both below 0.4 and the learner's answers were graded as substantively wrong rather than incomplete. One object, one query, no model call — the retrieval policy in chunk 15 consumes it directly.

## The loop

| step                                          | what happens                                        | writes                                                                                                     |
| --------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `start({ goalConceptId?, lectureId?, mode })` | resolve goal concept, create session                | `tutor_sessions`                                                                                           |
| `next(sessionId)`                             | diagnose → retrieve → pick top act → render steps   | agent `turns` row with `content` and `retrieval`                                                           |
| `respond(sessionId, answer)`                  | grade against `success.criterion`, extract evidence | learner `turns` row, agent `turns` row with `outcome`, `learner_evidence`, updated `learner_concept_state` |
| `close(sessionId)`                            | stamp `closed_at`                                   | `tutor_sessions`                                                                                           |

The act's script is rendered into the agent turn as a snapshot — the learner sees the steps, answers, and the next turn reacts. Multi-step scripts are delivered as one agent turn with the steps in order and a single question at the end; this is why scripts are linear and bounded in length.

## Choosing the goal concept

Explicit when the learner picked one. Otherwise `need = (1 - mastery) * (0.3 + 0.7 * confidence)` over concepts that have at least one visible, embedded act, highest first. A concept nobody teaches is not a goal; it is a gap for the creator.

## Mastery update

Pure and unit-tested:

```
n        = evidence_count + 1
alpha    = clamp(0.4 / (1 + 0.3 * (n - 1)), 0.08, 0.4)
mastery' = clamp(mastery + alpha * (outcome - mastery), 0.02, 0.98)
conf'    = 1 - 0.5 ** (n / 3)
```

Three properties the tests must pin: a single outcome never moves mastery more than 0.4; repeated identical outcomes converge without overshooting; `confidence` is monotone in `n` and independent of `outcome` (a wrong answer is still evidence).

Evidence is written in the same transaction as the state update, inserting `learner_evidence` and updating `mastery`, `confidence`, `evidence_count`, `last_evidence_at`.

## Rehearsal

`mode='rehearsal'` is the creator walking their own lecture as a learner before publishing. It runs the identical loop with two differences:

- `learner_concept_state` and `learner_evidence` are **not written**; outcomes stay on the turn;
- the viewer is the creator, so their own `proposed` and `accepted` acts are visible and selectable.

The first creator to try an act is therefore the cheapest possible reviewer, and it costs no new code path — only a write guard.

## Grading

`chatStructured` with the act's success criterion, the learner's answer, and a strict instruction to score evidence, not politeness. Output `{ score: number, reason: string, substantive: boolean }`. On a schema failure after the repair attempt, the turn records `outcome=0.5`, `substantive=false`, and the session continues. A grading failure must never block a learner mid-session.

## Acceptance

- [ ] Mastery properties above are unit-tested directly.
- [ ] `respond` writes one evidence row, one turn and one state update, atomically.
- [ ] A rehearsal session leaves `learner_concept_state` and `learner_evidence` untouched (test asserts row counts).
- [ ] `next` on a session whose goal concept has no visible acts returns a domain error (`noActAvailable`), not an empty turn.
- [ ] The chosen act's id and the retrieval snapshot are on the agent turn.
- [ ] Grading failure still produces a completed turn with `outcome=0.5`.

## Anti-goals

- No act synthesis at runtime. The agent serves what humans accepted; anything else is a later chunk with its own evaluation.
- No multi-act scripts in one turn, no branching dialogue, no free-form chat mode.
- No spaced-repetition scheduler, no streaks, no gamification.
- No streaming. Turns are atomic.
