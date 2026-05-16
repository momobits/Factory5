# Workflows

The four canonical loops a factory5 operator runs, plus a decision matrix for picking which surface fits which task, plus a worked guide to authoring the `CLAUDE.md` spec the brain reads.

If [`ONBOARDING.md`](ONBOARDING.md) got you to a green `factory doctor`, this doc is what you do next.

---

## 1. The four canonical loops

### 1.1 One-shot autonomous build

When you know what you want, you've written it down, and you're willing to let factory drive end-to-end against a budget ceiling.

1. Author a `CLAUDE.md` in the directory you want factory to build into. (See §3 for what makes a good one.)
2. Kick off:

   ```bash
   factory build hello-cli --autonomy autonomous --max-usd 5
   ```

   - `<project>` resolves in this order: absolute path → cwd-relative path → `<workspace>/<name>` → `templates/<name>` (copied into the workspace).
   - `--autonomy autonomous` lets the brain proceed without per-checkpoint confirmation. It will still escalate via `askUser` if it gets genuinely stuck (no path forward, ambiguous spec, missing prerequisite).
   - `--max-usd 5` is the hard ceiling. The brain checks every LLM call against it pre-flight; the directive halts cleanly when the next call would exceed it.

3. Wait. The CLI polls the directive row until it's terminal (`complete` / `failed` / `blocked`). On `complete`, exit 0. On the others, exit 2.
4. If the brain raised a question along the way (escalation, hard ambiguity), `factory answer <questionId> "<reply>"` closes it from another terminal. The brain's polling loop picks the answer up within a second and resumes.

Best for: a spec you've already nailed down, batch-style work, scripted invocations.

### 1.2 Chat-driven exploration

When you're still figuring out what you want and you'd rather think out loud with the brain than write the spec up front.

```bash
factory chat
# you> I want a tiny CLI that prints today's weather for a given city. Use Python.
# bot> Got it — what data source? wttr.in (no API key) or Open-Meteo (more accurate)?
# you> wttr.in.
# bot> Should it accept the city as a positional arg, or default to one configurable in a file?
# you> positional, default "London".
# bot> OK. /build weather-cli now?
# you> /build weather-cli
```

Mechanics: every line you type writes an `intent=chat` directive. The brain's triage agent classifies, runs `askUser` to clarify when ambiguous, and proposes a spec. When you confirm with `/build <name>`, the same conversation flips to a build directive — the brain has all the context from the chat and writes a CLAUDE.md into the new project before architecting.

Best for: small projects you don't want to over-spec, exploring what factory can build, iterating on requirements before committing.

### 1.3 Iterative fix loop

When factory built something but the assessor surfaced a finding (test failure, type error, missing acceptance) that you want to address.

1. List the open findings:

   ```bash
   factory findings list --project weather-cli
   ```

2. Inspect a specific one:

   ```bash
   factory findings show weather-cli/F003
   ```

   The detail view shows the source ("test-failure", "type-error", "verify-failure", etc.), the target file, the description, and any prior resolution attempts.

3. Request a fix — same `factory build` invocation, but reference the finding in the spec. The simplest path is to amend `CLAUDE.md` with a line like `- Fix finding F003: <one-line restate>`, then:

   ```bash
   factory build weather-cli --autonomy assisted --max-usd 2
   ```

   `--autonomy assisted` is appropriate here — you want a checkpoint after the fix lands so you can review before the brain races on.

4. After the run, re-list. The finding should be `FIXED` or `VERIFIED` (the latter if the assessor re-ran the failing check and it passed). If it's still `OPEN`, the build needs another pass; rinse and repeat.

Best for: post-build cleanup, regressions discovered after a green build, narrowing in on a stubborn failure.

### 1.4 Resume after pause

When a long-running autonomous build is mid-flight, hit a pending question, and you walked away.

The brain raised an `askUser` and the build is now `waiting_for_human`. Notification options depending on your config:

- **CLI**: the directive row sits at status `running` with one or more open `pending_questions` rows. `factory status` shows it; `factory chat` would interleave the question.
- **Discord**: the bot posted the question into the directive's thread. Reply in-thread and the brain picks it up.
- **Telegram**: the bot DM'd (or posted in the configured group). Use Telegram's reply-to feature on the bot's question message; the answer is recorded against that exact pending question.
- **Web UI**: the question shows up at `/app/questions/` and `/app/questions/detail/?id=<id>`. The answer form POSTs through the same write path.

Whichever surface you answer through, the brain's polling loop sees the answer within ~1 second and resumes the directive. The build picks up from the `waiting_for_human` task and continues until the next decision point or terminal state.

Best for: long autonomous runs (hours), multi-day work where the operator isn't actively at the terminal, multi-operator teams where whoever's around answers.

### 1.5 Resume after failure

When a build hit a terminal failure (`failed` / `blocked` / `complete`-but-you-want-to-rerun) and you want to retry without losing the architect's work. Three surfaces:

- **Web UI — directive-detail (Tier 10).** Open `/app/directives/detail/?id=<failed-directive-id>`. A vermillion **Resume** pill appears in the title row whenever status is terminal and `intent === 'build'` (mutex with the Cancel pill — never both). One click POSTs to `POST /api/v1/directives/:id/resume`, mints a child directive with `parentDirectiveId` + `payload.resumeFrom` set, and navigates to the child's detail page. The brain skips the architect when the wiki is still on disk and skips already-complete tasks in the plan.
- **Web UI — Projects index (Tier 10).** Open `/app/projects/`. The "Last build" column shows the latest build directive's status linked to its detail page; a small Resume pill in the same cell on terminal-non-running rows offers a one-click resume of that project's most recent build.
- **CLI.** `factory resume <project>` is the canonical command — looks up the most recent directive for the project, mints a child with the same linkage, runs the brain inline. Resume from any terminal status (`failed`, `blocked`, `complete`). Refuses on a `running`/`pending` prior — cancel it first.

While the resumed directive runs, the **Activity** panel narrates brain stages live (see §5.4 in `docs/ONBOARDING.md`) — you'll see `architect: skipped (wiki already on disk; resume path)` when the wiki was good enough; otherwise the architect re-runs against the same prompt. Schema-validation failures (e.g. the planner couldn't extract valid JSON from the LLM response) surface as red **ERROR** events in the activity panel with the first 500 chars of the offending LLM output as `attrs.detail` — that's ADR 0031's contract.

Best for: rerunning a build after fixing an upstream cause (a bug in a dep, a stale auth token, a transient LLM error); promoting a `complete` build to retry-with-modified-spec; recovering from operator-side cancels.

---

## 2. Decision matrix — which surface for which task?

| Surface                       | Best for                                                                                    | Avoid for                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `factory build` (CLI)         | Scripted / batched work, fastest path for a known spec, CI / cron drivers                   | Exploratory specs (use chat instead — fewer round-trips)               |
| `factory chat` (CLI REPL)     | Iterative spec authoring, fastest turnaround, single-operator dev box                       | Long sessions (the 120 s per-turn timeout interrupts deep thinking)    |
| Discord                       | Multi-operator teams, threads as conversation history, mobile via the Discord app           | Solo operator at a dev box (CLI is faster)                             |
| Telegram                      | Solo operator on mobile, fastest notification UX, low-friction "did the build finish?" peek | Multi-operator coordination (no thread model — group chat interleaves) |
| Web UI (`/app/`)              | Discoverability ("what's running? what spent what?"), budget editing, visual answer flow    | Iterative back-and-forth (no streaming yet — Tier 3 will add SSE)      |
| `factory answer` / `findings` | Targeted, scriptable interactions when you know the question or finding id                  | Discovery (use the web UI's lists for that)                            |

The brain doesn't care which surface a directive came in on — every channel writes the same `Directive` shape into SQLite. Mix surfaces freely: kick off with `factory build` from a terminal, answer the mid-flight escalation from your phone via Telegram, watch the spend climb in the web UI.

---

## 3. Authoring `CLAUDE.md` — what makes a good spec

`CLAUDE.md` is the spec the brain's architect agent reads first. It lives at the root of the project directory factory will build into. Every project gets one.

### 3.1 Principles

- **Say _what_, not _how_.** Let the architect pick the implementation. Specifying "use class-based view models with a separate service layer" forecloses on the brain making a better choice for the project's scale.
- **Specify the runtime when it matters.** Default is Python; otherwise pass `--language node|go|rust` to `factory build`, or write `runtime: node` in the metadata block at the top of `CLAUDE.md`. The brain reads both.
- **List acceptance criteria.** What does "done" look like? "All `pytest` tests pass" is the floor; better is "running `weather-cli London` prints a one-line forecast in under 2 seconds."
- **Reference patterns to follow.** Existing files in the workspace, library docs URLs, similar projects in the workspace — anything that gives the architect a concrete shape to aim at.
- **Keep it under a page.** A spec the brain can't hold in working memory is a spec the brain will paraphrase wrong. If you need more, link out.

### 3.2 Anti-patterns

- ❌ "Build me a SaaS platform with users, billing, and analytics." — too broad; will burn budget exploring scope.
- ❌ Enumerating every file you want created. — over-specifies the implementation; the brain works better when it owns the shape.
- ❌ "Make it fast" / "make it secure" / "make it scalable" without numbers or threat model. — non-actionable; will produce hand-wavy code.
- ❌ Citing internal-only tribal knowledge ("use the Acme pattern from the wiki"). — the brain has no access to your wiki.

### 3.3 Worked example — a small CLI tool

```markdown
# weather-cli

Python CLI that prints a one-line current-weather forecast for a city,
sourced from wttr.in (no API key required).

## Usage

weather-cli # default city: London
weather-cli "New York" # quoted positional
weather-cli Paris --json # machine-readable output

## Acceptance

- `weather-cli London` prints a single line ending with a newline,
  formatted "<city>: <temp> <condition>" (e.g. "London: 14°C cloudy").
- `--json` prints `{"city": "...", "temp_c": 14, "condition": "cloudy"}`.
- Network failures print "<city>: unavailable" and exit 1; all other
  exit codes are 0.
- `pytest` covers: happy path (mocked HTTP), `--json`, network failure,
  unknown city. All four pass.
- Single-file `weather_cli.py` + `tests/test_weather_cli.py`. No package
  dir. `requirements.txt` lists only `requests` (and `pytest` in
  `requirements-dev.txt`).

## Out of scope

- Forecast for future days (today only).
- Alternative data sources (Open-Meteo, NOAA, etc.) — wttr.in is enough.
- Caching responses across runs — premature.
```

That's it. Roughly 30 lines, three section headings, a worked usage block, an explicit acceptance list with measurable criteria, and an out-of-scope list to keep the architect from drifting. The brain has enough to architect, plan, and verify.

### 3.4 What the brain does with it

1. **Triage** classifies the directive as a build (intent inferred from `factory build` + the `CLAUDE.md` shape).
2. **Architect** reads `CLAUDE.md`, asks `askUser` if anything's load-bearing-ambiguous, and writes a plan (sequence of tasks) into the directive's task table.
3. **Plan + Delegate** assigns each task to a worker subprocess, parallel where safe.
4. **Assessor** runs the project's real test command (no LLM) and emits findings for any failures.
5. **Verify** routes findings back into the loop or escalates if no path forward.
6. The directive transitions to `complete`, `failed`, or `blocked`.

`docs/AGENTS.md` covers each agent role; `docs/SKILLS.md` covers the methodology files agents pull in.

---

## 4. See also

- [`ONBOARDING.md`](ONBOARDING.md) — clone-to-first-build walkthrough; channel setup; web dashboard; chat across all surfaces.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the system design behind these workflows.
- [`CONTRACTS.md`](CONTRACTS.md) — exact `Directive` / `Finding` / `OutboundMessage` shapes referenced above.
- [`AGENTS.md`](AGENTS.md), [`SKILLS.md`](SKILLS.md) — what each brain agent does and which methodology files it pulls in.
- [`decisions/0020-pre-call-budget-enforcement.md`](decisions/0020-pre-call-budget-enforcement.md) — how `--max-usd` is enforced.
- [`decisions/0024-worker-subprocess-ask-user.md`](decisions/0024-worker-subprocess-ask-user.md) — how `askUser` mid-stream escalation works.
- [`decisions/0025-web-ui-architecture.md`](decisions/0025-web-ui-architecture.md), [`decisions/0027-web-ui-mutation-surface.md`](decisions/0027-web-ui-mutation-surface.md) — the web UI's read + write story.
