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

The agent turn carries a **performance** of the act, not the act itself: an ordered list of typed moves that the tutor writes for this learner (see below). The moves are stored on the turn, so a session replays without calling the model again.

## Performance

Act scripts are notes for the tutor. `setup`, `model`, `fade` and `check` say what the tutor should do — "Begruende die Ordnung zwei ueber den ersten nicht verschwindenden Term der Taylorreihe" is an instruction, not a question a learner can answer. Rendering the steps verbatim put the rubric on the screen, explained nothing, and asked for an answer the learner had no way to give.

So the act is performed. `performAct` (`src/server/tutor/perform.ts`) turns the notes into moves:

```ts
{ kind: 'explain'; text }                       prose for the learner
{ kind: 'example'; title; steps: string[] }     a worked example
{ kind: 'ask'; question; hint; expects }        the one question, always last
{ kind: 'feedback'; verdict; text }             the reaction to an answer
```

`src/lib/lesson.ts` owns the schema (`lessonSchema` requires exactly one `ask`, and it must be last) and the pure fallbacks. The prompt receives the act notes, the concept, the concept's language and the diagnosis, and is told to rewrite, never quote: the first moves establish the situation, the ask must be answerable from what was just said, and the rubric must not appear.

Grading stays before the model speaks. `respondToAct` scores the answer against `script.success.criterion` read from the act, then `reactToAnswer` writes feedback plus, below 0.6, one explanation that repairs exactly what the answer got wrong. The model never decides the score, so a fluent answer cannot talk its way to mastery.

The performance call needs a real budget: `effort: 'high'` with 16 000 tokens. At 2 000 the reasoning alone consumed the limit, the client aborted on `finish_reason: length`, and the fallback reproduced the exact symptom the performance layer exists to remove — the act's notes on screen. Anything that wraps `performAct` must keep that headroom.

Both steps fail open: a broken or unreachable provider yields `fallbackMoves` (the act's steps as explain/example plus the `check` step as the ask) or a single feedback move carrying the grader's reason. A learner is never blocked mid-session by the model.

What is deliberately not here yet: the tutor does not yet call tools on its own turn by turn (hint on request, figure, step reveal), moves are not streamed, and nothing is cached per act. Those are the next steps, and they need the move protocol to exist first.

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

- [x] Mastery properties above are unit-tested directly.
- [x] `respond` writes one evidence row, one turn and one state update, atomically.
- [x] A rehearsal session leaves `learner_concept_state` and `learner_evidence` untouched (test asserts row counts).
- [x] `next` on a session whose goal concept has no visible acts returns `noActAvailable`, not an empty turn.
- [x] The chosen act's id and the retrieval snapshot are on the agent turn.
- [x] Grading failure still produces a completed turn with `outcome=0.5`.

## State after execution

Files: `src/server/tutor/{mastery,diagnose,grade,session}.ts`, `src/server/tutor/session.test.ts` (11 tests), `src/server/controller/tutor.ts` (five procedures), `sessionNotFound` and `noActAvailable` domain codes.

The mastery formula as implemented: `alpha = clamp(0.4 / (1 + 0.3 (n-1)), 0.08, 0.4)`, `mastery' = clamp(mastery + alpha (outcome - mastery), 0.02, 0.98)`, `confidence = 1 - 0.5^(n/3)`. Tests pin the three properties that matter: one outcome never moves mastery by more than 0.4, twenty identical outcomes converge below 0.98 without overshooting, and confidence depends only on the number of outcomes, not their direction.

The rehearsal guard is a single early return before the transaction, so a rehearsal writes turns — including the graded one — and touches neither `learner_evidence` nor `learner_concept_state`. The test asserts all three row counts.

Grading goes through `chatStructured` with `effort: 'low'`; a failure is logged and recorded as `outcome = 0.5, substantive = false` rather than interrupting the learner.

`session.ts` uses three turns per exchange: the agent presents the act, the learner answers, the agent records the grade. Evidence hangs off the _learner_ turn, because that is the row that contains the answer.

## Correction this chunk forced on chunk 15

The "goal concept has no acts" test failed because retrieval was serving acts from unrelated concepts — a session could teach something outside its own goal. `retrieve` now filters candidates to the goal's closure. That is recorded in `15-retrieval.md`, because it changes that chunk's contract: seeds order, the closure admits.

## Anti-goals

- No act synthesis at runtime. The agent serves what humans accepted; anything else is a later chunk with its own evaluation.
- No multi-act scripts in one turn, no branching dialogue, no free-form chat mode.
- No spaced-repetition scheduler, no streaks, no gamification.
- No streaming. Turns are atomic.
