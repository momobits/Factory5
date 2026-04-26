# Next session — paste this to start

Phase 11 (Web UI 9b — mutation surface) is **4/7 closed** as of 2026-04-26. All
three backend mutation routes shipped + tested:

- 11.1 ADR 0027 — pinned the contract ([docs/decisions/0027-web-ui-mutation-surface.md](../../docs/decisions/0027-web-ui-mutation-surface.md))
- 11.2 `POST /api/v1/pending-questions/:id/answer`
- 11.3 `POST /api/v1/builds`
- 11.4 `PUT /api/v1/projects/:id/budget` (+ project-tier budget resolution layered into both CLI and daemon code paths)

Workspace: 707 tests across 14 packages green. lint + format clean. Builds
clean across 14 packages + 3 apps.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase / step /
carry-forwards), then the Phase 11 charter at
`.control/phases/phase-11-web-ui-9b/{README.md,steps.md}`. The 11.5 entry in
`steps.md` carries an inline "Note for next session" block — read it before
opening 11.5.

ADR 0027 ([docs/decisions/0027-web-ui-mutation-surface.md](../../docs/decisions/0027-web-ui-mutation-surface.md))
is the load-bearing contract for the routes the SPA forms wire against.

Run `/session-start` for the full drift check.

## Standing rule for 11.5 (and any future UI work in this repo)

**Invoke the `frontend-dev` plugin / skill BEFORE hand-rolling Astro markup
or form designs.** The operator's preference is to let `frontend-dev` drive
the design + Islands wiring; implement against its output. Don't pre-empt the
skill by sketching the markup yourself.

Memory:
[`feedback_use_frontend_dev_skill.md`](../../../C:/Users/Momo/.claude/projects/G--Projects-Large-Projects-factory-factory5/memory/feedback_use_frontend_dev_skill.md).

## Next concrete work — 11.5 (SPA write affordances)

Three forms to wire in `apps/factory-web/`:

1. **Answer textarea + submit** on the pending-questions detail page →
   `POST /api/v1/pending-questions/:id/answer` with `{ answer: string }`. On
   200, refresh the page state. On 409 `QUESTION_ALREADY_ANSWERED_DIFFERENTLY`,
   render the existing answer (don't bury the conflict). If the response
   payload eventually grows a `taskOrphaned: boolean` advisory, surface it as
   a banner.
2. **Build form** (page or modal on the overview) — operator picks
   `project + language + autonomy + budget` → `POST /api/v1/builds`. Disable
   submit on first click (build is NOT idempotent per ADR 0027 §2). On 200,
   navigate to the new directive's detail page. On 404 `PROJECT_NOT_FOUND`,
   render "use `factory init` to create new projects" — the API doesn't
   create from the UI.
3. **Budget inputs** (`maxUsd`, `maxSteps`) on the project detail page →
   `PUT /api/v1/projects/:id/budget`. Full-document semantics: send the whole
   document each PUT (the form has both fields rendered with current values).
   Empty body clears all defaults. The `:id` is the project ULID.

All three through a centralised `src/lib/api.ts` module that wraps fetch with
the bearer + `{error:{code,message,details?}}` unwrap. Error codes to switch
on (per ADR 0027 §3 + the existing read-side codes):

`UI_AUTH_REQUIRED` (401), `UI_DISABLED` (503), `NON_LOCALHOST` (403),
`SCHEMA_VALIDATION_FAILED` (400), `BAD_REQUEST` (400), `INTERNAL` (500),
`QUESTION_NOT_FOUND` (404), `QUESTION_ALREADY_ANSWERED_DIFFERENTLY` (409),
`PROJECT_NOT_FOUND` (404), `PROJECT_PATH_UNREADABLE` (404),
`PROJECT_METADATA_CORRUPT` (422), `DIRECTIVE_NOT_FOUND` (404).

The budget route's `:id` needs a project ULID — Phase 11 will likely need a
`GET /api/v1/projects` list endpoint so the SPA can map names → ULIDs. Small
read-side addition; lands at 11.5 alongside the form work (out of strict
scope for this ADR but a prerequisite).

Per CLAUDE.md: UI changes need browser smoke before being reported as
complete. `pnpm dev --filter factory-web` + browse `localhost:4321/app/?t=<token>`
and exercise each form. Round-trip-against-real-factoryd validation belongs to
11.6.

## Then in order

**11.6 (Live validation)** — operator at the browser exercises each route
end-to-end against a real factoryd. Three smokes:

- answer a real pending question → worker unblocks (or directive transitions
  out of `waiting_for_human`);
- kick off a build for an existing project (a Phase 10 fixture works) →
  directive lands + runs to completion;
- update a project's budget defaults → start a new build → directive's
  `limits` reflect the new values.

**11.7 (Phase close)** — tag `phase-11-web-ui-9b-closed`. Author
`docs/Phase11_Progress.md`, prepend `docs/PROGRESS.md`, and update
`CompleteArchitecture.md` (extend §21 or new §23 for the mutation surface).
Scaffold Phase 12 (filesystem-scoping for worker subprocesses).

## Mid-phase opportunity — I014 fix

Still open from Phase 10. If a session lands in `runArchitect` for any reason,
the I014 fix is a one-commit win:

```ts
// at end of runArchitect, after writing pages
if (await isGitRepo(opts.projectPath)) {
  const git = simpleGit(opts.projectPath);
  await git.add(['docs/']);
  const status = await git.status();
  if (status.staged.length > 0) {
    await git.commit('factory: architect output');
  }
}
```

## Carry-forward (still non-blocking)

- **I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound doesn't inherit
  budget defaults. After 11.4 it skips two tiers (project + config), not
  one. Right fix: extract a shared `resolveDirectiveLimits(projectMeta, cfg,
explicitFlags)` helper in `@factory5/brain` or `@factory5/wiki` so every
  directive-creation path runs the same three-tier resolution. Recorded as
  ADR 0027 §4 carry-forward.
- **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher.
- **I014** (MEDIUM, OPEN) — architect-on-resume leaves wiki edits
  uncommitted; manual workaround (`git add docs/ && git commit`) cleared the
  issue in 10.5.
- **Stale-dist dev-loop gotcha** — needs design (conditional exports OR
  app-side bundling with full transitive npm deps); workaround is `pnpm build`
  after editing workspace deps before running `pnpm factoryd`.
- **`factory ui-token` CLI command** (ADR 0025 §2) — operator closes terminal
  → loses dashboard URL.
- **Phase 6 operator follow-up:** revoke PAT, `gh repo delete`, env var
  cleanup.

Report back on wake-up with a status block in this shape:

```
Phase 11 — 4/7 closed; 11.5 SPA write affordances next
Last action: docs(state) <SHA> (session end) on top of feat(11.4) 3231c5c
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-10-assessor-tier3-closed
Open blockers: 0 (I009 + I012 + I014 non-blocking)
Proposed next action: 11.5 — SPA write affordances (invoke `frontend-dev` skill first)
Ready to proceed?
```
