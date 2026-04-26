# Phase 11 Steps — Web UI 9b (mutation surface)

> **Sub-step 11.1 opens next.** The rest are outlines that expand once
> 11.1's ADR pins the mutation route shape + idempotency rules + error
> envelope contract. Per the Phase 7 / 8 / 9 / 10 pattern, sub-step
> bodies grow as each session opens.

## Phase 11 — Web UI 9b

- [x] 11.1 — **ADR 0027** mutation route shape. Decisions to pin:
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

- [x] 11.2 — **Answer-a-pending-question route.**
      `POST /api/v1/pending-questions/:id/answer` with `{ answer: string }`.
      Calls into the same path the channel handlers use
      (`maybeAnswerPendingQuestion` or its successor). Returns the
      updated question. Tests cover: happy path, idempotent re-answer,
      404 for unknown id, 400 for missing/empty answer.

- [x] 11.3 — **Build-creation route.** `POST /api/v1/builds` with
      `{ project, language?, autonomy?, limits? }`. Mirrors
      `factory build`'s directive-creation path: resolves project
      metadata (creates a directive with `intent: 'build'`), enqueues
      into SQLite, rings the daemon doorbell. Returns the new directive.
      Tests cover: happy path with explicit limits, language fallback
      from project.json `metadata.language` (10.8 parity), 400 for
      unknown project, 401 for missing token.

- [x] 11.4 — **Project budget defaults route.**
      `PUT /api/v1/projects/:id/budget` with `{ maxUsd?, maxSteps? }`.
      Writes into `<project>/.factory/project.json`
      `metadata.budgetDefaults`. `factory build`'s budget resolution
      (CLI flag → `[budget.defaults]` config) gains a third tier:
      project metadata wins over instance config but loses to explicit
      flag. Tests cover: round-trip read/write, partial update
      (only maxUsd), removing a field via null.

- [x] 11.5 — **SPA write affordances.** Three forms wired: - `apps/factory-web/src/pages/questions/detail.astro` gets an
      answer textarea + submit when `answeredAt === undefined`. POST
      `/api/v1/pending-questions/:id/answer`. On 409, refetches and
      renders the recorded answer in a conflict alert. Suggested
      answers from `options` are clickable shortcuts that fill the
      textarea. - `apps/factory-web/src/pages/build.astro` (new) — project select
      populated from `GET /api/v1/projects`, plus optional language /
      autonomy / maxUsd / maxSteps. Submit disables on first click
      (build is non-idempotent per ADR 0027 §2). On 200 navigates to
      `/app/directives/detail?id=<directive.id>`. - `apps/factory-web/src/pages/projects/{index,detail}.astro` (new)
      — list table + detail with budget defaults form. PUT
      `/api/v1/projects/:id/budget` for save; "Clear all defaults"
      button does PUT `{}` behind a `window.confirm`. Pre-fills from
      the `GET /:id` response's extracted `budgetDefaults`.
      Centralised `apiPost<TReq,TRes>` / `apiPut<TReq,TRes>` helpers
      added to `src/lib/api.ts` (JSON-encode + Content-Type, reuse
      existing `apiFetch` envelope unwrap). New shared CSS primitives
      (`.form`, `.form-field`, `.btn`, `.btn-primary`, `.alert--*`)
      added to `Dashboard.astro`'s style block — built on the existing
      `color-mix(currentColor)` palette so they auto-adapt to light /
      dark via `color-scheme`. Two new nav entries: Projects, Build.
      Read-side prerequisite landed in the same step: `GET /api/v1/projects`
      (list) + `GET /api/v1/projects/:id` (detail with extracted
      `budgetDefaults` + `language`). +10 daemon tests; total 121.

- [x] 11.6 — **Live validation.** Operator-driven browser smoke against
      a real factoryd on 2026-04-26. All three flows verified end-to-end.
      Project: `log-totals-cli` (Phase 10 fixture).
  - **Smoke #2 — build form** (POST /api/v1/builds): form created
    directive `01KQ5CRRVDT16YRP0TMDEP8PHX` with `hasLimits: false` (no
    project-tier defaults at the time). Brain claimed via doorbell
    within 1ms. Full assisted-mode arc: triage (Haiku, $0.016) →
    architect (Opus 4.7, $0.527) → askUser #1 → planner (Sonnet, $0.284)
    → askUser #2 → pool (scaffolder + 3 builders + verifier, all
    `exitCode: 0`) → assessor → terminal status `blocked` with 2 blocking
    - 4 advisory findings. Total $4.25 — heavy run, but a complete
      end-to-end signal.
  - **Smoke #1 — answer form** (POST /api/v1/pending-questions/:id/answer):
    both askUser questions raised by Smoke #2's flow
    (`01KQ5CZR40BAQVK33JB57EQR09` + `01KQ5ECARE6R0SQ3MASXK5R6ES`) were
    answered via the SPA textarea. Each answer fired `ipc:
/api/v1/pending-questions/:id/answer — answered`; brain's askUser
    poll caught the answer within ~600ms each time and the directive
    resumed cleanly. The same-question `outbound: abandoning (cli)`
    warnings are expected noise — no live cli session was listening;
    ADR 0024 §4 + ADR 0027 §1 deliberately keep the form path
    independent of channel delivery, and the smoke proves it.
  - **Smoke #3 — budget form** (PUT /api/v1/projects/:id/budget): four
    PUT calls exercised set (`maxUsd: 50 maxSteps: 50`), idempotent
    re-save, and two empty-body clear-all-defaults paths. Each write
    landed on disk via `wiki.project-metadata: metadata updated`.
    **Propagation check**: after re-setting the defaults and creating
    Build #2 via the form with **no body limits**, `ipc: /api/v1/builds —
directive created` logged `hasLimits: true` and the new directive
    `01KQ5G9DFN41H2ATVV8MZ9WY5A` ran with `maxUsd: 50 maxSteps: 50` —
    sourced from the project tier alone. The `hasLimits: false` (Build #1)
    vs `hasLimits: true` (Build #2) contrast across an unchanged form
    is the load-bearing observation that proves ADR 0027 §4 budget
    resolution: project-tier wins over instance-config-tier when no flag
    is supplied. (Operator chose `50` deliberately for Max USD, not the
    `0.50` from the recipe — confirmed not a parsing bug.)
  - No SPA-side regressions observed: nav with new Projects + Build
    entries renders; the form primitives (`.btn-primary`, `.alert--*`,
    monospace-textarea, tabular-nums numeric inputs) display correctly
    in both light and dark color-scheme; the modified questions detail
    page renders the form when open and suppresses it cleanly after
    answering.

- [ ] 11.7 — **Phase close.** Tag `phase-11-web-ui-9b-closed`.
      `docs/Phase11_Progress.md` + `docs/PROGRESS.md` entry +
      `CompleteArchitecture.md` update (extend §21 or new §23 for the
      mutation surface). Scaffold Phase 12 (filesystem-scoping for
      worker subprocesses).
