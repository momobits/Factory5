---
id: I001
severity: MEDIUM
area: brain/planner
status: OPEN
created: 2026-04-19
---

# Planner emits a fully serial task chain on simple specs

## Description

The live Phase 5b run (2026-04-19, directive `01KPHAYCJSYFC7RK3EPZ3B0XKA`) produced a 6-task plan for the `example` spec (a Python CLI that fetches weather data and formats it). The planner daisy-chained every task:

```
scaffolder → models → api → formatter → cli → verifier
```

Every builder declared `dependsOn: [previousBuilder]` — a fully linear DAG. There is no logical reason `formatter` needs to wait for `api` to finish (formatter reads `models.py`, not `api.py`), and no file-ownership reason either (their `expectedOutputs.files[]` don't overlap). The pool ran at `--concurrency 2` but only one worker was ever busy at a time, so the --concurrency knob had zero effect.

This is not a materialisation bug. ADR 0016 says we add synthetic edges when two tasks share files and aren't already connected. The LLM connected them unnecessarily, so `adjustments: 0` is correct — the issue is that the LLM over-serialised rather than under-serialised.

## Repro / evidence

- Plan artefact: `C:\Users\Momo\AppData\Local\Temp\2\factory5-phase5b\plan-phase5b-preexec.json`
- Log: `C:\Users\Momo\AppData\Local\Temp\2\factory5-phase5b\build.log`
- Snapshot (task id last 8 chars):
  - `pw0kfavk` scaffolder → deps=[]
  - `ssdyfzye` builder: models → deps=[scaffolder]
  - `jg0xw59f` builder: api → deps=[models] (genuine — api consumes models)
  - `r6e8kxt2` builder: formatter → deps=[**api**] (**spurious** — formatter needs models, not api)
  - `y546sw4r` builder: cli → deps=[formatter] (spurious — cli needs api + formatter + models)
  - `56ymgk59` verifier → deps=[cli]

## Hypothesis

Two compounding factors:

1. **Prompt framing.** `prompts/agents/planner.md` has a "Parallelisation" section ("Tasks with no shared output files and no logical prerequisite should have empty `dependsOn`") but it lives below the "File ownership" section, which is framed much more strongly ("the #1 rule", "merge conflicts guaranteed"). The planner appears to be prioritising "safety" (serialise) over "speed" (parallelise) when uncertain.
2. **Lack of a positive example.** The minimal plan skeleton in `planner.md` shows `dependsOn: [0]` on a builder and `dependsOn: [1]` on the verifier. There's no example of two builders at the same level with empty or overlapping non-chain deps. The model is pattern-matching to the skeleton.

## Resolution

**Phase 5c update (2026-04-19)**: prompt-tuning tier landed.

Changes shipped:

- `prompts/agents/planner.md` rewritten: "don't invent false dependencies"
  promoted to a numbered rule of equal weight with file-ownership; a second
  worked example (parallel-siblings `models` + `ui`, both `dependsOn: [0]`)
  added; explicit ❌ counter-example showing cli depending on **both**
  models and formatter (not just the most recent one).
- `packages/brain/src/planner.ts` inline user-prompt rewritten in parallel
  so the two planner entry-points stay in sync.

Live validation (directive `01KPJCH7HC7ECW1VRFC4QYWM79`, 2026-04-19):

The planner-emitted DAG for `example` changed from the Phase 5b
"formatter-deps-on-api-only-because-that's-the-previous-step" shape to a
fully data-flow-correct shape: every builder now depends on **all** the
producers it reads from (`cli` → `[scaffolder, models, api, formatter]`,
`formatter` → `[scaffolder, models, api]`, etc.). The prompt change
successfully disciplined the planner to reflect genuine data flow.

However — `example`'s architect-designed module graph is itself linear:
`formatter` imports `WeatherAPIError` from `api`, so the edge is real;
`cli` imports from all three non-scaffolder modules, so its edges are
real. No pair of independent tasks exists in this architecture, so
`--concurrency 2` still serialises in practice (each level has only one
ready task). **Not a bug in the planner; the spec's architecture doesn't
admit parallelism.**

Status: **OPEN** pending validation on a project spec with genuine
independent modules (e.g. a project with two unrelated utilities that
share only the scaffolder). If such a re-run shows the planner correctly
emits sibling tasks, I001 can be marked RESOLVED. The dependency-pruner
option is parked — no evidence the prompt alone is insufficient.
