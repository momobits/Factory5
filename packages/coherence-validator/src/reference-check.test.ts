import { describe, expect, it } from 'vitest';
import { checkReferences } from './reference-check.js';

describe('checkReferences', () => {
  it('passes when all documented_in anchors resolve', () => {
    const docs = new Map([['README.md', '# Project\n\n## CLI Reference\n\nDoc text.']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'documented',
        documented_in: ['README.md#cli-reference'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: [] });
    expect(findings).toEqual([]);
  });

  it('fails when documented_in points to a missing file', () => {
    const docs = new Map<string, string>();
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'documented',
        documented_in: ['README.md#cli'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: [] });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.title).toContain('README.md');
  });

  it('fails when documented_in anchor does not exist in target file', () => {
    const docs = new Map([['README.md', '# Project\n\n## Installation\n']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'documented',
        documented_in: ['README.md#cli-reference'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: [] });
    expect(findings.some((f) => f.title.includes('cli-reference'))).toBe(true);
  });

  it('fails when implements references unknown task ID', () => {
    const docs = new Map([['README.md', '## CLI Reference']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'implemented',
        documented_in: ['README.md#cli-reference'],
        implements: ['01XBOGUSTASKID'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: ['01HVALIDTASK1234567890'] });
    expect(findings.some((f) => f.title.includes('implements'))).toBe(true);
  });

  it('passes when implements references a known task ID', () => {
    const docs = new Map([['README.md', '## CLI Reference']]);
    const feature = {
      filePath: 'features/cli.md',
      frontmatter: {
        kind: 'feature',
        id: 'cli',
        status: 'implemented',
        documented_in: ['README.md#cli-reference'],
        implements: ['01HVALIDTASK1234567890'],
      },
    };
    const findings = checkReferences([feature], docs, { taskIds: ['01HVALIDTASK1234567890'] });
    expect(findings).toEqual([]);
  });
});
