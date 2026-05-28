import { describe, expect, it } from 'vitest';
import { checkFeatureFile, checkDecisionFile } from './schema-check.js';

describe('checkFeatureFile', () => {
  it('accepts a valid feature file', () => {
    const content = `---
kind: feature
id: cli-run-command
status: documented
documented_in:
  - README.md#cli-reference
---

# Feature: CLI run command

Body...
`;
    const findings = checkFeatureFile('docs/knowledge/features/cli-run-command.md', content);
    expect(findings).toEqual([]);
  });

  it('rejects missing kind field', () => {
    const content = `---
id: cli-run-command
status: documented
documented_in:
  - README.md#cli
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('graph-schema-error');
    expect(findings[0]?.location?.frontmatter_field).toBe('kind');
  });

  it('rejects invalid status enum', () => {
    const content = `---
kind: feature
id: x
status: invalid-status
documented_in:
  - README.md#x
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.location?.frontmatter_field === 'status')).toBe(true);
  });

  it('rejects missing documented_in', () => {
    const content = `---
kind: feature
id: x
status: documented
---

Body
`;
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.some((f) => f.location?.frontmatter_field === 'documented_in')).toBe(true);
  });

  it('rejects malformed YAML front-matter', () => {
    const content = `---
kind: feature
id: ['this is malformed
status: documented
---

Body
`;
    // Note: above YAML has an unclosed `[` which gray-matter rejects.
    const findings = checkFeatureFile('features/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('graph-schema-error');
  });
});

describe('checkDecisionFile', () => {
  it('accepts a valid decision file', () => {
    const content = `---
kind: decision
id: 2026-05-28-drop-pipeline-name
date: 2026-05-28
made_by_task: 01HZZZZZZZZZZZZZZZZZZZZZZZ
modifies:
  - cli-run-command
---

# Decision: Drop pipeline_name arg

## Context
...

## Decision
...

## Consequences
...
`;
    const findings = checkDecisionFile('decisions/2026-05-28-drop.md', content);
    expect(findings).toEqual([]);
  });

  it('rejects missing required body sections', () => {
    const content = `---
kind: decision
id: 2026-05-28-x
date: 2026-05-28
made_by_task: 01HZZZZZZZZZZZZZZZZZZZZZZZ
modifies:
  - cli-run-command
---

# Decision: x

## Context
...
`;
    // Missing ## Decision and ## Consequences sections
    const findings = checkDecisionFile('decisions/x.md', content);
    expect(findings.length).toBeGreaterThan(0);
  });
});
