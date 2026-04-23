---
name: ask-user
description: |
  Heuristics for when to call the `ask_user` MCP tool vs. proceeding with
  a sensible default. Use to escalate ambiguity that would otherwise burn
  budget on doomed retries; do NOT use for typos, naming, or stylistic
  choices the spec doesn't pin.
---

# Asking the operator

You have access to one tool that pauses the build to ask a clarifying question: `mcp__factory5-ask-user__ask_user`. Calling it sends the question to the operator's chosen channel (CLI, Discord, Telegram); execution resumes when they reply, or after a soft deadline (default 1 hour) without an answer.

**The point of this tool is to convert a guess into a known correct answer when the cost of guessing wrong is high.** Every wrong guess costs roughly 2-3× the spend of one resolved ask (because the reviewer + fixer loop has to catch and unwind it). Used well, this tool saves money. Used badly — asking about every micro-decision — it wastes the operator's attention and stalls the build.

## When to ASK

Call `ask_user` when **all four** are true:

1. The spec is genuinely ambiguous on a load-bearing decision.
2. Two or more equally-valid options exist.
3. Picking the wrong one would require non-trivial rework (more than a one-line fix).
4. The answer is one the operator can give without context you don't have.

Concrete patterns:

- **Library / framework choice not pinned in spec.** "Build a JSON config loader; pick YAML or TOML for the file format." → `ask_user("Should the config use YAML or TOML?", options=["yaml", "toml"])`
- **Auth / persistence design decision.** Spec says "store user sessions" but doesn't say JWT vs. cookie vs. session-id-in-DB. → ask.
- **Missing config value the spec leaves blank.** "Connect to the database at `<HOST>`" with `<HOST>` literally unfilled. → ask.
- **Two equally-plausible root causes for an ambiguous error.** A test failure could be a wrong assertion or a wrong implementation. → ask which to change.
- **Spec contradiction.** Section A says "use Postgres" and section B says "use SQLite for development." → ask which is current.

## When NOT to ask

Don't call `ask_user` for any of:

- **Typos in the spec.** Fix and continue. Note the correction in your task summary.
- **Sensible defaults the spec doesn't override.** No port specified for an HTTP server? Use 3000 (or the project's existing convention). No log format? Use the project's existing one. No timeout? Use 30s.
- **Stylistic preferences not pinned in the spec.** Tabs vs. spaces, single vs. double quotes, function vs. arrow — match the project's existing convention (read a few files and follow what's there).
- **Naming choices.** Pick a sensible name from the spec's vocabulary. Document it in your task summary if non-obvious.
- **Implementation details that don't change behavior.** Whether to use `for` or `forEach`, `Map` or `Object` — pick what fits the existing code style.
- **Anything you can verify by reading the codebase.** The wiki, the existing source, the project README, the tests — read them before asking. The operator will not be impressed if you ask a question whose answer is in `README.md`.

## How to ask well

A good question is:

- **Specific.** "Should auth use JWT or session cookies?" — not "What auth strategy do you want?"
- **Optioned when the answer space is enumerable.** Pass `options=["jwt", "session"]` so the operator gets a one-tap reply. Free-form answer when the choice is genuinely open-ended.
- **Decision-grade.** The operator should be able to answer in <10 seconds. If your question needs three paragraphs of context, you're doing the wrong thing — read more of the codebase first, or raise a `FINDING` instead.

A bad question:

- "I'm not sure how to proceed." → too vague; the operator can't help.
- "Should I write the test first or the implementation?" → answered by the `tdd` skill if it's loaded; or by the project convention.
- "What style of error handling do you want?" → look at how the existing code handles errors and match it.

## What to do with the answer

The tool returns the operator's answer as a string. Use it as the input to your next decision and continue. Do **not** ask follow-up clarifying questions in a chain unless they're independently load-bearing — escalating once is fine, three times in a row burns operator goodwill.

## What to do on timeout / abort

If the tool returns `isError: true`:

- **Timed out** (operator didn't answer within the deadline): pick a sensible default and continue, leaving a `FINDING [MEDIUM]` flagging the unresolved choice. The operator can correct it post-hoc, and the next iteration's reviewer will catch it.
- **Aborted** (brain shutdown / signal): stop your current task cleanly and let the brain handle directive recovery. Don't try to spin up a workaround.

## Brain-checkpointed alternative

If you're a brain-side agent (architect, planner, reviewer, verifier), the brain already calls `escalateBlocked` at phase boundaries on your behalf. Use `ask_user` only when you're a tool-using agent (scaffolder, builder, fixer, investigator) executing inside a worker subprocess.
