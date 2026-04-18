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

| Sub-phase | Status       | Outcome                                                                                                                             |
| --------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **5a**    | ✅ Shipped   | ADR 0016: `materialisePlannerTasks` (category floor + file-ownership deps + per-task `maxTurns`); planner prompt rewrite; 214 tests |
| **5b**    | ✅ Validated | Live run against fresh workspace; 6/6 tasks succeeded, `adjustments: 0`, $7.68, built code passes 114 pytest tests                  |
| **5c**    | 🟡 Next      | Close the two issues surfaced by 5b (I001, I002) so the next live run ends with `gate.verify: true` naturally                       |

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

## After Phase 5

Phase 6 opens the door to multi-project runs: (a) cross-project findings
registry (pulled forward from the original Phase 6 charter); (b) GitHub
channel + event source (Phase 5 direction B, deferred); (c) Telegram
channel; (d) web UI. Pick based on what users (including this user) are
asking for when 5c closes.
