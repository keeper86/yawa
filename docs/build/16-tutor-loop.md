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

## Beads

Act scripts are notes for the tutor. `setup`, `model`, `fade` and `check` say what the tutor should do — "Begruende die Ordnung zwei ueber den ersten nicht verschwindenden Term der Taylorreihe" is an instruction, not a question a learner can answer.

The first attempt rendered the notes verbatim: the rubric on screen, no explanation, an unanswerable question. The second attempt rewrote the act into one explanation plus one open question, which was still wrong for a different reason: a page of text followed by a written answer tests production under load and returns exactly one bit of information, at the very end, when nothing can be repaired any more.

So a lesson is a **chain of beads**. Each bead carries one idea (at most 450 characters) and one check, and the checks are answered one at a time.

| bead     | carries                                                |
| -------- | ------------------------------------------------------ |
| anchor   | the concrete situation the learner already understands |
| idea     | the one causal mechanism — the bead that matters       |
| example  | the same idea carried out with numbers                 |
| contrast | the tempting wrong model and why it fails              |
| transfer | the same idea on new numbers or a neighbouring method  |

The rule that makes this work is local: the check of a bead is answerable from the ideas of this bead and the beads before it, never from later ones. No forward references, no reading comprehension.

```ts
{
    kind: 'choice';
    idea;
    question;
    options: {
        text;
        correct;
        why;
    }
    [];
}
{
    kind: 'open';
    idea;
    question;
    expects;
}
```

`src/lib/lesson.ts` holds the schema, the credit function and the pure fallbacks; `src/server/tutor/perform.ts` holds the plan prompt, the repair prompt and the strict checks (exactly one correct option per bead, a named `why` on every wrong option). A bead that fails those checks takes the whole plan back to the fallback rather than teaching a broken step.

### Figures

A bead may carry a figure, because some arguments live in the numbers: two series to compare, a trend, the effect of one parameter. The interface is deliberately narrow — the model names a **template**, not a chart:

```ts
{ template: 'trend' | 'compare' | 'scatter',
  x: { label, unit }, y: { label, unit },
  caption: string,
  series: [{ label, points: [{ x, y }] }] }   // ≤ 2 series, ≤ 12 points
```

`trend` draws a line, `compare` draws bars over numeric categories, `scatter` draws individual measurements. Units are their own field and a dimensionless quantity gets `1`, so an axis cannot be left unlabelled by omission — the renderer drops the parenthetical for `1`.

Three findings worth keeping:

- **A fragment is invisible to recharts.** Passing the axis children as `<>...</>` compiled, rendered a curve, and silently dropped the axes, the grid, the tooltip and the tick labels — because recharts scans `props.children` for known child types and a fragment hides them. Axis elements are now an array, and `LessonFigure.test.tsx` asserts that axis ticks and grid lines actually exist. A chart test that only checks for a path would have passed a broken chart.
- **A nested schema makes the model stop charting.** Moving from `kind` to `template` with `x`/`y` objects silently took figures from 1-per-lesson to 0 — validation still passed, because `figure` defaults to null. Adding one literal example figure to the prompt brought it back. Narrowness has to be taught, not just enforced.
- **A unit requirement that is too strict suppresses the feature.** Requiring a non-empty unit produced _zero_ figures: the model preferred dropping the figure over naming a unit. With `1` for dimensionless quantities and an example, it names units correctly.

A figure is dropped, never fatal: a series that repeats an x value cannot be drawn, so `planLesson` sets that bead's `figure` to null and keeps the bead. Schema failures are different — they reject the plan into the act fallback, which is why the prompt carries the example.

### Scales

Charts auto-scale and can switch to logarithms. `src/lib/chartAxis.ts` holds the pure rules, taken from the neighbouring PolyEconGame: `linearDomain` pads the value range by 8% and opens a window when every value is equal, `trimmedLogAxis` drops the two smallest and two largest magnitudes and offers a log scale only once the remaining spread exceeds one decade, and `planAxis` decides between the two — `compare` is never logged, because a log bar loses its length meaning. `axisForScale` re-anchors the domain when the learner flips the axis.

The switch is the point, not a preference. On log axes a power law becomes a straight line, and that is exactly the observation the first trapezoid bead is fishing for. The toggle is offered only when every value is positive, and the hint above the chart says what to look for.

Not there: no per-series axis choice, no `highlight` so the tutor can point at a point, and no check that a unit is _correct_ — only that one exists.

### Answering

`answerBead` grades a choice **without the model**: the option carries `correct`, so the verdict is arithmetic, instant, free and reproducible. Only a wrong pick calls the model — `repairBead` names the misconception and re-explains the same idea in other words. Two attempts per bead, then the correct option is revealed and the lesson moves on.

```
first try correct   credit 1.0
second try correct  credit 0.6
revealed            credit 0.15
```

The credit is written as evidence when the bead resolves, so an act yields evidence per bead instead of one verdict at the end, and `misconception` in the diagnosis sees the difference between "needed a hint" and "never got it". Attempts are counted against the lesson presentation (`seq > lessonTurn.seq`), not the session, so a second act starts at attempt one. Answering a resolved bead is refused with `invalidAnswer` rather than recording a second outcome.

The `open` bead exists for two reasons: some acts end in a written transfer answer, and it is the fallback. When planning fails, the lesson is one open bead built from the act's `check` step and `success.criterion`, graded by `gradeAnswer` exactly as before. A model outage degrades the lesson; it never blocks it.

The reaction turns carry `act_id` as well, so the active lesson is found by `jsonb_exists(content, 'beads')` rather than by act alone — otherwise the second answer of a lesson would look for beads on its own feedback turn.

### What is not here yet

The plan is produced in one call per act; nothing is cached, and a full plan costs roughly 30 seconds and 15 k reasoning characters. The next steps, in order: cache plans per act and mastery bucket, let the tutor add a bead mid-lesson when a repair suggests the idea needs a second angle, and only then give the tutor real tools (hint on request, figure, step reveal) instead of a fixed chain.

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
