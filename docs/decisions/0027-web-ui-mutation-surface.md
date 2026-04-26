# 0027 — Web UI mutation surface: route shape, idempotency, error envelope, and per-project budget defaults

- **Status:** Accepted
- **Date:** 2026-04-26
- **Builds on:** [ADR 0025](0025-web-ui-architecture.md) — `FACTORY5_UI_TOKEN` bearer + `/api/v1/*` URL-prefix versioning + Astro MPA shell that this ADR extends from read-only to mutation. [ADR 0024](0024-worker-subprocess-ask-user.md) — `pending_questions` as the first-class mid-stream surface that the answer route closes the loop on. [ADR 0021](0021-first-class-project-identity.md) — `<project>/.factory/project.json` + the `metadata: Record<string, unknown>` extension point that the budget defaults land in (same slot as 10.8's `metadata.language`). [ADR 0020](0020-pre-call-budget-enforcement.md) — `directiveLimitsSchema` shape that the per-project budget defaults mirror, and the pre-call enforcement seam that consumes the resolved limits.

## Context

Phase 9 shipped the read-only Web UI per ADR 0025: Astro MPA + Islands behind `/app/`, `/api/v1/*` JSON API gated by a per-startup `FACTORY5_UI_TOKEN` bearer. Phase 11's charter (`.control/phases/phase-11-web-ui-9b/README.md`) extends that surface with the deferred 9b mutations — answer pending questions, kick off builds, configure per-project budget defaults — so the Web UI becomes a complete operating surface, not just a dashboard.

Three forcing functions converge here. ADR 0024 made `pending_questions` first-class (workers ask mid-stream; channel handlers collect answers); Phase 9 rendered them in the browser; Phase 11 closes the loop in the browser too. `factory build` already resolves a directive via `loadOrCreateProjectMetadata` + `directivesQ.insert` with two-tier budget resolution (`--max-usd flag → ~/.factory5/config.toml [budget.defaults]`); the API needs the same path plus a per-project tier so operators can pin defaults without flagging every build. And the existing GET-only `/api/v1/*` envelope (`IpcRequestError → { error: { code, message, details? } }`) already exists in production — the mutation routes shouldn't fork it.

Five sub-decisions need pinning before any route lands so 11.2 / 11.3 / 11.4 implement against a fixed contract — same multi-decision one-ADR shape used for [ADR 0024](0024-worker-subprocess-ask-user.md), [ADR 0025](0025-web-ui-architecture.md), and [ADR 0026](0026-pluggable-runtime-contract.md):

1. **HTTP verbs and URL shapes per route.** Action-on-resource vs. resource-creation vs. sub-resource update.
2. **Idempotency rules per route.** Re-POST / re-PUT semantics: when is it a no-op, when does it conflict, what status is returned.
3. **Error envelope shape and pinned code list.** Reusing the existing envelope; enumerating the new mutation-specific codes the SPA switches on.
4. **`metadata.budgetDefaults` shape and resolution order.** Where it lives in `project.json.metadata`; how `factory build` reads it relative to the existing CLI-flag and config-file tiers.
5. **Auth posture for mutations.** Same `FACTORY5_UI_TOKEN`; whether anything weaker / stronger applies; CSRF + cross-origin posture.

## Decision

Five parts, one ADR. The shared envelope across all three routes is the existing `ipcErrorSchema` for failures and a `{ <resource> }` body on success — same shape Phase 9 read routes already return.

### 1. Route verbs + URL shapes — pinned per route

| Route                | Method | URL                                          | Body                                                            | Success body                          |
| -------------------- | ------ | -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- |
| Answer a question    | POST   | `/api/v1/pending-questions/:id/answer`       | `{ answer: string }`                                            | `{ question }`                        |
| Kick off a build     | POST   | `/api/v1/builds`                             | `{ project, language?, autonomy?, limits? }`                    | `{ directive }`                       |
| Update budget defaults | PUT  | `/api/v1/projects/:id/budget`                | `{ maxUsd?: number, maxSteps?: number }`                        | `{ projectId, budgetDefaults }`       |

**Answer — action-on-resource (`POST …/:id/answer`), not partial update.** `PUT /api/v1/pending-questions/:id { answer }` would imply the question is being partially updated; in fact, posting an answer triggers downstream side effects (worker resume from `waiting_for_human` per ADR 0024 §4, channel ack on the question's original channel). Naming the action at the URL level mirrors the existing `/worker/ask-user` shape and leaves room for sibling actions later (`/cancel`, `/timeout`) without mutating the question's own resource shape.

**Build — POST to a top-level collection, not nested under a project.** `POST /api/v1/projects/:id/builds` is more REST-pure but assumes the SPA pre-resolved a project name → ULID, which forces a project-list endpoint to exist before any build can be created. `POST /api/v1/builds { project }` mirrors `factory build <project>` directly: operator names the project (the same handle they'd type at the shell), the server resolves to a path + identity via the same `resolveProjectPath` + `loadOrCreateProjectMetadata` chain the CLI takes (`packages/cli/src/commands/build.ts:134-143`). One handle to remember (project name); same path the CLI takes; identity-by-ULID stays the daemon's internal concern.

**Budget — `PUT` with full-document replacement, not `PATCH`.** `PUT /api/v1/projects/:id/budget` replaces the entire `budgetDefaults` document. To clear `maxUsd`, the SPA sends a body without `maxUsd` (rather than `{maxUsd: null}`); to clear both fields, sends `{}`. Pure RFC-9110 PUT semantics: the request body is the new state of the resource, full stop. `PATCH` would invite the partial-update footgun (is `{maxUsd: null}` "remove maxUsd" or "set maxUsd to null"?). The SPA's budget form has both fields rendered with current values pre-filled, so sending the full document each time is natural.

`:id` on the budget route is the project ULID (the canonical handle per ADR 0021), looked up against the `projects` table to find `workspacePath`. Phase 11 will need a `GET /api/v1/projects` list endpoint so the SPA can map names → ULIDs for the budget form; that's a small read-side addition under the same auth gate. Out of strict scope for this ADR, but a prerequisite for 11.5's project-detail page — call out at 11.4 implementation time.

### 2. Idempotency — explicit per route

**Answer is naturally idempotent — re-POST same answer is a no-op (200); different answer is 409.** First writer wins by `pending_questions.answered_at` timestamp. SQLite serialises the UPDATE (single-writer model), so two operators answering simultaneously get one success + one 409 even under perfect race. The route uses a check-then-write pattern guarded by the SQLite write-lock:

1. `getById(:id)`. If absent → 404 `QUESTION_NOT_FOUND`.
2. If `answeredAt is undefined` → write via `pendingQuestions.answer`; return 200 with the updated question.
3. If already answered with the same string → return 200 (no-op, idempotent).
4. If already answered with a different string → 409 `QUESTION_ALREADY_ANSWERED_DIFFERENTLY` (preserves the original answer; never silently overwrites).

ADR 0024 §4's aborted-task guard still applies: the route calls `pendingQuestions.detectOrphanedAnswer` after the write and logs a warning if the linked task is in a terminal state. The answer write itself succeeds either way (forensic value preserved). The SPA can render the orphan warning if the response payload grows a `taskOrphaned: boolean` advisory (deferred to 11.2's implementation; the `{ question }` shape may extend with this field).

**Build is not idempotent — each POST mints a new directive.** No client-supplied `Idempotency-Key` header in v1. Reasoning: directive creation is a deliberate operator action, never auto-retried by the SPA. The submit button disables on first click and shows "creating…" until the response lands; double-submit creates two directives, recoverable by aborting one. Adding header-keyed dedup would buy negligible safety at the cost of a per-startup dedup-window cache. If a future non-operator caller (CI integration, scripted API client) demands replay safety, that's the right time to introduce it as a non-breaking schema extension.

**Budget is naturally idempotent — full-document PUT.** Re-PUT with the same body returns 200; re-PUT with a different body returns 200 with the new state. No partial-merge means no PATCH-like ambiguity about "absent" vs. "null".

### 3. Error envelope — reuse `ipcErrorSchema`; pinned code list

Reuse the existing `ipcErrorSchema` (`{ error: { code: string, message: string, details?: unknown } }`) — the same envelope Phase 9 read routes return via `IpcRequestError` (`packages/ipc/src/errors.ts` + `packages/daemon/src/server.ts:189-232`). Mutations don't need a new shape. Field-level validation errors land in `details` as the existing Zod issues array (`SCHEMA_VALIDATION_FAILED` 400, set by the existing `setupErrorHandler` ZodError branch).

Code list (existing on the read side + new for mutations). New codes are starred:

| Code                                       | HTTP | When                                                                                                                |
| ------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `UI_AUTH_REQUIRED`                         | 401  | Bearer missing or wrong (existing)                                                                                  |
| `UI_DISABLED`                              | 503  | Daemon started without `uiAuthToken` (existing)                                                                     |
| `NON_LOCALHOST`                            | 403  | Request from non-loopback IP (existing)                                                                             |
| `SCHEMA_VALIDATION_FAILED`                 | 400  | Body doesn't parse against the route's Zod schema; `details` carries the issues array (existing)                    |
| `BAD_REQUEST`                              | 400  | Other 4xx coercion fallback (existing)                                                                              |
| `INTERNAL`                                 | 500  | Unhandled exception (existing)                                                                                      |
| `QUESTION_NOT_FOUND`                       | 404  | `:id` doesn't match a row (existing on Phase 9 read routes; reused)                                                 |
| `QUESTION_ALREADY_ANSWERED_DIFFERENTLY` ★  | 409  | Re-POST with a different answer than already recorded; original preserved                                           |
| `PROJECT_NOT_FOUND` ★                      | 404  | Build route: project name doesn't resolve to a path; budget route: ULID not in the `projects` registry              |
| `PROJECT_PATH_UNREADABLE` ★                | 404  | Project is in the registry but `workspacePath` no longer holds a readable `.factory/project.json` (moved out-of-band) |
| `PROJECT_METADATA_CORRUPT` ★               | 422  | `project.json` exists but doesn't parse — wraps `ProjectMetadataCorruptError` from `@factory5/wiki`                 |

`QUESTION_ANSWER_EMPTY`, `INVALID_LANGUAGE`, `INVALID_BUDGET` etc. are **not** added as separate codes — they're caught by Zod (`z.string().min(1)`, `z.enum(['python', …])`, `z.number().positive()`) and surface as `SCHEMA_VALIDATION_FAILED` with the field path in `details`. Adding parallel code constants would duplicate the schema-issues pathway without giving the SPA new switching power; the SPA can render per-field errors by walking `details` directly. The starred codes are exactly the cases that don't reduce to a Zod parse failure.

The SPA's `src/lib/api.ts` (added at 11.5) wraps fetch with a single envelope unwrapper and switches on `error.code` to render route-specific banners (e.g. "this question was already answered" vs. "project not found"). `message` stays operator-readable; `details` is for development-time inspection. Codes are stable strings, not enum values — extension is additive.

### 4. `metadata.budgetDefaults` shape + budget resolution order

The shape mirrors the existing `directiveLimitsSchema`:

```ts
// in @factory5/core/schemas.ts
export const projectBudgetDefaultsSchema = z.object({
  maxUsd: z.number().positive().optional(),
  maxSteps: z.number().int().positive().optional(),
});
export type ProjectBudgetDefaults = z.infer<typeof projectBudgetDefaultsSchema>;
```

Storage location: `<project>/.factory/project.json` `metadata.budgetDefaults`, using ADR 0021's `metadata: Record<string, unknown>` extension point — same slot as 10.8's `metadata.language`. No change to `ProjectMetadata`'s top-level shape; no new column in the projects table; no migration required. Reads happen via a small typed helper added to `@factory5/wiki` at 11.4:

```ts
// in @factory5/wiki/project-metadata.ts
export function budgetDefaultsFromProjectMeta(
  meta: ProjectMetadata,
): ProjectBudgetDefaults | undefined {
  const raw = meta.metadata['budgetDefaults'];
  const parsed = projectBudgetDefaultsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
```

Mirrors 10.8's `languageFromProjectMeta` (`packages/cli/src/commands/build.ts:65-69`). Returns `undefined` for absent or malformed entries — silent fallback to the next tier on the read path. Corruption that's load-bearing surfaces via the budget route's PUT instead (where it raises `PROJECT_METADATA_CORRUPT`).

**Budget resolution order on `factory build`** (and on the new `POST /api/v1/builds` route — both share the resolver):

1. `--max-usd` / `--max-steps` CLI flag (or `limits` field in the API request body) — most specific, wins always.
2. `project.json metadata.budgetDefaults` (per-project, this ADR's new tier).
3. `~/.factory5/config.toml [budget.defaults]` (instance-wide, ADR 0020).
4. Absent → unlimited (pre-Phase-7 behaviour preserved).

Per-field resolution is independent: a directive with `--max-usd 5` and a project `metadata.budgetDefaults.maxSteps: 200` resolves to `limits: { maxUsd: 5, maxSteps: 200 }`. The change site is `packages/cli/src/commands/build.ts:163-169` — the existing `??`-chain gains the project-tier read between the flag and the config:

```ts
const projectDefaults = budgetDefaultsFromProjectMeta(projectMeta);
const maxUsd = options.maxUsd ?? projectDefaults?.maxUsd ?? cfg?.budget.defaults.maxUsd;
const maxSteps = options.maxSteps ?? projectDefaults?.maxSteps ?? cfg?.budget.defaults.maxSteps;
```

Test coverage in `cli/src/commands/build.ts`'s test surface (or a new `spend-roundtrip`-style fixture) confirms the order under all eight presence-combinations.

**Carry-forward — I009 interaction.** I009 (Telegram inbound `/build` doesn't inherit `[budget.defaults]`) becomes "Telegram inbound `/build` doesn't inherit project-level *or* instance-level defaults" once the project tier lands. The right fix for I009 still inherits all three tiers — this ADR doesn't fix I009 but makes the right shape clearer: every directive-creation path (CLI, channel inbound, Web UI build route) should run the same three-tier resolution. The natural extraction point is a shared `resolveDirectiveLimits(projectMeta, cfg, explicitFlags)` helper in `@factory5/brain` or `@factory5/wiki`. Out of scope here; recorded so the I009 fix at the right time picks up the cleanup for free.

### 5. Auth — same `FACTORY5_UI_TOKEN` bearer; no weaker check on mutations; CSRF out of scope

Mutations register under `/api/v1/*` like the read routes, gated by the same `requireUiAuth` preHandler that already wraps every read route (`packages/daemon/src/server.ts:629-636`). No weaker check; no per-mutation password / re-confirmation; no CSRF double-submit token. Reasoning:

- **Loopback-only.** Per ADR 0025 §2, requests come from a browser tab on `127.0.0.1`. The `isLoopback` preHandler rejects everything else (`packages/daemon/src/server.ts:687-695`). CSRF requires a malicious page on a *different* origin to forge a request to ours; same-origin loopback design forecloses that vector entirely.
- **Bearer not cookie.** Tokens live in `sessionStorage`, sent via `Authorization: Bearer`. A page on another origin can't forge that header (CORS preflight blocks it; cookie-based auth would be a different story). The "leaked-by-malicious-extension" risk is identical for reads and mutations; the right mitigation is tab-scoped storage + per-startup rotation, both already in place from ADR 0025.
- **No weaker mutation check.** Some patterns require re-confirmation (typing a project name) for destructive ops. Nothing in 11.2–11.4 is destructive in the rollback-impossible sense — answers can be amended by re-issuing if 409 returns; builds can be aborted; budget changes are PUT-replaceable. Re-confirmation would add ceremony with no security gain on a single-operator local dashboard.

If/when ADR 0025's deferred "cross-host access" lands, both CSRF and origin-check policies reopen — same conversation as the read routes, no extra mutation-specific decision then.

## Consequences

**Positive.**

- Three new routes implement against a fixed contract: 11.2 / 11.3 / 11.4 each become "register the schema, wire the handler, write tests" with no in-session re-litigation of envelope / verb / idempotency questions.
- The error envelope is the same `ipcErrorSchema` already in production. The SPA's `src/lib/api.ts` (added at 11.5) wraps fetch with a single envelope unwrapper covering both reads and mutations — the wrapper doesn't fork.
- `metadata.budgetDefaults` reuses ADR 0021's extension point — no migration, no new column, no schema change beyond a Zod helper. Clean parity with 10.8's `metadata.language`.
- Idempotency rules are explicit per route, not inferred. The answer route's same-payload-no-op + different-payload-409 closes the "what if the operator double-clicks or two operators answer simultaneously" question without operator-visible failure.
- Budget resolution gains a project tier without breaking any existing CLI-flag or config-tier behaviour. CLI flag still wins; config still loses; the new tier slots in exactly where operators expect (per-project < instance < explicit-override).
- Auth posture stays consistent — no weaker mutation check is a conservative default. If/when cross-host access lands, the conversation reopens once for both reads and mutations.
- Building the API around the same `resolveProjectPath` + `loadOrCreateProjectMetadata` chain that the CLI uses sets up a natural extraction at the directive-creation seam (also resolves I009 when picked up).

**Negative.**

- `POST /api/v1/builds { project: name }` couples the API to the CLI's name-resolution path (`resolveProjectPath`). If a future change makes name resolution ambiguous (multiple workspaces with same project names), the API inherits that pain. Mitigated: ADR 0021's identity-by-ULID model means the SPA can switch to ULID-as-payload (`POST /api/v1/builds { projectId }`) as a non-breaking schema extension — the server can accept either field; current single-workspace operators have one project per name in practice.
- `PUT /api/v1/projects/:id/budget` requires the SPA to know the project ULID before submitting, which forces a `GET /api/v1/projects` list endpoint to exist (or the SPA derives ULIDs from the spend / directives endpoints, both of which already echo `projectId`). Phase 11 adds the list endpoint as a small read-side addition at 11.4 or 11.5; not a fundamental cost.
- Same-bearer auth on mutations means a leaked `FACTORY5_UI_TOKEN` grants both read and write. Mitigated: token is loopback-bound + per-startup rotated; the leaked-token attacker already has local machine access, at which point read vs. write distinctions are weak.
- Budget tier ordering interaction with I009 is now load-bearing: once project-tier lands, the gap "Telegram inbound doesn't inherit defaults" feels worse because there are *two* tiers it skips instead of one. The fix is still a one-commit extraction; this ADR doesn't address I009 but raises its priority.
- Re-folding the answer/build/budget shapes into the existing `ipcErrorSchema` means the read-side error code surface grows in scope. Not an actual cost — just a point to keep an eye on as more routes land.

**Reversible?** Yes, layered.

- Remove the three route registrations → mutations 404, reads keep working, no schema migrations to roll back.
- Remove the build-path project-tier read in `cli/src/commands/build.ts` → revert to two-tier resolution; project.json files that already wrote `metadata.budgetDefaults` are silently ignored (forward-compatible).
- Remove `projectBudgetDefaultsSchema` + helper → ADR 0021's `metadata` is still an arbitrary record; nothing on disk corrupts.

No persistent state encodes any ADR-0027-specific shape: project.json's `metadata` is already a free-form record, and the `pending_questions.answer` write path is the same one channel collectors already use (no new column, no new table).

## Alternatives considered

- **`PUT /api/v1/pending-questions/:id { answer }` (resource-style answer).** Rejected per §1: posting an answer is an action with downstream side effects (worker resume, channel ack, orphan-detection log). Better expressed as a sub-resource action (`/answer`) than a partial update of the question. The verb mismatch surfaces clearly via the URL.

- **`POST /api/v1/projects/:id/builds`.** Rejected per §1: assumes the SPA pre-resolved a project name → ULID, which forces a project-list endpoint to exist before any build can be created and double-handles the project handle. `POST /api/v1/builds { project }` mirrors `factory build <name>` directly. The cost is one server-side `resolveProjectPath`, which the CLI already pays.

- **`PATCH /api/v1/projects/:id/budget` with partial-merge semantics.** Rejected per §1: re-introduces the `{ maxUsd: null }` ambiguity ("set to null" vs. "remove field"). RFC-9110 PUT with full-document replacement is unambiguous; the SPA's pre-filled form makes "send the whole document" cheap.

- **Client-supplied `Idempotency-Key` header on build creation.** Rejected per §2: deliberate operator action; SPA submit-disable handles the double-click case; a server-side dedup cache is per-startup state for negligible safety benefit. Revisit if a non-operator caller (CI / scripted API client) materialises.

- **`{ data: T }` success envelope (Stripe-style) instead of bare `{ <resource> }`.** Rejected: Phase 9 read routes already return bare resource envelopes (`{ items, total, … }`, `{ directive, timeline }`); mutations stay parallel. A `data:` wrapper would force a Phase-9 retrofit for one consistency gain and break existing read-side test fixtures.

- **A new mutation-only error envelope with `fields: Record<string, string>` instead of `details: Zod.issues`.** Rejected: read routes already return the Zod issues array via `details` for `SCHEMA_VALIDATION_FAILED`. Reusing it on mutations keeps the SPA wrapper uniform. The Zod issues array carries field paths; the SPA can render per-field errors by walking it.

- **One error code per validation case (`QUESTION_ANSWER_EMPTY`, `INVALID_LANGUAGE`, `INVALID_BUDGET`).** Rejected per §3: those cases already collapse into `SCHEMA_VALIDATION_FAILED` with the field path in `details`. Adding parallel codes duplicates the schema-issues pathway with no new switching power.

- **Promote `budgetDefaults` to a top-level field on `ProjectMetadata` (alongside `id`, `name`, `factoryVersion`).** Rejected: ADR 0021's `metadata` extension point is the established home for project-level flags; promoting `budgetDefaults` to top-level would set a precedent that 10.8's `language` should also have been top-level, churning two settled designs. The `metadata` cohort is intentional.

- **Resolve per-project budget defaults at directive-claim time, not at directive-creation time.** Tempting because it would let project-level defaults apply to *all* paths (CLI, Telegram inbound, future API) without each path having to opt in. Rejected for Phase 11: the budget enforcement layer (ADR 0020) reads `directive.limits` at pre-call time; lazy resolution would either pick up the default at claim time (ambiguous: which project context applies then?) or never (regression). The right shape is: every directive-creation path resolves all three tiers up front, and the brain's pre-call check stays the single enforcement site. I009's resolution would extract a shared resolver, not change the enforcement seam.

- **CSRF double-submit token on mutations.** Rejected per §5: same-origin loopback design forecloses CSRF. Bearer-token auth (vs. cookie auth) is the relevant defense. Re-evaluate when ADR 0025's deferred cross-host access lands.

- **Re-confirmation step for budget-change mutations ("type the project name to confirm").** Rejected per §5: not destructive in a non-recoverable sense (PUT replaces; changes can be reverted by another PUT). Adds ceremony without security gain.

- **`DELETE /api/v1/projects/:id/budget` to clear all defaults.** Conditionally rejected: `PUT {}` already does this. A `DELETE` would be redundant. If a future curl-scripting workflow finds `PUT {}` awkward, adding `DELETE` is a non-breaking extension.

- **A separate `mutationErrorSchema` with required `actionable: boolean` + `retryable: boolean` flags.** Rejected: the SPA can derive both from the error code. Encoding policy in the wire envelope is more rigid than necessary; codes leave the policy on the SPA where it belongs.

## Implementation outline (11.2–11.4)

Sub-step mapping (mirrors `.control/phases/phase-11-web-ui-9b/steps.md`):

- **11.2 — Answer route.** New schemas in `@factory5/ipc/schemas.ts`:
  ```ts
  export const apiV1AnswerPendingQuestionRequestSchema = z.object({
    answer: z.string().min(1),
  });
  export const apiV1AnswerPendingQuestionResponseSchema = z.object({
    question: pendingQuestionSchema,
  });
  ```
  New route `POST /api/v1/pending-questions/:id/answer` in `packages/daemon/src/server.ts` after the GET-detail route, sharing the `requireUiAuth` preHandler. Handler: `pendingQuestions.getById` + branch on `answeredAt` / `answer` per §2; call `pendingQuestions.answer` on the new-or-same-answer path; throw `IpcRequestError(409, 'QUESTION_ALREADY_ANSWERED_DIFFERENTLY', …)` on the different-answer path; call `detectOrphanedAnswer` and log the warning either way (matches Telegram / Discord channel-collector parity). Tests in `server.test.ts`: happy path, idempotent re-POST, 409 conflict, 404 unknown id, 400 empty body (Zod path), 401 missing token.

- **11.3 — Build route.** New schemas:
  ```ts
  export const apiV1CreateBuildRequestSchema = z.object({
    project: z.string().min(1),
    language: z.enum(['python', 'node', 'go', 'rust']).optional(),
    autonomy: autonomyModeSchema.optional(),
    limits: directiveLimitsSchema.optional(),
  });
  export const apiV1CreateBuildResponseSchema = z.object({
    directive: directiveSchema,
  });
  ```
  New route `POST /api/v1/builds`. Handler reuses `resolveProjectPath` + `loadOrCreateProjectMetadata` + `directivesQ.insert` from `packages/cli/src/commands/build.ts`. The shared directive-creation logic should be extracted to `@factory5/brain` (or `@factory5/wiki`) so both CLI and API share one path; pick the home at 11.3 implementation. Tests: happy path with explicit limits; language fallback from `metadata.language`; budget resolution from `metadata.budgetDefaults` (depends on 11.4 having landed first, or 11.3's tests stub the project meta); 404 unknown project; 422 corrupt project metadata; 401 missing token.

- **11.4 — Budget route.** Adds `projectBudgetDefaultsSchema` to `@factory5/core/schemas.ts`. Adds `budgetDefaultsFromProjectMeta` helper to `@factory5/wiki/project-metadata.ts`. New schemas in `@factory5/ipc/schemas.ts`:
  ```ts
  export const apiV1UpdateProjectBudgetRequestSchema = projectBudgetDefaultsSchema;
  export const apiV1UpdateProjectBudgetResponseSchema = z.object({
    projectId: ulidSchema,
    budgetDefaults: projectBudgetDefaultsSchema,
  });
  ```
  New route `PUT /api/v1/projects/:id/budget`. Handler: look up `:id` in the `projects` registry → `workspacePath`; throw `PROJECT_NOT_FOUND` if absent; read `project.json` (throws `PROJECT_PATH_UNREADABLE` on ENOENT, `PROJECT_METADATA_CORRUPT` on a `ProjectMetadataCorruptError`); replace `metadata.budgetDefaults` with the request body (full-document); write back atomically via the existing `writeFileAtomic` pattern. Update `cli/src/commands/build.ts` budget resolution to read project-tier between flag and config. Tests: round-trip read/write; PUT with partial body removes omitted fields; PUT empty body clears all defaults; 404 unknown ULID; 404 unreadable workspace path; 422 corrupt project.json; build-resolution test confirming three-tier order across all eight presence combinations.

- **11.5 — SPA write affordances.** Per the charter; uses the schemas above and the centralised `src/lib/api.ts` envelope handler. Each form maps to one route + one error-code switch. Out of scope for this ADR.

`@factory5/ipc/schemas.ts` gains six new exports (request + response schemas for each route). `@factory5/core/schemas.ts` gains `projectBudgetDefaultsSchema`. `@factory5/daemon/server.ts` gains three new route registrations alongside the existing read routes.

`CompleteArchitecture.md` gets either a §23 (new section) or a §21 extension at 11.7 phase-close — pick at that time based on which fits the existing flow better — pointing back at this ADR.
