import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import { checkDocFiction } from './doc-fiction.js';
import type { ValidatorConfig } from './config-schema.js';

beforeAll(() => {
  initLogger({ processName: 'doc-fiction-test', noFile: true, noConsole: true });
});

describe('checkDocFiction', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-doc-fiction-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns empty findings when no in-scope code blocks present', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Architecture\n\nProse only.\n',
    );
    const config: ValidatorConfig = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start|Configuration',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'] },
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings).toEqual([]);
  });

  it('flags a python block that fails to execute under "Quick Start"', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Quick Start\n\n```python\nimport nonexistent_module\n```\n',
    );
    const config: ValidatorConfig = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'], timeout_ms: 10000 },
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('doc-fiction');
    expect(findings[0]?.location.file).toBe('README.md');
  });

  it('skips blocks under non-matching headings', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Internal Notes\n\n```python\nimport nonexistent\n```\n',
    );
    const config: ValidatorConfig = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'] },
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings).toEqual([]);
  });

  it('skips blocks with unconfigured languages', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Quick Start\n\n```ruby\nputs "hi"\n```\n',
    );
    const config: ValidatorConfig = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'] },
          // ruby NOT configured
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings).toEqual([]);
  });

  it('returns empty findings when doc_fiction is undefined in config', async () => {
    const config: ValidatorConfig = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      // doc_fiction absent
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings).toEqual([]);
  });
});
