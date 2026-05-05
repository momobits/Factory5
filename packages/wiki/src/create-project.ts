/**
 * `createProject` — scaffold a new project at a target directory.
 *
 * Shared by the CLI (`factory init <name>`) and the daemon (`POST
 * /api/v1/projects`, ADR 0027 §3.7). Refuses to overwrite an existing
 * project identity or `CLAUDE.md` to preserve ADR 0021's guarantee that
 * a project's id never silently changes underneath downstream history.
 *
 * Caller-side path resolution: the CLI honours absolute / relative /
 * workspace-rooted forms of the project name; the daemon just joins
 * the configured workspace with the user-supplied name. By the time
 * `createProject` runs, `projectPath` is already resolved.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadOrCreateProjectMetadata,
  readProjectMetadata,
  type ProjectLanguage,
} from './project-metadata.js';

export interface CreateProjectInput {
  /** Absolute path where the project dir should live. */
  projectPath: string;
  /** Human-readable project name; written into `CLAUDE.md`'s `# heading` and `metadata.name`. */
  name: string;
  /** Picks both the `CLAUDE.md` scaffold and `metadata.language` (read by the assessor). */
  language: ProjectLanguage;
  /** Override the default per-language scaffold. Useful when the daemon receives a CLAUDE.md body from the operator. */
  claudeMd?: string;
}

export interface CreateProjectResult {
  /** Project identity (ULID) issued by `loadOrCreateProjectMetadata`. */
  id: string;
  /** Absolute project path (echoes input). */
  path: string;
  /** Absolute path of the written `CLAUDE.md`. */
  claudeMdPath: string;
}

/**
 * Thrown when refusing to overwrite an existing project. Two reasons:
 *
 *  - `existing-metadata` — `<projectPath>/.factory/project.json` already
 *    exists; re-tagging would orphan the project's spend / findings /
 *    build history (ADR 0021).
 *  - `existing-claude-md` — `<projectPath>/CLAUDE.md` already exists;
 *    the project may be partially scaffolded by hand or by another tool.
 *
 * The CLI maps this to exit 2; the daemon maps it to HTTP 409.
 */
export class CreateProjectAlreadyExistsError extends Error {
  readonly projectPath: string;
  readonly reason: 'existing-metadata' | 'existing-claude-md';
  readonly existingProjectId?: string;
  constructor(
    projectPath: string,
    reason: 'existing-metadata' | 'existing-claude-md',
    existingProjectId?: string,
  ) {
    const detail =
      reason === 'existing-metadata'
        ? `${projectPath} already has a project identity${
            existingProjectId !== undefined ? ` (${existingProjectId})` : ''
          }`
        : `${projectPath}/CLAUDE.md already exists`;
    super(`createProject: ${detail} — refusing to overwrite`);
    this.name = 'CreateProjectAlreadyExistsError';
    this.projectPath = projectPath;
    this.reason = reason;
    if (existingProjectId !== undefined) this.existingProjectId = existingProjectId;
  }
}

/**
 * Scaffold a new project: refuse-overwrite guards, `mkdirSync`, write
 * `CLAUDE.md`, claim a `project.json` identity. Returns the new id and
 * the resolved paths.
 *
 * `readProjectMetadata` may also throw `ProjectMetadataCorruptError`
 * when an existing `project.json` is malformed; `createProject` mirrors
 * the legacy CLI behaviour and treats that as "no existing identity"
 * (the corrupt file is then caught and re-surfaced by
 * `loadOrCreateProjectMetadata` further down). Operators recover by
 * deleting the file or restoring it from backup.
 */
export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const { projectPath, name, language } = input;
  const claudeMdPath = join(projectPath, 'CLAUDE.md');

  const existingMeta = await readProjectMetadata(projectPath).catch(() => undefined);
  if (existingMeta !== undefined) {
    throw new CreateProjectAlreadyExistsError(projectPath, 'existing-metadata', existingMeta.id);
  }
  if (existsSync(claudeMdPath)) {
    throw new CreateProjectAlreadyExistsError(projectPath, 'existing-claude-md');
  }

  mkdirSync(projectPath, { recursive: true });
  const body = input.claudeMd ?? scaffoldClaudeMd(name, language);
  writeFileSync(claudeMdPath, body, 'utf8');

  const meta = await loadOrCreateProjectMetadata(projectPath, name, {
    initialMetadata: { language },
  });

  return { id: meta.id, path: projectPath, claudeMdPath };
}

/**
 * Per-language `CLAUDE.md` scaffold. Minimal but valid spec the operator
 * can fill in — names the language explicitly so downstream agents do
 * not need to infer it.
 */
export function scaffoldClaudeMd(project: string, language: ProjectLanguage): string {
  const header = `# ${project}\n\n## Project Overview\n\nDescribe what this project does in 2-3 sentences.\n`;
  switch (language) {
    case 'python':
      return (
        header +
        '\n## Tech Stack\n\n- Python 3.11+\n- pytest for tests\n- Add runtime dependencies as needed\n\n' +
        '## Key Modules\n\n1. `src/<module>.py` — describe each module here\n\n' +
        '## Coding Standards\n\n- Type hints on all functions\n- Docstrings on public functions\n\n' +
        '## Testing\n\n- pytest, tests under `tests/`\n'
      );
    case 'node':
      return (
        header +
        '\n## Tech Stack\n\n- TypeScript 5.x, strict mode, ESM (NodeNext)\n- Node 20+\n- pnpm for package management\n- vitest for tests\n\n' +
        '## Key Modules\n\n1. `src/index.ts` — entry point\n2. `src/<module>.ts` — describe each module\n\n' +
        '## Coding Standards\n\n- `"strict": true` in tsconfig\n- No `any`; use `unknown` and narrow\n- Public exports carry a one-line TSDoc\n\n' +
        '## Testing\n\n- vitest; `*.test.ts` next to source\n\n' +
        '## package.json scripts\n\nThe assessor invokes `pnpm install → pnpm typecheck (or tsc --noEmit) → pnpm test`, so expose `typecheck` and `test` scripts.\n'
      );
    case 'go':
      return (
        header +
        '\n## Tech Stack\n\n- Go 1.21+\n- standard library first; add modules sparingly\n\n' +
        '## Key Modules\n\n1. `main.go` — entry point\n2. `internal/<pkg>/` — describe each package\n\n' +
        '## Coding Standards\n\n- `go fmt` clean\n- Errors wrapped with context\n\n' +
        '## Testing\n\n- `go test ./...`; tests in `_test.go` files alongside source\n'
      );
    case 'rust':
      return (
        header +
        '\n## Tech Stack\n\n- Rust stable (1.70+)\n- Cargo\n\n' +
        '## Key Modules\n\n1. `src/main.rs` (binary) or `src/lib.rs` (library)\n2. `src/<module>.rs` — describe each module\n\n' +
        '## Coding Standards\n\n- `cargo fmt` clean, `cargo clippy` clean\n- No `unwrap()` outside tests; use `?` and proper error types\n\n' +
        '## Testing\n\n- `cargo test`; unit tests in `#[cfg(test)] mod tests`, integration tests under `tests/`\n'
      );
  }
}
