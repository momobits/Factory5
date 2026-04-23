# Next session — paste this to start

Phase 9 (Web UI) closed 2026-04-23 — tag `phase-9-web-ui-closed`.
Phase 10 (Assessor tier-3) is queued; 10.1 opens next.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase / step
/ carry-forwards), then the Phase 10 charter at
`.control/phases/phase-10-assessor-tier3/README.md` and its sub-step
outline at `.control/phases/phase-10-assessor-tier3/steps.md`.

For background on the provisioner abstraction ADR 0026 extends, skim
`docs/decisions/0017-assessor-project-env-provisioning.md` (tier-1 / tier-2,
Python-only today). Also skim `packages/assessor/src/` to see how the
current Python runtime is wired — ADR 0026 builds on that shape, doesn't
replace it.

Run `/session-start` for the full drift check.

## Next concrete work — sub-step 10.1 (ADR 0026)

Author `docs/decisions/0026-pluggable-runtime-contract.md` covering:

1. **Provisioner shape.** Does the provisioner fully own the project's
   env (install deps + configure typecheck tools) or does it expect the
   project runnable out-of-the-box (the assessor just runs the gate
   commands)? Python (ADR 0017, tier-2) owns the venv. Node / Go / Rust
   likely benefit from _not_ owning — `package.json` / `go.mod` /
   `Cargo.toml` are the env. Pin a decision + the rationale.
2. **Verify-gate command mapping.** Which commands count as the "did
   this project build + pass tests" signal per runtime? Draft:
   - Node: `pnpm install → pnpm typecheck || tsc --noEmit → pnpm test`.
   - Go: `go build ./... && go test ./...`.
   - Rust: `cargo test`.
   - Edge cases to name: projects with no `typecheck` script,
     workspace monorepos, optional doc-test gates.
3. **Failure-mode taxonomy.** How does the assessor distinguish compile
   failure vs. test failure vs. env-setup failure vs. missing tool?
   Today's finding taxonomy (severity + tag) has to encode this
   uniformly across runtimes so the Phase 9 findings UI stays
   runtime-agnostic. Propose tags: `BUILD_FAILURE`, `TEST_FAILURE`,
   `ENV_SETUP_FAILURE`, `ENV_HOST_MISSING_TOOL`.
4. **Host-tool pre-flight.** What does the failure look like when
   `node` / `pnpm` / `go` / `cargo` is missing from PATH? Probably
   `ENV_HOST_MISSING_TOOL` finding + WONTFIX default + operator-facing
   error; blocking until resolved. Consistent across all three
   runtimes.

Update `docs/decisions/INDEX.md` with the new ADR row. Commit as
`feat(10.1): ADR 0026 — pluggable-runtime contract` (or `docs(10.1)`
— the ADR is docs-only at this step, though it sets up 10.2+ code).

## Then 10.2 — Node/TypeScript runtime

Concrete work starts in earnest. New
`packages/assessor/src/runtimes/node.ts` implementing the
`ProjectEnvProvisioner` interface per ADR 0026. Verify gate wires the
commands ADR 0026 pinned. One integration test under
`packages/assessor/test/node-e2e.test.ts` that seeds a minimal TS
project, runs the assessor end-to-end, asserts the finding shape.
Cross-platform — no skipping on Windows or Linux.

Follow with 10.3 live validation: `factory build` against a real spec
("build a TypeScript CLI that parses a JSON log file and prints
totals" or similar), confirm the build completes, the assessor's
gate passes, spend stays under the autonomy-mode ceiling.

## Carry-forward from Phase 9

- **Issue I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound
  doesn't inherit `[budget.defaults]`. Non-blocking.
- **Issue I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO
  matcher can't target a specific open question. Non-blocking.
- **Stale-dist dev-loop gotcha** (`docs/Phase9_Progress.md`
  §Non-trivial finding) — recommendation: flip
  `packages/{daemon,ipc,state}/package.json` `main` from
  `"./dist/index.js"` to `"./src/index.ts"`. `tsx` transpiles on
  demand; prod `pnpm build` still produces `dist/` for downstream
  consumers. One-line per package. Highest-ROI Phase 10 cleanup item.
- **`factory ui-token` CLI command** (ADR 0025 §2) — small IPC route
  on factoryd + `packages/cli/src/commands/ui-token.ts`. Operator who
  closes the terminal loses the URL today; mitigation is restart
  factoryd.
- **Fastify preHandler scoped to `/api/v1/*`** — ADR 0025 §3 described
  a shared preHandler; 9.3 chose inline handler-level checks. Purely
  stylistic refactor; effect is identical.
- **Phase 6 operator follow-up** (still unchanged, still non-blocking):
  revoke PAT at <https://github.com/settings/tokens>;
  `gh repo delete momobits/factory5-6b-smoke --yes`;
  `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

Report back on wake-up with a status block in this shape:

```
Phase 10 — 0/9 closed; 10.1 ADR 0026 next
Last action: Phase 9 closed 2026-04-23 — tag phase-9-web-ui-closed
Git: branch=main, last=<latest-sha> (session-end docs(state) on top of e360436), uncommitted=no, tag=phase-9-web-ui-closed
Open blockers: 0 (I009 + I012 are non-blocking carry-forward)
Proposed next action: 10.1 — author ADR 0026 (pluggable-runtime contract)
Ready to proceed?
```
