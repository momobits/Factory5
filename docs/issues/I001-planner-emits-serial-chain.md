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

(filled when work begins)

Suggested direction:

- Add a second worked example in the planner prompt: a project with two independent modules (e.g. CLI parser + output renderer) where both builders have `dependsOn: [<scaffolder>]` and neither depends on the other. Contrast explicitly with the chain form.
- Promote the "don't invent false dependencies" rule from a soft line in the `PARALLELISATION` section to a numbered rule alongside file-ownership, to rebalance the framing.
- Consider a post-materialisation **dependency pruner** that removes `dependsOn` edges between tasks whose `expectedOutputs.files[]` don't overlap and where the later task doesn't consume any of the earlier task's `expectedOutputs.files[]` via its own `inputs.files[]`. This would be a fourth behaviour in `materialisePlannerTasks` (extending ADR 0016) — edges go in _and_ come out based on declared data flow. Requires care: overly aggressive pruning breaks legitimate chains, so prune only when we can _prove_ there's no data dependency from the declared file lists.

Pruning is riskier than promotion — start with prompt tuning and a live re-run; only add the code-level pruner if the prompt alone doesn't fix it.
