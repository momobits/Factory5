# Phase 6 — progress & roadmap

> Phase-level overview of the Phase 6 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 6
> (what's done, what's next, what "done" looks like). Proposed charter
> at session start — individual sub-phases are pending user confirmation.

## Where we were, end of Phase 5

Phase 5 closed **Outcome α** on 2026-04-19 (Phase5_Progress.md §5f
scoreboard): a fresh `factory build example --autonomy autonomous
--concurrency 2` terminated `complete`, all gates true, 95 tests, $5.84,
with `venvSource: factory-managed` confirming the I006 fix was live.

By end of Phase 5:

- **All 7 factory5 issues filed across Phases 4-5 resolved.** I001
  (planner serial chain), I002 (assessor host-env), I003 (scaffolder
  hygiene), I004 (worktree merge race), I005 (persistFindings
  dirties main), I006 (assessor pip user-site), I007 (builder pip
  user-site). Open backlog: empty.
- **The autonomous loop is proven end-to-end.** Triage → architect →
  planner → scaffolder → N builders (parallel where siblings) →
  verifier → assessor, with ground-truth gate computation and
  isolated per-project envs.
- **255 unit tests across 12 packages** — logger 5, core 12, ipc 5,
  state 16, providers 37, assessor 42, wiki 18, channels 25, events
  3, worker 22, brain 42, daemon 28. All green.
- **17 ADRs** capturing the architecture. 16 accepted, 1 superseded.
- **Two live regression fixtures** — `templates/example/` (linear
  module graph, weather CLI) and `templates/parallel-example/`
  (sibling-admitting, rot13 + ASCII-art CLI).

Operating surface is still narrow:

- **One user, one project at a time.** No cross-project view;
  findings lists are per-project; no way to see "open HIGH findings
  across all projects I've built this month."
- **One trigger channel that matters — the CLI.** Discord channel
  exists but is underused; GitHub / Telegram / web UI all absent.
- **One verification ground truth — the assessor.** The verifier
  agent exists as an LLM-based second opinion but is read-only and
  hallucinates filesystem claims (today's F001 on the I007 run was a
  verifier false-positive that the assessor's green gate overrode).
- **No visibility outside `factory tail` + log files.** No dashboard,
  no external notifications on build complete, no cross-session
  spend tracking.

## Phase 6 scope proposal

**Lift factory out of "proves itself on a single project via the CLI"
into "operates across multiple projects and trigger surfaces, with
verification signals the operator can actually trust."**

Three tracks, each a cohesive sub-phase. Sub-phases are mostly
independent — pick the one that matches the session's appetite.

### Candidate sub-phases

| Sub-phase | Track    | Pitch                                                                                                                                                                                                                                                                                                       | Est. sessions | Status    |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- |
| **6a**    | Data     | **Cross-project findings registry.** Aggregate `<project>/.factory/findings.json` into a factory-home index (`~/.factory5/findings-registry.sqlite`). Surface `factory findings list [--severity HIGH] [--status OPEN] [--project <glob>]` and `factory findings show <id>`. Original Phase 6 charter item. | 1-2           | ⏸ Pending |
| **6b**    | Triggers | **GitHub channel + event source.** A `github` channel parallel to the existing `discord` channel — GitHub issues / PR comments become directives; finding-raise / terminalStatus posts back as comments. Plumbing-heavy, unlocks non-CLI build triggers.                                                    | 2-3           | ⏸ Pending |
| **6c**    | Quality  | **Verifier overhaul.** Either give the verifier filesystem access (upgrade to tool-using, parallel to builder) or formally downgrade its claims to advisory (never blocking, always informational). Today's F001 hallucination is the forcing function.                                                     | 1             | ⏸ Pending |

Three _deferred_ items that logically live in Phase 6+ but aren't in
the initial scope:

- **Telegram channel** — sibling to Discord/GitHub. Saved until
  after 6b validates the channel-shape.
- **Web UI** — bigger build than the above; its own phase.
- **Assessor tier 3 (pluggable runtimes)** — wait until a Go or
  Rust project actually needs it.

## Entry state — what's already in tree

Infrastructure the 6x sub-phases can build on without re-paving:

- **Wiki package (`@factory5/wiki`)** — findings storage, build log,
  readiness checks. 18 tests. 6a builds on `addFinding` / `listFindings`.
- **Channels package (`@factory5/channels`)** — abstract `Channel`
  interface + Discord implementation. 25 tests. 6b implements a
  `GithubChannel` conforming to the same shape.
- **State package (`@factory5/state`)** — SQLite migrations +
  directive/task/question queries. 16 tests. 6a likely adds a
  `findings_registry` migration.
- **Worker package** — tool-using vs. read-only split. 22 tests. 6c
  flips the verifier from read-only to tool-using (add Read/Glob/Grep
  to its allowlist) or inverts its gate contribution.
- **Providers package** — claude-cli provider, category routing. 37
  tests. No 6x sub-phase should need to touch this.

## Recommended first sub-phase

**6c (verifier overhaul)** — today's live run (directive
`01KPKRNB2V08QZZD02SKTK6MWP`) produced a concrete reproducer (F001
CRITICAL, verifier-raised, contradicted by assessor's green gate +
78 tests). Short scope, narrow blast radius, single ADR-candidate
decision ("verifier gets filesystem access vs. verifier becomes
advisory-only"). Pair with a regression test that replays the F001
scenario. ~1 session.

After 6c: **6a (findings registry)** is the natural follow-on —
every project factory has ever built lives in
`<workspace>/<project>/.factory/findings.json`, and Phase 5 produced
enough projects that the aggregation has real signal.

**6b (GitHub channel)** is the bigger build and probably wants
coordination with the user on OAuth / webhook setup before a session
kicks off.

## Out of scope for Phase 6

Carry-forward items that are explicitly deferred until Phase 7 or a
demand signal appears:

- **Telegram channel.** Slot in after 6b locks the channel-shape.
- **Web UI.** Multi-session build.
- **Assessor tier 3 — pluggable runtimes (Go / Rust / JS provisioners).**
  Wait for a non-Python project to surface the need. ADR 0017 flags
  this.
- **Worker-subprocess `ask_user` (ADR 0015 shape 1).** Still no
  evidence of mid-tool blocking; the current brain-level shape is
  holding.
- **`max_usd` / `max_steps` enforcement.** Documented in
  CompleteArchitecture.md §12; not yet wired. Phase 6 noted; Phase 7
  wired.
- **Cross-session spend tracking / dashboard.** Belongs with the web UI.

## Phase 6 exit criteria (proposed)

Phase 6 is done when the factory can:

1. **Aggregate findings across projects** — `factory findings list
--severity HIGH` returns real rows from ≥2 projects without
   bespoke shell scripting, **OR** (if 6a is deferred) the scope is
   narrowed and this criterion is struck through with a charter amend.
2. **Accept at least one non-CLI trigger live** — a real GitHub
   issue or PR comment produces a `directive:new` row, runs through
   the pipeline, and posts a response back. **OR** (if 6b is deferred)
   struck through with charter amend.
3. **Verifier signal is either authoritative or explicitly advisory.**
   No more cases like today's F001 where a CRITICAL claim from the
   verifier is flat-out contradicted by the assessor. Either verifier
   gets filesystem access (authoritative) or its claims never enter
   `brain.loop`'s gate calculation (advisory).
4. **No regressions to Phase 5 exit criteria.** `factory build
example` still ends `complete` with all gates true; `factory
build parallel-example` still exhibits same-ms sibling start.
5. **No new CRITICAL or HIGH issues filed against factory5 itself
   during the Phase 6 session(s) that close out Phase 6.**

The scope is flexible: if the user picks only 6c in a given session,
criteria 1+2 may be struck through with a charter amend (`Phase 6
narrow scope — 6c only`). The point is the charter sets the bar for
what "Phase 6 closed" means; sub-phase picks refine it.

## Pointers

- `docs/Phase5_Progress.md` — predecessor phase; template for this
  file's shape.
- `docs/PROGRESS.md` — session-by-session history; the 2026-04-19
  entries are the most recent reference for where Phase 5 ended.
- `docs/decisions/INDEX.md` — 17 accepted ADRs; check before writing
  a new one.
- `docs/issues/INDEX.md` — empty Open list at Phase 6 open.
- `CompleteArchitecture.md` §12 — `max_usd` / `max_steps` /
  cross-project topics still-to-wire.
