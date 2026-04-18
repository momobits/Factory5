import { describe, expect, it } from 'vitest';

import { parseFindings } from './parse-findings.js';

describe('parseFindings', () => {
  it('returns an empty array when no markers are present', () => {
    expect(parseFindings('nothing here')).toEqual([]);
  });

  it('extracts a single-line finding', () => {
    const out = parseFindings('FINDING [HIGH] src/auth.py: missing input validation');
    expect(out).toEqual([
      { severity: 'HIGH', target: 'src/auth.py', description: 'missing input validation' },
    ]);
  });

  it('is case-insensitive on the keyword and severity', () => {
    const out = parseFindings('finding [medium] README.md: typo in the intro');
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('MEDIUM');
  });

  it('captures multi-line descriptions until a blank line or next marker', () => {
    const text = [
      'FINDING [LOW] src/a.ts: first issue',
      'more detail on the first',
      '',
      'some other unrelated text',
      'FINDING [CRITICAL] src/b.ts: second issue',
      'detail of second',
    ].join('\n');
    const out = parseFindings(text);
    expect(out).toHaveLength(2);
    expect(out[0]?.description).toMatch(/first issue\nmore detail on the first/);
    expect(out[1]?.severity).toBe('CRITICAL');
    expect(out[1]?.description).toMatch(/second issue\ndetail of second/);
  });

  it('tolerates extra whitespace around the header and target', () => {
    const out = parseFindings('FINDING [HIGH]   packages/core/src/index.ts:  content');
    expect(out).toHaveLength(1);
    expect(out[0]?.target).toBe('packages/core/src/index.ts');
    expect(out[0]?.description).toBe('content');
  });
});
