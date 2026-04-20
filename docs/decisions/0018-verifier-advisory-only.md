# 0018 — Verifier becomes advisory-only (findings don't block the gate)

- **Status:** Accepted
- **Date:** 2026-04-21

## Context

The Phase 5f close-out live run (directive `01KPKRNB2V08QZZD02SKTK6MWP`,
2026-04-19, workspace `/c/Users/Momo/factory5-v5f-example-2`) produced
F001 — a verifier-raised CRITICAL finding claiming six Python source
files (`src/models.py`, `src/api.py`, `src/formatter.py`, `src/cli.py`,
`tests/`, `pyproject.toml`) were absent from the project. All six files
existed on main. The assessor's gate was green (build: true,
integration: true, verify: true; 78 tests passed) so the build still
shipped `complete`, but the false CRITICAL is on the books and visible
in `factory findings`. The reproducer (step 6c.1,
`packages/worker/src/verifier-f001.test.ts`, commit `c35681a`) shows the
mechanism: the verifier is a read-only agent whose prompt
(`prompts/agents/verifier.md`, 6-line Phase 1 stub) instructs it to
"Run the full verification checklist" without constraining what
evidence is required — and `packages/worker/src/run-worker.ts`'s
`persistFindings` passes parsed findings through to `addFinding`
without any cross-check against the filesystem. An LLM answering "is
this project scaffolded?" with "no, all the files are missing" lands
as a CRITICAL that flips `gate.verify: false` even when the assessor's
objective ground truth says otherwise.

Today's verifier tool surface, per `packages/brain/src/agents/registry.ts`:

```ts
verifier: {
  role: 'verifier',
  category: 'planning',
  tools: ['Read', 'Bash', 'Glob', 'Grep'],   // declared but …
  defaultSkills: ['work-verification', 'integration-testing', 'documentation'],
  promptPath: 'verifier.md',
},
```

— the tools are declared but unused: `isToolUsingAgent(role)` in
`run-worker.ts` returns `false` for verifier, so it goes through
`runReadOnly()` (single-shot `provider.call()`, no worktree, no tool
invocation). The verifier is effectively read-only **in behaviour**
regardless of the declaration. That is the seam this ADR addresses.

Two paths were charted in the Phase 6c plan:

1. **Authoritative.** Flip `isToolUsingAgent('verifier')` to true, give
   the verifier a worktree, let it actually use Read/Glob/Grep. Rewrite
   the prompt to require evidence citations for every claim. Keep the
   verifier's contribution to the gate.
2. **Advisory.** Keep the verifier read-only. Strip its contribution
   from `brain.loop`'s gate calculation. Rewrite the prompt to scope
   its claims to what it can legitimately make from context alone
   (architectural observations, consistency checks, docstring
   suggestions). Tag its findings `advisory: true` so operators and
   downstream display code can distinguish.

The tension is between two valid instincts: authoritative keeps the
verifier's **potential signal** (cross-cutting architectural checks the
assessor will never do) and matches the builder's tool-using shape;
advisory keeps the verifier's **scope honest** and the gate crisp
(assessor = ground truth, no second opinion contradicts).

## Decision

Ship the **advisory path** in Phase 6c. Three changes:

1. **Gate filter.** In `packages/brain/src/loop.ts` (wherever findings
   roll into `gate.verify`), filter out `source === 'verifier'`
   findings. The verifier **cannot** block a build. Assessor gate
   results remain the sole ground truth for `gate.build`,
   `gate.integration`, `gate.verify`.

2. **Explicit `advisory` flag on the Finding schema.** Extend
   `findingSchema` in `packages/core/src/schemas.ts` with an optional
   `advisory: z.boolean().optional()` field. `addFinding` in
   `packages/wiki/src/findings.ts` defaults `advisory` to `true` when
   `source === 'verifier'`, leaves it `undefined` (treated as `false`)
   for every other source. Operators, `factory findings` display, and
   `BUILD.md` rendering can branch on the flag; gate logic branches on
   `source` (the flag is the observable signal, not the enforcement
   point).

3. **Keep the verifier read-only.** No change to `isToolUsingAgent`,
   no change to the declared `tools` list in `registry.ts` (the
   declaration is dormant; leaving it avoids a merge-adjacent change).
   Step 6c.4 rewrites `prompts/agents/verifier.md` to scope claims to
   what the verifier can legitimately make without a worktree, and
   adds an anti-hallucination rule ("do not claim absence of files; if
   uncertain, say 'unverified' or don't raise").

**Severity is not capped.** A verifier-raised CRITICAL is still a
CRITICAL in `findings.json` and in `factory findings` output; the
advisory flag and the gate filter already make it non-blocking, so
additionally stripping severity would destroy legitimate signal (a
verifier legitimately spotting, say, a cross-file architecture
violation that happens to be critical in the operator's judgement).
The operator — not the gate — is the consumer of severity for
advisory findings.

## Consequences

**Positive:**

- **F001 becomes unreproducible as a blocker.** Even if the verifier
  LLM again hallucinates absence of files, the false CRITICAL lands in
  `findings.json` with `advisory: true` and the gate is unaffected. The
  `phase-6c` live-validation step (6c.7) runs without verifier-induced
  gate failures.
- **The gate's contract matches the code.** "Assessor is ground truth"
  was already the Phase 5 architecture in spirit; this ADR removes the
  accidental exception.
- **Verifier prompt can be narrowed to what it actually does well.** No
  more asking a read-only agent to make filesystem claims. 6c.4's
  prompt rewrite has room to be honest about what's in-scope.
- **Budget fits.** Implementation is two small diffs (schema +
  loop.ts) plus a prompt rewrite — single-session scope. Tier-1 in
  ambition, but closes the concrete failure mode.
- **The `advisory` flag is a reusable affordance.** If a future ADR
  introduces non-blocking observations from other agents (reviewer
  style notes, investigator hypotheses), they can reuse the flag
  without further schema churn.

**Negative:**

- **Verifier's gate-level signal is gone.** If the verifier ever
  legitimately catches something the assessor missed, the build still
  ships. The mitigation is that the assessor runs real tests — any
  regression the verifier would catch that the assessor wouldn't is by
  definition not test-observable (style, architecture, naming), and
  those are the kinds of issues where "informational, operator
  reviews" is the right shape anyway.
- **Two signal tiers on findings.json.** Consumers (`factory findings`,
  `BUILD.md` renderer, any future UI) must learn to distinguish
  advisory from blocking. Mitigated by the explicit flag — it's a
  single predicate, not a folklore rule.
- **Does not close the verifier hallucination at its source.** The
  verifier can still output incorrect text; we just stop acting on it
  as a gate input. The operator still sees garbage in `factory
findings` if the prompt isn't tightened. 6c.4 addresses the prompt
  side; this ADR addresses the gate side. Both are needed.
- **Leaves verifier's declared tool allowlist dead.** `registry.ts`'s
  `tools: ['Read', 'Bash', 'Glob', 'Grep']` is unused at runtime. A
  future housekeeping pass can trim it, but doing so in this ADR's
  scope would invite merge churn against Phase 6a/6b's changes.

**Reversible?** Yes. The `advisory` field is optional; consumers that
don't know about it keep working. The gate filter is a two-line
predicate in `loop.ts`. Reverting requires removing the filter and
optionally flipping `isToolUsingAgent` to `true` + rewriting the prompt
again. A future ADR that wants authoritative verification (ADR 0019+)
can supersede this.

## Alternatives considered

- **Authoritative path — give the verifier a worktree and real
  tools.** Rejected for Phase 6c. The authoritative path has real
  appeal: it makes the verifier's declared tool surface honest, it
  mirrors the builder's shape, and at its best it catches cross-cutting
  architectural issues the assessor cannot. But it does not close F001
  at the root: an LLM with Read/Glob/Grep can still hallucinate ("I
  checked and src/ is empty" when it isn't). Closing F001 via the
  authoritative path requires (a) a worktree, (b) a tool-using agent
  loop, (c) an evidence-citation prompt protocol, (d) a parser that
  validates citations against the worktree's actual state, and (e) a
  rejection mechanism when citations don't resolve. Any one of those is
  a phase-sized chunk; all four together cannot fit the Phase 6c
  budget. The advisory path closes F001 today; the authoritative path
  is preserved as a future possibility (ADR 0019+) if a concrete need
  for blocking verifier claims emerges.

- **Cap verifier severity at WARNING.** Rejected. Caps destroy signal
  and misrepresent the verifier's intent. If the LLM's confidence
  warrants CRITICAL (even in an advisory context), the operator
  benefits from seeing the severity as-declared rather than as-capped.
  The gate filter is the enforcement; severity is best-effort
  information.

- **Branch on `source === 'verifier'` in gate calc without adding the
  `advisory` flag.** Rejected as sole implementation. Source-based
  branching hard-codes verifier semantics into gate logic and leaves
  display code (`factory findings`, BUILD.md) having to re-derive the
  same rule. Keeping both the filter (enforcement) and the flag (data
  signal) avoids teaching each consumer the same rule separately.

- **Do nothing; let the assessor's green gate override verifier
  CRITICALs.** Rejected — that's the status quo and it ships false
  CRITICALs to `factory findings`. Operators see misleading signal; a
  future reader of the findings log cannot tell a verifier
  hallucination from a real CRITICAL the operator must act on.

- **Remove the verifier agent role entirely.** Rejected. There is real
  scope for a second-opinion pass that catches architectural and
  consistency issues the test-running assessor won't. The problem is
  not that the verifier exists; it's that it asserts into the gate
  without evidence. Advisory mode preserves the opportunity while
  stripping the blocking behaviour.

## Implementation notes

- **Finding schema change** (step 6c.3): add optional `advisory` to
  `findingSchema` in `packages/core/src/schemas.ts`. Unit tests in
  `packages/core/src/schemas.test.ts` get one new case: parses a
  finding with `advisory: true`, parses one without (backwards-compat).
- **`addFinding` default** (step 6c.3): when `input.source === 'verifier'`
  and `input.advisory` is undefined, default to `true`. When explicitly
  set to `false` by a caller, respect it. Wiki tests get one new case.
- **Gate filter** (step 6c.3): in `packages/brain/src/loop.ts` gate
  computation, the predicate that rolls open CRITICAL/HIGH findings
  into `gate.verify === false` now ignores `f.source === 'verifier'`.
  Document the predicate inline.
- **Verifier prompt rewrite** (step 6c.4): scope claims to
  non-filesystem-presence observations; add anti-hallucination rule;
  explicitly state that verifier findings are advisory. Reference this
  ADR from the prompt body.
- **Regression test** (step 6c.5): the 6c.1 reproducer flips — the
  scripted hallucination still persists (the LLM's claim isn't
  silenced) but the persisted finding has `advisory: true` and the
  hypothetical gate calculation does not include it. A second
  assertion pair validates: a non-verifier finding with the same shape
  is still blocking.
- **Display-layer propagation** (future, out of 6c scope): `factory
findings` and `BUILD.md` renderers should annotate advisory findings
  visibly ("[advisory]" badge or similar). Not required for 6c close;
  captured as Phase 6a/6b follow-on if the findings registry touches
  the renderer.
