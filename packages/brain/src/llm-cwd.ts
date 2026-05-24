/**
 * Resolve the claude-cli cwd for an LLM call so it cannot inherit factoryd's
 * own repo dir.
 *
 * Background: `claude-cli` spawned without an explicit `cwd` inherits the
 * parent process's `process.cwd()`. For factoryd that's the factory5 repo
 * itself, which means the model session picks up factory5's own
 * `CLAUDE.md` + `.control/STATE.md` + slash commands. We saw this in the
 * pythonetl resume incident (directive 01KSD0VNPZ0KD8DHKP82XS2C48 on
 * 2026-05-24) — the planner returned plain English narrating factory5's
 * STATE.md drift instead of emitting JSON tasks for the target project.
 *
 * Every brain agent must call this when assembling the
 * {@link ProviderRequest} so the provider's spawn lands in a project dir
 * (or a neutral non-project dir) and never in factoryd's own cwd.
 *
 * Returns `projectPath` when it's a non-empty string; otherwise returns
 * `os.tmpdir()` — a guaranteed-non-project directory that isolates the
 * subprocess from factoryd's own working tree. Never returns `undefined`,
 * so callers don't need an additional `?? tmpdir()` at the call site.
 *
 * @param projectPath - The directive's `payload.projectPath` (or any other
 *   project-rooted absolute path) when known. Pass `undefined` for
 *   directives that legitimately lack a project root (e.g. chat /
 *   system / auto-answer for a generic question).
 */
import { tmpdir } from 'node:os';

export function resolveLlmCwd(projectPath: string | undefined): string {
  return projectPath !== undefined && projectPath.length > 0 ? projectPath : tmpdir();
}
