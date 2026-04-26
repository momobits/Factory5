# Next session — paste this to start

Phase 10 closed clean (`phase-10-assessor-tier3-closed`, 2026-04-26). All
three tier-3 runtimes (Node / Go / Rust) verified end-to-end against
real `factory build` runs with `gate.verify=true`. Phase 11 (Web UI 9b
— mutation surface) opens with this commit. Next concrete work is
**11.1 — ADR 0027** (mutation route shape).

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase /
step / carry-forwards), then the Phase 11 charter at
`.control/phases/phase-11-web-ui-9b/README.md` and its sub-step outline
at `.control/phases/phase-11-web-ui-9b/steps.md`.

Skim [docs/Phase10_Progress.md](../../docs/Phase10_Progress.md) for
just-closed-phase context — the four bugs that surfaced during Phase
10's live runs (`--language` threading, I013 worktree cleanup,
`extractJsonObject` string state, Go runtime `-v -count=1`) are useful
priors. The remaining open issue from Phase 10 is **I014**
(architect-on-resume leaves wiki edits uncommitted, dirty-tripping
`gate.verify`); a small targeted fix could land mid-Phase-11.

Skim [ADR 0026](../../docs/decisions/0026-pluggable-runtime-contract.md)
only if you'll touch anything assessor-related; Phase 11 is mostly
brain / daemon / cli / web-app surfaces.

Run `/session-start` for the full drift check.

## Next concrete work — 11.1 (ADR 0027)

Pin the mutation surface contract before any route lands. Decisions to
nail down:

1. **HTTP verbs + URL shape.**
   `POST /api/v1/pending-questions/:id/answer` with `{ answer }` vs.
   `PUT /api/v1/pending-questions/:id` with `{ answer }`? Same question
   for build creation: `POST /api/v1/builds` vs.
   `POST /api/v1/projects/:id/builds`. Lean toward action-on-resource
   for question-answer (it's not a partial update), resource-creation
   for builds.
2. **Idempotency.** Question-answer is naturally idempotent (a question
   has one answer; re-POST with the same payload is a no-op). Build
   creation is not (each call creates a new directive). Decide:
   client-supplied `Idempotency-Key` header? Server-side dedup window?
   Or just rely on operator-side discipline (the Web UI's submit
   button can disable on first click)?
3. **Error envelope.** Phase 9's read-side echoed query filters in a
   `meta:` field. The mutation envelope needs a stable error shape:
   `{ error: { code: string, message: string, fields?: Record<string,
string> } }` or similar. Code list for known cases
   (`UI_AUTH_REQUIRED`, `PROJECT_NOT_FOUND`, `QUESTION_ALREADY_ANSWERED`,
   `INVALID_LANGUAGE`, etc.).
4. **`metadata.budgetDefaults` shape.** Mirrors `directiveLimitsSchema`
   (`maxUsd?: number, maxSteps?: number`); writes go through
   `loadOrCreateProjectMetadata`'s `metadata` extension point (same
   pattern as 10.8's `language`). `factory build` budget resolution
   gains a third tier: project metadata wins over instance config but
   loses to explicit CLI flag. Order: `--max-usd flag → project.json
metadata.budgetDefaults → config.toml [budget.defaults]`.
5. **Auth.** Same `FACTORY5_UI_TOKEN` bearer. No mutation gets a
   weaker check. CSRF-style double-submit out of scope for 11.1.

Output: `docs/decisions/0027-*.md` + INDEX row.

## Then in order

**11.2 (Answer route)** — `POST /api/v1/pending-questions/:id/answer`
calling into the same path the channel handlers use. Tests cover happy
path, idempotent re-answer, 404 unknown id, 400 missing/empty answer.

**11.3 (Build route)** — `POST /api/v1/builds` mirroring
`factory build`'s directive-creation path. Resolves project metadata,
creates a directive with `intent: 'build'`, enqueues into SQLite, rings
the daemon doorbell. Returns the new directive. Tests: happy path with
explicit limits; language fallback from `metadata.language` (10.8
parity); 400 unknown project; 401 missing token.

**11.4 (Budget route)** — `PUT /api/v1/projects/:id/budget` with
`{ maxUsd?, maxSteps? }`. Writes into `<project>/.factory/project.json`
`metadata.budgetDefaults`. `factory build`'s budget resolution gains
the third tier from above. Tests: round-trip, partial update, removing
a field.

**11.5 (SPA write affordances)** — pending-questions detail page gets
an answer textarea + submit. New build form (page or modal) lets
operator pick project + language + autonomy + budget. Project detail
page gets `<input>`s for maxUsd / maxSteps. All three forms POST/PUT
through `src/lib/api.ts` (centralised bearer + envelope handling).

**11.6 (Live validation)** — operator at the browser exercises each
route end-to-end against the running factoryd. Three smokes: answer
unblocks a worker; build kicks off + runs to completion; budget update
is honoured by the next build. Cheap to run because no new project is
needed (reuse a Phase 10 fixture or any existing workspace project).

**11.7 (Phase close)** — tag `phase-11-web-ui-9b-closed`, write
`docs/Phase11_Progress.md`, prepend `docs/PROGRESS.md`, extend
`CompleteArchitecture.md` (extend §21 or new §23 for the mutation
surface). Scaffold Phase 12 (filesystem-scoping for worker
subprocesses).

## Mid-phase opportunity — I014 fix

If a session lands in `runArchitect` for any reason, the I014 fix is
a one-commit win:

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

Doesn't need to wait for Phase 11; could land as a standalone `fix(I014)`
commit any time. Especially worth pairing with any other architect
touch.

## Carry-forward from Phase 10 (unchanged, still non-blocking)

- **I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound doesn't
  inherit `[budget.defaults]`.
- **I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher
  can't target a specific open question.
- **I014** (MEDIUM, OPEN, **new this phase**) — architect-on-resume
  leaves wiki edits uncommitted; manual workaround
  (`git add docs/ && git commit`) cleared the issue in 10.5.
- **Stale-dist dev-loop gotcha** — Phase 9's recommended one-line
  flip (`packages/{daemon,ipc,state}/package.json` `main` → `src/index.ts`)
  is **incompatible with the prod runtime path**. Confirmed empirically
  2026-04-26: tsx + vitest resolve the TS source fine, but
  `node apps/factoryd/dist/main.js` then fails with
  `Cannot find module .../src/brain-supervisor.js` because raw node
  can't transpile `.js` extensions on `.ts` source files. Two real
  fixes: (a) **conditional exports** (`exports.development → src`,
  `exports.default → dist`) + force tsx/vitest to resolve under
  `development` via `--conditions` or `NODE_OPTIONS`; (b) **bundle
  workspace deps in `apps/*/tsup.config.ts`** via
  `skipNodeModulesBundle: true` + `noExternal: [/^@factory5\//]`,
  but app package.jsons then need to declare every transitive npm
  dep (commander / pino / fastify / zod / …) since pnpm doesn't hoist
  transitive deps to where bundled output looks. Both deserve their
  own substep, not the offhand one-liner Phase 9 suggested. Until
  designed properly, the workaround is `pnpm build` after editing
  workspace deps before running `pnpm factoryd`.
- **`factory ui-token` CLI command** (ADR 0025 §2) — operator closes
  terminal → loses dashboard URL; mitigation is restart factoryd.
- **Phase 6 operator follow-up:** revoke PAT at
  <https://github.com/settings/tokens>;
  `gh repo delete momobits/factory5-6b-smoke --yes`;
  `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

Report back on wake-up with a status block in this shape:

```
Phase 11 — 0/7 closed; 11.1 ADR 0027 next
Last action: docs(state) 0df2b51 (stale-dist clarification) on top of chore(phase-10) 1351b2f
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-10-assessor-tier3-closed
Open blockers: 0 (I009 + I012 + I014 non-blocking)
Proposed next action: 11.1 — ADR 0027 (mutation route shape, idempotency, error envelope)
Ready to proceed?
```
