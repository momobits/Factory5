# Phase 10 Steps

- [x] 10.1 — Open U030 in `UPGRADE/ISSUES.md` Open section. Severity medium; Tier 10; Area web + brain.
- [ ] 10.2 — ADR 0031: log-forwarder design — pin manual `emitLogLine` sites as first-ship; pino-transport-tap and hybrid listed as alternatives considered. Update `docs/decisions/INDEX.md`.
- [ ] 10.3 — Brain emit sites — add `emitLogLine` calls in `architect.ts`, `planner.ts`, `pool.ts`, `loop.ts` per the plan's table. `planner.ts:331` parse-fail and `:335` Zod-fail both emit `error`-level lines with first 500 chars of LLM response in `attrs.detail`. Extend `loop.test.ts` with happy-path emission assertions + a regression test for the planner parse-fail surfacing the error line.
- [ ] 10.4 — Daemon `POST /api/v1/directives/:id/resume` — mirror `packages/cli/src/commands/resume.ts` logic over HTTP. New `apiV1ResumeRequestSchema` + `apiV1ResumeResponseSchema` in `packages/ipc/src/`. Bearer-auth + Zod body validation pattern from `/api/v1/builds`. 404 on missing prior; 409 on prior `running`/`pending`; 422 on prior `projectPath` not on disk. Integration test in `packages/daemon/test/` mints a prior, POSTs to resume, asserts `parentDirectiveId` + `payload.resumeFrom` chain on the child + doorbell emission.
- [ ] 10.5 — UI Resume button — `apps/factory-web/src/pages/directives/detail.astro` renders a Resume button next to the title when `effectiveStatus()` ∈ `failed | blocked | complete`, parallel to the existing Cancel control. `apps/factory-web/src/pages/projects/index.astro` gains a per-row "Resume" link visible when the project's most recent directive is terminal-non-complete. On-click POSTs to `/api/v1/directives/<id>/resume`; on 2xx navigates to the new directive's detail page.
- [ ] 10.6 — UI activity panel refinements — level badges (info neutral / warn amber / error red, using design tokens); empty state "Waiting for the brain to narrate…" when zero `log.line` events have arrived on a `running` directive; existing auto-scroll-pin / "Resume tailing" preserved.
- [ ] 10.7 — `/phase-close` — verify all done-criteria checkboxes flip; tag `phase-10-resume-and-activity-feed-closed`; append final session entry to `UPGRADE/LOG.md`; transition STATE back to "all phases complete" (seventh time) unless a Tier 11 demand signal arrives.

## Step detail

### 10.1 — open U030

`UPGRADE/ISSUES.md` Open section gets:

```
## U030 — no UI surface for resume; activity panel silent on build directives
Severity: medium · Tier: 10 · Area: web + brain
Symptom: operator viewing /app/directives/detail?id=<failed-build> sees no recovery action and no narrative of why/where it failed. CLI has `factory resume <project>`; daemon has SSE log.line schema; brain emits log.line from one site only.
Hypothesis: SSE plumbing complete from Phase 3; daemon route needed mirror of resume.ts logic; brain needs broader emitLogLine coverage.
```

Commit shape: `chore(10.1): open U030`.

### 10.2 — ADR 0031 — log-forwarder design

Six-section ADR shape:
- **Context** — Phase 3 ADR 0029 schema'd `log.line`; the brain emits only at one site today.
- **Decision** — explicit `emitLogLine` calls at brain-stage entry / exit / error sites. Format: `level`, `component: 'brain.<stage>'`, `msg: <human readable>`, `attrs?: <structured>`. Errors carry first 500 chars of any offending LLM output as `attrs.detail`.
- **Consequences** — manual sites must be maintained; new brain stages need authors to remember; tests must assert emission at narrative sites.
- **Alternatives considered** — Pino transport tap (auto-mirror by `directiveId` binding); hybrid (manual + auto). Both deferred — pino tap risks bloating the stream with `debug` lines + large pino fields; needs throttling design.
- **Open follow-ups** — Tier 11 candidate: pino auto-tap with allow-list filtering; per-directive log persistence (today SSE is ephemeral).

Commit shape: `docs(10.2): ADR 0031 — log-forwarder design`.

### 10.3 — brain emit sites

Sites enumerated in the tier plan. Pattern at each site:

```ts
emitLogLine(opts.emitDirectiveEvent, directive.id, 'info', 'brain.architect', `architect: calling ${resolution.model}`);
```

For the planner error sites (`:331`, `:335`):

```ts
const detail = response.text.slice(0, 500);
emitLogLine(opts.emitDirectiveEvent, directive.id, 'error', 'brain.planner', 'planner: no JSON in response', { detail });
throw new Error(`planner: response contained no JSON object. First 500 chars: ${detail}`);
```

Test additions in `loop.test.ts`:
- happy-path triage + architect-call + planner-call emissions
- regression: malformed planner output → `error` level event with `attrs.detail` set

Commit shape: `feat(10.3): brain emitLogLine narrative sites`.

### 10.4 — daemon resume route

New section in `packages/daemon/src/server.ts` modelled after `/api/v1/builds` block (around `:823-:914`):

```ts
app.post<{ Params: { id: string } }>('/api/v1/directives/:id/resume', async (request, reply) => {
  requireUiAuth(request, opts.uiAuthToken);
  const body = apiV1ResumeRequestSchema.parse(request.body ?? {});
  const prior = directivesQ.getById(opts.db, request.params.id);
  if (prior === undefined) throw new IpcRequestError(404, 'DIRECTIVE_NOT_FOUND', `directive ${request.params.id} not found`);
  if (prior.status === 'running' || prior.status === 'pending') {
    throw new IpcRequestError(409, 'DIRECTIVE_NOT_TERMINAL', `directive ${prior.id} is ${prior.status} — cancel it first`);
  }
  // ... extract projectPath / projectId / language from prior payload (mirror resume.ts:33-139)
  // ... mint child directive with parentDirectiveId + payload.resumeFrom
  // ... directivesQ.insert + doorbell.emit('directive.new', ...)
  // ... reply with apiV1ResumeResponse
});
```

New schemas in `packages/ipc/src/`:

```ts
export const apiV1ResumeRequestSchema = z.object({
  autonomy: z.enum(['assisted', 'autonomous']).optional(),
});
export const apiV1ResumeResponseSchema = z.object({
  directive: directiveSchema,
});
```

Integration test mints a prior `failed` directive, POSTs to resume, asserts child directive shape including `parentDirectiveId` + `payload.resumeFrom` + doorbell event. Negative tests: 404 missing prior, 409 prior `running`, 422 prior `projectPath` not on disk.

Commit shape: `feat(10.4): POST /api/v1/directives/:id/resume`.

### 10.5 — UI resume surfaces

`detail.astro`:
- Add `resumeInflight: boolean` and `resumeError: string | null` to `PageState`.
- Render `<button class="resume-btn">Resume</button>` in `titleRow` when `effectiveStatus()` is `failed`/`blocked`/`complete`, parallel to `buildCancelControl()`.
- On click: `await apiPost(\`/api/v1/directives/${directiveId}/resume\`, {})`; on 2xx response shape, `window.location.href = \`/app/directives/detail?id=${response.directive.id}\``.
- Mirror cancel's inline-error pattern: render `state.resumeError` above the title when set.

`projects/index.astro`:
- Augment the per-row data fetched by the page to include the project's most-recent directive status + id (one extra field on the projects endpoint, OR fetch via `/api/v1/directives?project=<name>&limit=1`).
- When that directive's status is terminal-non-complete, render a "Resume" link in the workspace cell after the existing path display.

Commit shape: `feat(10.5): UI resume button + project-row resume link`.

### 10.6 — activity panel refinements

`detail.astro` log-tail rendering:
- Add a small `<span class="log-level">` next to component, using `--acid` (info), `--amber` (warn), `--halt` (error) tokens.
- When `state.logLines.length === 0 && effectiveStatus() === 'running'`, render the empty-state hint inside the log-tail box. Replace it on first event arrival.

Commit shape: `feat(10.6): UI activity panel level badges + empty state`.

### 10.7 — phase close

Verify all done-criteria, including a live Playwright MCP browser smoke. Tag `phase-10-resume-and-activity-feed-closed`. Append LOG entry. Flip STATE to arc-complete (seventh time).

Commit shape: `chore(phase-10): close phase 10, kick off arc-complete (seventh time)`.
