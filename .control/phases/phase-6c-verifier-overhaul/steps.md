# Phase 6c Steps — Verifier overhaul

- [ ] 6c.1 — Reproduce F001 in a unit test (red)
- [ ] 6c.2 — Write ADR 0018 deciding authoritative vs advisory
- [ ] 6c.3 — Implement the chosen path
- [ ] 6c.4 — Rewrite `prompts/agents/verifier.md` to match
- [ ] 6c.5 — Make the F001 regression test pass (green)
- [ ] 6c.6 — Update `docs/Phase6_Progress.md` §"recommended first sub-phase" to reflect outcome
- [ ] 6c.7 — Live validation — `factory build example --autonomy autonomous --concurrency 2`
- [ ] 6c.8 — Append `docs/PROGRESS.md` entry + `/phase-close`

## Sub-step detail

### 6c.1 — Reproduce F001 in a unit test (red)

**Where:** `packages/worker/test/verifier-f001.test.ts` (or colocate as `packages/brain/src/verifier.test.ts` if a verifier-specific module exists).

**What:** mount a fixture workspace that matches the 2026-04-19 state — `src/models.py`, `src/api.py`, `src/formatter.py`, `src/cli.py`, `tests/test_*.py`, `pyproject.toml` all present on main. Invoke whatever code path the brain uses to produce verifier findings. Assert that the current implementation **does** produce a CRITICAL finding claiming absence (red) — this proves we're reproducing F001 before the fix.

After the fix lands in 6c.3, this test's final assertion flips: verifier must **not** produce a finding claiming absence.

**Commit:** `test(6c.1): red reproducer for F001 verifier hallucination`

### 6c.2 — Write ADR 0018

**Where:** `docs/decisions/0018-verifier-authoritative-or-advisory.md`. Use ADR 0017 as the shape reference (it's the most recent, 223 lines, right depth).

**Decision to make:** authoritative (give verifier Read/Glob/Grep, keep its gate contribution) vs advisory (strip its gate contribution, scope its prompt to non-filesystem claims).

**Arguments for authoritative:** mirrors builder's tool surface → less architectural divergence; verifier can do real cross-cutting checks the assessor won't (docstring coverage, cross-file invariants, naming consistency); finding-raising against real files adds signal.

**Arguments for advisory:** cheaper — no extra tool invocations, fewer LLM turns; gate calculation stays crisp (assessor = ground truth, period); limits scope to what the verifier can actually do well without re-inventing the assessor; faster to implement.

**Expected outcome:** **advisory path** is likely the right call — it matches the existing ground-truth-via-assessor architecture and this phase's $4–6 budget. But the ADR must argue it on its merits, not just pick the cheap one.

Update `docs/decisions/INDEX.md` with the new ADR row.

**Commit:** `docs(6c.2): ADR 0018 — verifier becomes advisory-only` (or authoritative if that's the pick)

### 6c.3 — Implement the chosen path

**Advisory path implementation sketch:**

- In `packages/brain/src/loop.ts` (or wherever findings roll into gate calc): filter out `source: "verifier"` findings from gate contribution. They still persist to `wiki.addFinding`, still show in `factory findings`, but no longer flip `gate.verify`.
- Tag verifier-sourced findings with a new field `advisory: true` (add to `core` Finding schema in `packages/core/src/schemas.ts`, wire through).
- Consider: should verifier findings be a separate severity ceiling? E.g. cap at WARNING. Decide in the ADR.

**Authoritative path implementation sketch:**

- In `packages/brain/src/agents.ts` (or wherever agent tool allowlists are): add `Read`, `Glob`, `Grep` to verifier's allowlist.
- Update `packages/worker/src/runWorker.ts` to pass these through for verifier runs.
- Evidence-citation discipline enforced at the prompt level (6c.4).

**Commit:** `feat(6c.3): <authoritative|advisory>-verifier implementation`

### 6c.4 — Rewrite `prompts/agents/verifier.md`

Replace the 6-line Phase 1 stub with a real prompt. It must state:

- What the verifier is for (post-builder, post-assessor second-opinion pass; **not** ground-truth on file presence).
- What claims the verifier may/may not make, given its tool surface after 6c.3.
- Evidence discipline (authoritative path: cite file path + line number for every finding; advisory path: scope to architectural/observation claims).
- Explicit anti-hallucination rule — do not claim absence of files; if uncertain, say "unverified" or don't raise.

Reference: factory5's `prompts/agents/builder.md` and `prompts/agents/architect.md` for shape.

**Commit:** `docs(6c.4): rewrite verifier prompt — evidence discipline + anti-hallucination`

### 6c.5 — Make F001 regression test pass (green)

Flip the 6c.1 assertion: verifier must **not** produce a filesystem-absence CRITICAL against the fixture workspace. Run `pnpm test` for affected packages — expect full green across the 255 existing tests plus the new regression.

**Commit:** `test(6c.5): F001 regression — verifier no longer hallucinates absence`

### 6c.6 — Update `docs/Phase6_Progress.md`

Flip the 6c row status to ✅. Add a brief outcome note under "Recommended first sub-phase" — which path ADR 0018 picked and why. Link the ADR.

**Commit:** `docs(6c.6): Phase 6c outcome — verifier <path> shipped`

### 6c.7 — Live validation

Run against a fresh workspace:

```bash
cd /c/Users/Momo/factory5-v6c-example
factory build example --autonomy autonomous --concurrency 2
```

Expect:

- `terminalStatus: complete`
- `gate: {build: true, integration: true, verify: true}`
- Zero verifier-sourced CRITICAL findings in `<workspace>/example/.factory/findings.json`
- No finding where verifier contradicts assessor

If the live run reveals a new issue, file it in `docs/issues/I008-*.md` (continuing factory5's INNN sequence) and decide whether it blocks Phase 6c close or becomes Phase 6c-residue to track into 6a/6b.

**Commit:** `test(6c.7): live validation on <directive-id> — verifier <path> clean`

### 6c.8 — Close Phase 6c

1. Append to `docs/PROGRESS.md` a new section dated today:
   ```
   ## <YYYY-MM-DD> — Phase 6c — verifier overhaul shipped
   ```
2. Run `/phase-close`. Control will:
   - verify done criteria
   - tag `phase-6c-verifier-overhaul-closed`
   - scaffold `.control/phases/phase-6a-findings-registry/steps.md` with real detail (seeded from `phase-plan.md`)
   - update STATE.md to point at 6a
   - write the kickoff prompt to `.control/progress/next.md`

**Commit:** `chore(phase-6c): close Phase 6c, kick off Phase 6a`
