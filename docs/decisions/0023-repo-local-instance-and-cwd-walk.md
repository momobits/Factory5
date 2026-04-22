# 0023 — Repo-local factory instances via cwd-walk discovery

- **Status:** Accepted
- **Date:** 2026-04-22
- **Supersedes (partially):** [ADR 0004](0004-category-based-model-routing.md) — the config-location half (the `~/.factory5/config.toml` path references). The category-routing decision in ADR 0004 stands untouched.

## Context

Through Phase 7, factory5 resolved its data directory with a platform-branched path inside `packages/logger/src/paths.ts#dataDir()`:

```ts
// Old dataDir()
if (platform === 'win32') return join(localAppData, 'factory5');
return join(homedir(), '.factory5');
```

This shipped a single implicit instance per user. In practice operators quickly wanted two things the single-instance model couldn't give them:

1. **Multiple factories running in parallel** — e.g. a `primary` instance for day-to-day work, a `client-acme` instance with its own Discord bot + workspace for a specific contract, an `experiments` instance for throwaway builds. Each wants its own `config.toml`, its own `factory.db` (so spend / findings / directives don't comingle), and its own daemon on its own port.
2. **State co-located with the code** — the only visual pairing of "factory5 lives here" was the git checkout; the actual state lived at `%LOCALAPPDATA%\factory5\` on Windows (hidden three clicks deep) and `~/.factory5/` on Unix. For a dev repo this was counterintuitive.

The mechanism that already supported (1) was the `FACTORY5_DATA_DIR` env var. Operators could set it per-shell to point at a different instance. That worked, but required remembering to `setx` / `export` before every session and meant factory's "current instance" was implicit in the shell environment rather than physically marked on disk.

## Decision

**`dataDir()` resolves in three steps, in order:**

```ts
// 1. Explicit env-var override (for CI, systemd services, unusual cwd cases).
if (env['FACTORY5_DATA_DIR']) return env['FACTORY5_DATA_DIR'];

// 2. Walk up from process.cwd() looking for a `.factory/` dir containing
//    config.toml. Finding one marks an instance root — same convention
//    Git uses with `.git/`.
const discovered = discoverInstanceFromCwd();
if (discovered) return discovered;

// 3. Fallback: ~/.factory/ on all platforms (C:\Users\<user>\.factory\ on
//    Windows — no more %LOCALAPPDATA%). Preserves "one implicit instance"
//    for users who never set up a repo-local dir.
return join(homedir(), INSTANCE_DIR_NAME);
```

**The instance-root marker is `.factory/config.toml`.** Directory name alone isn't enough — ADR 0021 already uses `<workspace>/<project>/.factory/project.json` for per-project identity, so a bare `.factory/` directory doesn't uniquely mean "instance." The discovery predicate requires `config.toml` inside. A project's `.factory/` (which holds `project.json`, not `config.toml`) is correctly skipped by the walk.

**Name: `.factory/` everywhere** — repo-local primary, homedir fallback, env-var target. The leading dot groups it with `.git/`, `.claude/`, `.control/` in the filesystem view.

**Walk bound:** 32 levels. Any real tree is orders of magnitude shallower; the bound defends against pathological filesystems (cycles, infinite symlinks).

**Platform default shifted:** `~/.factory/` on all OSes (not `%LOCALAPPDATA%\factory5\` on Windows). Operator preference — visual parity with `~/.git/`, `~/.ssh/`, `~/.config/` beats conformance to Microsoft's convention for a tool whose primary workflow already looks Unix-y (pnpm, git, tsx).

## Consequences

**Positive:**

- **Multi-instance works by `cd`-ing, no env-var bookkeeping.** `cd ~/projects/factory5` uses the repo-local primary; `cd D:\clients\acme` uses that instance; `cd ~` with no env var uses `~/.factory/`.
- **Physical location marks the instance on disk**, matching operator intuition. The answer to "which factory am I talking to?" is "look at where you are." Same semantics Git, Node (package-lock walk), rg (.gitignore walk), etc. already use.
- **Secrets are co-located with the code that reads them**, minus the gitignore line. Developers inspecting their own config don't have to context-switch to a hidden AppData path.
- **No migration required for new clones.** A new dev clones the repo, creates `.factory/config.toml` from a template, and everything just works — no env var to set, no system-level settings to touch.
- **Env var remains as an escape hatch** for CI, systemd services, Docker mounts, or anywhere cwd-walk gives the wrong answer.
- **Backward compatibility for plain users:** the `~/.factory/` fallback means anyone who doesn't want to think about data-dir placement gets one implicit instance in their home dir. No breakage for the `factory init && factory build foo` happy path.

**Negative:**

- **Gitignore hygiene is now load-bearing.** `config.toml` holds Discord + Telegram bot tokens. If a contributor adds a repo-level `.gitignore` override or accidentally `git add -f .factory/config.toml`, tokens leak to git history. Mitigation: prominent inline comment in `.gitignore`; `.factory/` excluded at the top-level and never re-enabled; a follow-up can add a pre-commit hook that refuses anything under `.factory/`.
- **`git clean -fdx` nukes the instance.** `.factory/` is untracked; a forceful clean deletes the database, logs, and config. Low frequency, but high blast radius. Mitigation: operator habit + documentation; auto-backup is a separate concern that can be layered later.
- **Slight divergence from Windows convention.** Putting user data under the repo rather than `%LOCALAPPDATA%\` is non-standard on Windows. Acceptable — factory5 is a dev tool, not a shipped desktop app, and the convention that matters for dev tools (Git, Node, rg, etc.) is cwd-relative.
- **Two semantically distinct uses of `.factory/`.** Per-project `.factory/project.json` (ADR 0021) and per-instance `.factory/config.toml` both live in directories named `.factory/`. Different trees, different contents; distinguishable by reading the files inside. A reader who sees `.factory/` alone must check what's in it. Documented; test locks the distinction.

**Reversible?** Yes. Switching back to a fixed-location data dir is a one-commit revert + migration of files from `.factory/` to wherever we moved to. The data shape (SQLite schemas, config.toml TOML) is unchanged by this ADR — only resolution precedence moved.

## Alternatives considered

- **Keep the env-var-only model.** Rejected: operator-experience bug. Every new instance requires remembering to `setx` per shell; no physical marker on disk says "here's a factory instance."
- **Project-local instance inside a per-build workspace** (e.g. `<workspace>/.factory/` one level deep rather than at the factory5 repo root). Rejected: conflates the factory instance's scope (developer's whole setup) with a single built project's scope. A factory instance hosts many builds and many workspaces; pinning it to one workspace breaks that model.
- **A "current instance" pointer file** (e.g. `~/.factory5-current` pointing at the active instance path). Rejected: adds mutable per-user state for something the cwd already implies, and breaks down when two shells are pointed at two instances simultaneously.
- **Config auto-discovery without a marker directory** (scan for a `factory5.config.toml` file anywhere in the tree). Rejected: no clean semantic answer to "where do logs / the DB live?" — the marker directory owns all instance-scoped state in one place.
- **Webhook-style registration** where `factory` always boots against a central registry the operator edits. Rejected: too heavy for a dev tool; solves problems factory5 doesn't have.

## Migration

The existing primary instance at `%LOCALAPPDATA%\factory5\` migrated to `<repo>/.factory/` in the same session this ADR was authored. `config.toml`'s `# Lives at:` header was rewritten to the new path; `factory.db` was copied verbatim. `factory doctor --skip-call --skip-discord` from the repo root resolved via cwd-walk, loaded the new config, and re-probed `@Factory5_bot` successfully; `factory spend` re-rendered the same $63.17 / 116 calls / 2 projects + unassigned rollup. The old `%LOCALAPPDATA%\factory5\` tree was then removed.
