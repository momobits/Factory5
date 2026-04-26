# Phase 11 Steps — Web UI 9b (mutation surface)

> **Sub-step 11.1 opens next.** The rest are outlines that expand once
> 11.1's ADR pins the mutation route shape + idempotency rules + error
> envelope contract. Per the Phase 7 / 8 / 9 / 10 pattern, sub-step
> bodies grow as each session opens.

## Phase 11 — Web UI 9b

- [ ] 11.1 — **ADR 0027** mutation route shape. Decisions to pin:
  - **HTTP verbs + URL shape** — `POST /api/v1/pending-questions/:id/answer`
    vs. `PUT /api/v1/pending-questions/:id` with `{ answer }`? Same
    question for `/api/v1/builds` (POST a directive vs. POST against
    `/projects/:id/builds`).
  - **Idempotency** — answer-a-question: should re-POSTing the same
    answer be a no-op or a 409? Build-creation: client-supplied
    idempotency key in a header? Or rely on the natural ULID dedup
    (server-side ULID, client gets it back)?
  - **Error envelope** — Phase 9's read-side echoed query filters in a
    `meta:` field. The mutation envelope needs a stable error shape
    (status + code + human message + maybe field-level errors for
    validation failures).
  - **Auth** — same `FACTORY5_UI_TOKEN` bearer. No mutation gets a
    weaker check; if anything, mutations could grow a CSRF-style
    double-submit later (out of scope for 11.1).
  - **`metadata.budgetDefaults` shape** — mirrors `directiveLimitsSchema`
    (`maxUsd?`, `maxSteps?`); writes go through
    `loadOrCreateProjectMetadata`'s `metadata` extension point, not a
    new top-level field (preserves ADR 0021 sticky identity).
  - Output: `docs/decisions/0027-*.md` + INDEX row.

- [ ] 11.2 — **Answer-a-pending-question route.**
      `POST /api/v1/pending-questions/:id/answer` with `{ answer: string }`.
      Calls into the same path the channel handlers use
      (`maybeAnswerPendingQuestion` or its successor). Returns the
      updated question. Tests cover: happy path, idempotent re-answer,
      404 for unknown id, 400 for missing/empty answer.

- [ ] 11.3 — **Build-creation route.** `POST /api/v1/builds` with
      `{ project, language?, autonomy?, limits? }`. Mirrors
      `factory build`'s directive-creation path: resolves project
      metadata (creates a directive with `intent: 'build'`), enqueues
      into SQLite, rings the daemon doorbell. Returns the new directive.
      Tests cover: happy path with explicit limits, language fallback
      from project.json `metadata.language` (10.8 parity), 400 for
      unknown project, 401 for missing token.

- [ ] 11.4 — **Project budget defaults route.**
      `PUT /api/v1/projects/:id/budget` with `{ maxUsd?, maxSteps? }`.
      Writes into `<project>/.factory/project.json`
      `metadata.budgetDefaults`. `factory build`'s budget resolution
      (CLI flag → `[budget.defaults]` config) gains a third tier:
      project metadata wins over instance config but loses to explicit
      flag. Tests cover: round-trip read/write, partial update
      (only maxUsd), removing a field via null.

- [ ] 11.5 — **SPA write affordances.** Pending-questions detail page
      gets an answer textarea + submit. New `app/build` page (or
      modal on overview) lets the operator pick project + language +
      autonomy + budget. Project detail page gets `<input>`s for
      maxUsd / maxSteps. All three forms POST/PUT through `src/lib/api.ts`
      (centralised bearer + envelope handling). No new pages beyond
      what's needed; reuse the existing list pages.

- [ ] 11.6 — **Live validation.** Operator at the browser exercises
      each route against the running factoryd:
  - Answer a real pending question → verify the matching worker
    unblocks and continues (or the directive transitions out of
    `waiting_for_human`).
  - Kick off a build for an existing project (probably one of the
    Phase 10 fixtures) → verify it lands + runs end-to-end.
  - Update a project's budget defaults → start a new build → verify
    the directive's `limits` reflect the new values.

- [ ] 11.7 — **Phase close.** Tag `phase-11-web-ui-9b-closed`.
      `docs/Phase11_Progress.md` + `docs/PROGRESS.md` entry +
      `CompleteArchitecture.md` update (extend §21 or new §23 for the
      mutation surface). Scaffold Phase 12 (filesystem-scoping for
      worker subprocesses).
