# Phase 6b — local config references

> Session scratchpad. The real channel config will land in SQLite via
> the 6b.5 `github_channel_config` migration. This file only records
> the references the session needs until then — **no secret contents**.
> Delete (or overwrite) when the phase closes.

## Resolved 2026-04-21 (6b.1)

| Ref       | Value                       | Notes                                                                      |
| --------- | --------------------------- | -------------------------------------------------------------------------- |
| PAT       | `env:GITHUB_TOKEN`          | Stored in `HKCU\Environment` (persistent user env). Classic PAT.           |
| Test repo | `momobits/factory5-6b-smoke` | Public, issues enabled, default branch `main`. Throwaway, user-controlled. |

Scope for the PAT: `public_repo` is sufficient for the public throwaway
(issues read/write, PR comment read/write). Upgrade to `repo` only if
the smoke repo is flipped private; `read:org` stays unnecessary while
the repo is in a personal namespace.

## Runtime caveats

- A bash process started **before** `setx` ran won't see `$GITHUB_TOKEN`
  — the parent-process env is frozen at spawn. A fresh Claude Code
  session, or any subprocess `factoryd` spawns after the `setx`,
  inherits the value from `HKCU\Environment`. Not a bug, just a Windows
  env-propagation detail worth remembering when debugging a "token
  missing" error mid-session.
- Code that reads the token must fail loudly when it's empty. Never
  fall back to unauthenticated GH API — the 60-req/hr anonymous rate
  limit would make the 6b.8 live smoke flaky.
- Never log the token value. At most, log prefix + length at `debug`
  (e.g., `ghp_… (len=40)`).

## Rollback / cleanup (phase close or abandonment)

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete the throwaway repo (UI, or `gh repo delete momobits/factory5-6b-smoke --yes`).
3. Clear the env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`, then log out/in (or broadcast `WM_SETTINGCHANGE`) so running shells drop it.
4. Remove this file and any references to it from session handoff notes.
