# Phase 5 — progress & roadmap

> Phase-level overview of the Phase 5 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 5
> (what's done, what's next, what "done" looks like).

## Where we were, before Phase 5

End of Phase 4 (2026-04-18): factory has a real daemon, a Discord channel,
assisted-mode checkpoints, `ask_user` / `escalate_blocked` primitives, 201
green tests. **The single live `factory build` exercise (Phase 2 finale)
was a 5/14 task-success run**, blocked by three planner-level failure modes
documented in ADR 0016:

1. Category drift — planner picked `quick` (Haiku) for `builder` tasks
2. File-ownership collisions — two builders writing `src/foo.ts` concurrently
3. `max-turns: 20` too tight for large builders

## Phase 5 scope

Lift factory out of "infrastructure verified" into **"produces a
green verify gate on a real project, end to end, autonomously."** Three
sub-phases planned; two shipped.

| Sub-phase                | Status                  | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5a**                   | ✅ Shipped              | ADR 0016: `materialisePlannerTasks` (category floor + file-ownership deps + per-task `maxTurns`); planner prompt rewrite; 214 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **5b**                   | ✅ Validated            | Live run against fresh workspace; 6/6 tasks succeeded, `adjustments: 0`, $7.68, built code passes 114 pytest tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **5c**                   | 🟡 Partial              | ADR 0017 (shared assessor env provisioning) + I001 prompt-tuning shipped; live run 6/6, 129 pytest pass, gate.build/integration=true; I002 closed; I003 new                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **5d**                   | ✅ Validated            | scaffolder + architect prompt rewrites; `templates/parallel-example/` authored; 2 live runs; I001 + I003 RESOLVED (sibling-parallel start same-ms × 2 runs); I004 new (worktree merge race)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **5e**                   | 🟡 Code-only            | I004 RESOLVED via per-project async merge mutex + post-merge HEAD verification + skip-empty-merge guard in `packages/worker/src/worktree.ts`; +5 worker tests; live rerun deferred to close-out (autoresume WIP blocks the CLI in this checkout)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **5-closeout**           | ⏸ Deferred              | Run A surfaced **I005** — `persistFindings` writes to `<projectPath>/BUILD.md` on main's working tree between worker stream finish and `cleanupWorktree`, so the next merge aborts with "local changes to BUILD.md would be overwritten." First finding-raising builder poisons the pool. Run B skipped — same code path, same failure regardless of spec. 1/6 tasks succeeded, spend $1.47, gate all-false. Close-out re-runs after I005 lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **5f (I005 fix)**        | ✅ Code-only            | I005 RESOLVED via one-line path move in `packages/wiki/src/paths.ts` — `buildMd` now resolves to `<projectPath>/.factory/BUILD.md` (inside the already-gitignored `.factory/` tree). +1 worker regression test (247 total); no new ADR. Live rerun of the close-out still deferred pending a $16 budget decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **5-closeout (rerun)**   | ✅ Substantively closed | Same-session live rerun. Three Run A attempts + one clean Run B. Layered fixes along the way: scaffolder prompt (hatchling + src-layout pyproject guidance), builder prompt (don't touch BUILD.md), worktree.ts post-merge `.git/MERGE_HEAD` detection as defense-in-depth. Run B directive `01KPK1CM3X6JXHQ5AVCAJ6QR46` terminated `complete` **LIVE** with all gates true — first ever in Phase 5. Run A attempt-3: 6/6 tasks, 58 tests, all gates true via `scripts/reassess.ts` after I006 workaround. New HIGH: **I006** — assessor's `pip install -e .` pollutes the user-site Python env on repeat builds of same-named projects. 5/6 criteria ✅, 1 miss (I006).                                                                                                                                                                                                                                                                                                                                               |
| **5f (I006 fix + live)** | ✅ Closed               | `ensureAssessorVenv` added to `packages/assessor/src/runners/pytest.ts` — per-project venv at `<projectPath>/.factory/assessor-env/` (precedence: project `.venv/` → factory-managed → system fallback). ADR 0017 gained Implementation Notes; no new ADR. +8 assessor tests (247 → 255 workspace total). Live `factory build example --autonomy autonomous --concurrency 2` (directive `01KPKPJ2ECBVQS15MGE3ZYDHYT`, workspace `/c/Users/Momo/factory5-v5f-example`, spend $5.84): `assessor-env: creating venv` + `venv created` + `venvSource: factory-managed` + `installOk: true` + `gate: {build: true, integration: true, verify: true}` + `testsPassed: 95` + `terminalStatus: complete`. Belt-and-braces `scripts/reassess.ts` hit the reuse path (`assessor-env reused`, 8.6 s install, same green gates). I006 → RESOLVED. New I007 filed LOW (builder-worktree pip installs leave stale `.pth` in user-site — orthogonal to I006, functionally inert post-fix). 6/6 criteria ✅ — Phase 5 formally closes. |

## Where we are, end of Phase 5b

Planner materialisation is proven to work in the wild. The factory emitted
a clean plan, executed it without collisions, and produced a working Python
CLI package with 114 passing tests. The remaining gap is environmental, not
architectural:

- **I002 (HIGH, assessor)** — the assessor shells to host `python` with no
  venv, no `pip install`, no runtime-version check. Phase 5b's built code
  required Python 3.11 (correctly — per the spec's `requires-python`) but
  the host's `python` was 3.10. The verify gate returned all-false on a
  fully-working build. This is the _one_ reason the Phase 5b run ended
  `blocked` instead of `complete`.
- **I001 (MEDIUM, brain/planner)** — the planner over-serialised the 6-task
  DAG into a strict chain, neutering `--concurrency 2`. The `FILE
OWNERSHIP` section of `prompts/agents/planner.md` is framed strongly
  enough that the LLM defaults to "safe = sequential" when uncertain.

## Where we are, end of Phase 5c

ADR 0017 (assessor env provisioning) and the I001 planner-prompt rewrite
shipped. Live run (`01KPJCH7HC7ECW1VRFC4QYWM79`, 2026-04-19): 6/6 tasks
succeeded, 129 pytest tests green, spend $6.48. Post-run refactor pulled
provisioning up to `assess()` so imports + pytest share the picked
interpreter and single install. Locally verified:
`gate.build: true`, `gate.integration: true`, 129 tests pass. 231 workspace
tests green (214 + 17 new).

Two takeaways, one per issue:

- **I002 is closed** (RESOLVED, 2026-04-19). `pickPython` → venv → `py
-3.11` → PATH, with `pip install -e .[test|dev|.]` before tests. Install
  failure surfaces as `AssessResult.provisioning.installOk: false` and
  drops `gate.build`. The factory can now see its own Python builds
  correctly.
- **I001 stays OPEN** — prompt tuning landed but the `example` spec's
  architect-designed module graph is genuinely linear (`formatter` imports
  `WeatherAPIError` from `api`, `cli` from all three). The planner now
  correctly lists every producer a task reads from; it just happens there's
  no parallel pair on this spec. Needs a different spec to validate.

And one new issue surfaced:

- **I003 (MEDIUM, brain/scaffolder)** — scaffolder omits README ≥30 lines,
  LICENSE, comprehensive `.gitignore`. Under the pre-ADR-0017 assessor
  these failures were masked by `gate.build: false`; now that `gate.build:
true` is reachable, I003 is the dominant remaining blocker for
  `gate.verify: true`.

## Phase 5c — what needs to happen next

Ordered by value-per-session-hour. I002 first, I001 second.

### 5c.1 — Fix I002 (assessor env), minimum-viable tier

**Goal:** the assessor can actually run pytest against projects it builds,
regardless of host Python default.

**Concrete changes:**

1. `packages/assessor/src/runners/pytest.ts`
   - Extend `pickPython(opts)` to:
     - Prefer `<projectPath>/.venv/Scripts/python.exe` (Windows) or
       `<projectPath>/.venv/bin/python` (Unix) when it exists.
     - Parse `pyproject.toml`'s `requires-python` if present; when it's
       `>=3.11` (or similar), try `py -3.11` on Windows / `python3.11` on
       Unix before falling back to bare `python`.
     - Log at `info` which interpreter was chosen and why.
   - Before invoking pytest, run `<python> -m pip install -e .[test]`
     (fall back to `-e .` if `[test]` extra not present). Capture
     stdout/stderr; surface install failures on the `AssessResult`.
   - New optional field `AssessResult.provisioning: { pythonPath, pythonVersion, installOk, installSummary }`.

2. `packages/assessor/src/runners/pytest.test.ts`
   - Add 3–4 tests: (a) venv detection; (b) version-constraint selection;
     (c) install step invoked before pytest; (d) install failure surfaces
     cleanly rather than masquerading as pytest failure.

3. `docs/decisions/0017-assessor-project-env-provisioning.md`
   - New ADR documenting the tier-1 decision and why the tier-2/3 designs
     (factory-managed `.factory/assessor-env/`, pluggable runtime system)
     are deferred. Reference I002 for the fuller argument.

4. Live re-run `factory build example --autonomy autonomous
--concurrency 2 --workspace /c/Users/Momo/factory5-v5c` (budget $8-12)
   to confirm: `gate.verify: true`, `testsPassed > 100`, terminal status
   `complete` (no escalation).

**Exit criteria for 5c.1:**

- ✅ All existing 214 tests still pass; +3–4 new assessor tests (total ~218)
- ✅ Live run ends `complete`, not `blocked`
- ✅ `assess: complete` log line shows `gate.verify: true` with real
  `testsPassed` count

### 5c.2 — Fix I001 (planner over-serialisation), prompt-tuning tier

Pair with 5c.1's live re-run so we get the parallelism evidence on the
same spend.

**Concrete changes:**

1. `prompts/agents/planner.md`
   - Add a second worked example: two builders at the same DAG level, each
     `dependsOn: [<scaffolder-index>]` only, with disjoint
     `expectedOutputs.files[]`. Frame it as the _default_ shape for
     independent modules.
   - Promote the "don't invent false dependencies" line from a paragraph in
     `PARALLELISATION` to a numbered rule next to `FILE OWNERSHIP`, so the
     two rules carry equal visual weight.
   - Add a concrete ❌ example: "Task A writes `models.py`; Task B writes
     `formatter.py` and reads `models.py`. ❌ `Task C (writes cli.py) depends on B`
     just to serialise — cli.py reads from both models.py and formatter.py
     directly; chain to B AND all other producers it reads, but no further."

2. `packages/brain/src/prompts.ts` (if the inline planner user-prompt
   needs the same change — it currently duplicates guidance from the .md)

3. Re-inspect the Phase 5c live run's `plan.json` via
   `pnpm --filter @factory5/scripts analyze-plan`. Expected: independent
   builder tasks run in parallel; wall-clock ~cuts roughly in half vs the
   serial Phase 5b run.

**Exit criteria for 5c.2:**

- ✅ Live plan shows at least one pair of builders with
  `dependsOn: [<same-scaffolder>]` and no edge between them.
- ✅ Pool log shows `pool: task started` for two tasks within < 2 s of
  each other.

**Do not** add a code-level dependency pruner in this session. Prompt-only
first; only build a pruner if the prompt alone fails to produce parallel
DAGs on the re-run. That would be a new ADR extending 0016.

## Out of scope for Phase 5

Carried forward into Phase 6+, not relevant for 5c:

- GitHub event source + channel — plumbing done in a dedicated clean-slate
  session, no live spend.
- Worker-subprocess `ask_user` (ADR 0015 shape 1) — still waiting for
  evidence of mid-tool blocking.
- `max_usd` / `max_steps` enforcement — documented in
  CompleteArchitecture.md §12 but not yet wired. Phase 5c should note any
  near-misses but not implement.
- Directives stuck `running` across a brain crash — real, annoying, but
  not on Phase 5's critical path. A `factory directive mark-blocked <id>`
  CLI lives in Phase 6.
- Assessor I002 tier 2 / tier 3 (factory-managed envs; pluggable
  runtimes). Design documented in I002; implementation comes after one or
  two more projects surface the need.

## Phase 5 exit criteria (overall)

Phase 5 is done when a fresh live run of `factory build example
--autonomy autonomous --concurrency 2` ends with:

1. **`terminalStatus: 'complete'`** (not blocked) — no escalation fired.
2. **`gate.verify: true`**, `gate.build: true`, `gate.integration: true`.
3. **`testsPassed >= 50`** on a non-trivial spec (Phase 5b produced 114).
4. **Visible parallelism in the DAG** — at least one pair of tasks with
   independent `dependsOn` roots that actually ran concurrently.
5. **No new CRITICAL or HIGH issues filed** from the run.
6. **Spend <$12** for the complete-build outcome.

Phase 5b hit 2, 4-partial, 5-sort-of (filed I001/I002 but they were
always-there-just-not-seen), and 6. It missed 1 and 3 entirely. Phase 5c
aims to hit all six.

### Phase 5c's actual scoreboard (2026-04-19)

| #   | Criterion                                                           | Status | Note                                                                    |
| --- | ------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| 1   | `terminalStatus: 'complete'`                                        | ❌     | Escalation-kill pattern from Phase 4/5b repeats; orthogonal to 5c work. |
| 2   | `gate.verify: true` + `gate.build: true` + `gate.integration: true` | 🟡     | `build` + `integration` green; `verify` blocked by I003.                |
| 3   | `testsPassed >= 50`                                                 | ✅     | 129.                                                                    |
| 4   | Visible parallelism in the DAG                                      | ❌     | Architect-driven linear module graph on `example`; not a planner bug.   |
| 5   | No new CRITICAL or HIGH issues                                      | ✅     | I003 is MEDIUM; one LOW finding from verifier.                          |
| 6   | Spend < $12                                                         | ✅     | $6.48.                                                                  |

### Phase 5e — I004 fix scoreboard (2026-04-19)

Code-only session; live rerun deferred to close-out. Criteria 1/2/3
will be re-scored once both 5e (this) and the autoresume session land
together.

| #   | Criterion                                                           | Status     | Note                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `terminalStatus: 'complete'`                                        | ⏳ Pending | Needs autoresume + I004 merged. Mechanically unblocked by the mutex (no more `gate.build: false`-from-lost-sibling escalation), but the autoresume work is the second half of the loop. |
| 2   | `gate.verify: true` + `gate.build: true` + `gate.integration: true` | ⏳ Pending | Lost-sibling-import failures should disappear with I004. `verify` still wants the README/LICENSE/.gitignore checks (already green per 5d).                                              |
| 3   | `testsPassed >= 50`                                                 | ⏳ Pending | Phase 5d Run B produced 6 tests after `art` was lost; expectation is ~30+ once both siblings land.                                                                                      |
| 4   | Visible parallelism in DAG                                          | ✅ Hit     | Unchanged from 5d (same-ms sibling start).                                                                                                                                              |
| 5   | No new CRITICAL or HIGH issues                                      | ⏳ Pending | None filed this session.                                                                                                                                                                |
| 6   | Spend < $12                                                         | ✅ Hit     | $0 (code-only; no live spend).                                                                                                                                                          |

4 hits + 1 partial + 2 misses. The misses are both "needs different input,
not different code": criterion 4 needs a parallel-admitting spec; criterion
1 needs the directive auto-resume gap addressed. Criterion 2 needs I003.

### Phase 5-closeout scoreboard (2026-04-19, Run A only — I005 aborted pool)

Run B skipped after Run A exposed I005 — the BUILD.md-dirties-main bug
fires regardless of spec, so a second run would have wasted $3-7 for no
new signal. Outcome β per the close-out prompt.

| #   | Criterion                                                           | Status  | Evidence                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `terminalStatus: 'complete'`                                        | ❌ Miss | Directive `01KPJVFJ35A8WJVKHK3G8H9F8Y` left `running` after `askUser` escalation was killed; flipped manually via `factory directive mark-blocked` (autoresume CLI). Blocked by I005's pool failure + the pre-existing escalation-kill pattern. |
| 2   | `gate.verify: true` + `gate.build: true` + `gate.integration: true` | ❌ Miss | `assess: complete` reported `{build: false, integration: false, verify: false, testsPassed: 0}`. All importErrors stem from I005 — the models / api / formatter / cli tasks never landed.                                                       |
| 3   | `testsPassed >= 50`                                                 | ❌ Miss | 0 passed. The builders that would write the tests never merged.                                                                                                                                                                                 |
| 4   | Visible parallelism in DAG                                          | ⏳      | Plan shape was valid — `api` and `formatter` both `dependsOn: [scaffolder, models]` with no inter-sibling edge (`analyze-plan` confirmed). Pool never reached the siblings because models aborted on merge.                                     |
| 5   | No new CRITICAL or HIGH issues                                      | ❌ Miss | **I005 HIGH filed** — worker persistFindings dirties main's working tree.                                                                                                                                                                       |
| 6   | Spend < $12                                                         | ✅ Hit  | $1.47 total (triage $0.01, architect $0.31, planner $0.10, scaffolder $0.21, models $0.84; assessor $0).                                                                                                                                        |

1 hit + 1 pending + 4 misses. Every miss except #5 is a direct
consequence of I005; flipping I005 will flip criteria 1/2/3/4 on the next
close-out attempt. Criterion 5 stays miss because the HIGH was filed
this session.

### Phase 5f scoreboard — Phase 5 formally closes (2026-04-19)

Fresh live run after the I006 fix landed. No carry-over HIGH or
CRITICAL issues. Evidence from directive
`01KPKPJ2ECBVQS15MGE3ZYDHYT`, workspace
`/c/Users/Momo/factory5-v5f-example`, spend **$5.84**.

| #   | Criterion                                                           | Status | Evidence                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `terminalStatus: 'complete'`                                        | ✅ Hit | `brain: inline run complete terminalStatus: complete openFindings: 0 totalCostUsd: 5.8375319`. No `askUser` escalation, no mark-blocked needed.                                                                                  |
| 2   | `gate.verify: true` + `gate.build: true` + `gate.integration: true` | ✅ Hit | `assess: complete gate: {build: true, integration: true, verify: true}, testsPassed: 95, testsFailed: 0, importErrors: []` — and critically `provisioning.venvSource: factory-managed` proving the I006 fix is on the live path. |
| 3   | `testsPassed >= 50`                                                 | ✅ Hit | 95 tests passing on the non-trivial `example` weather-CLI spec.                                                                                                                                                                  |
| 4   | Visible parallelism in DAG                                          | ✅ Hit | Two sibling `pool: task started` logs at `20:27:02.541Z` and `20:27:02.542Z` — 1 ms apart, real concurrent execution. I001 + I004 mutex still holding end-to-end.                                                                |
| 5   | No new CRITICAL or HIGH issues                                      | ✅ Hit | Only new issue filed this session is **I007 LOW** — orthogonal to I006, functionally inert (assessor venv shields the gate). No CRITICAL or HIGH filed.                                                                          |
| 6   | Spend < $12                                                         | ✅ Hit | $5.84 for the complete-build outcome. Sub-session breakdown: triage $0.04, architect + planner ~$0.5, scaffolder + 4 builders + verifier ~$5.0, assessor ~$0.3.                                                                  |

**6/6 ✅.** Outcome α on the strict rubric ("all six HIT"). Phase 5
formally closes.

## After Phase 5

Phase 6 opens the door to multi-project runs: (a) cross-project findings
registry (pulled forward from the original Phase 6 charter); (b) GitHub
channel + event source (Phase 5 direction B, deferred); (c) Telegram
channel; (d) web UI. Pick based on what users (including this user) are
asking for when 5c closes.

Phase 5d (the natural next half-session) closes I003 + validates I001 on
a parallel-admitting spec. See the next-session recommendation at the
bottom of `docs/PROGRESS.md` 2026-04-19 entry.
