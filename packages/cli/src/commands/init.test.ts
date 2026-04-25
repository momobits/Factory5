import { describe, expect, it } from 'vitest';

import { scaffoldClaudeMd } from './init.js';

describe('scaffoldClaudeMd (Phase 10.8)', () => {
  it('python scaffold names pytest and src/<module>.py', () => {
    const out = scaffoldClaudeMd('my-cli', 'python');
    expect(out).toMatch(/# my-cli/);
    expect(out).toMatch(/Python 3\.11\+/);
    expect(out).toMatch(/pytest/);
    expect(out).toMatch(/src\/<module>\.py/);
  });

  it('node scaffold names pnpm + vitest + the assessor pipeline', () => {
    const out = scaffoldClaudeMd('logs', 'node');
    expect(out).toMatch(/# logs/);
    expect(out).toMatch(/TypeScript 5\.x/);
    expect(out).toMatch(/pnpm/);
    expect(out).toMatch(/vitest/);
    // The Node runtime gate runs `pnpm install → pnpm typecheck → pnpm test`,
    // so the scaffold must remind the operator to expose those scripts.
    expect(out).toMatch(/typecheck/);
  });

  it('go scaffold names go test ./... and main.go', () => {
    const out = scaffoldClaudeMd('svc', 'go');
    expect(out).toMatch(/Go 1\.21\+/);
    expect(out).toMatch(/main\.go/);
    expect(out).toMatch(/go test \.\/\.\.\./);
  });

  it('rust scaffold names cargo test and main.rs/lib.rs', () => {
    const out = scaffoldClaudeMd('cli', 'rust');
    expect(out).toMatch(/Rust stable/);
    expect(out).toMatch(/cargo test/);
    expect(out).toMatch(/main\.rs|lib\.rs/);
  });
});
