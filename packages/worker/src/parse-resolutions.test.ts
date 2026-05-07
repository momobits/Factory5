import { describe, expect, it } from 'vitest';

import { parseResolutions } from './parse-resolutions.js';

describe('parseResolutions', () => {
  it('returns an empty array when no markers are present', () => {
    expect(parseResolutions('nothing here')).toEqual([]);
  });

  it('extracts a single-line FIXED resolution', () => {
    const out = parseResolutions('RESOLUTION F003 (FIXED): clamped index in src/auth.ts:127');
    expect(out).toEqual([
      { fid: 'F003', status: 'FIXED', resolution: 'clamped index in src/auth.ts:127' },
    ]);
  });

  it('extracts VERIFIED and WONTFIX statuses', () => {
    const verified = parseResolutions('RESOLUTION F042 (VERIFIED): regression test passes');
    expect(verified).toHaveLength(1);
    expect(verified[0]?.status).toBe('VERIFIED');

    const wontfix = parseResolutions(
      'RESOLUTION F099 (WONTFIX): false alarm — operator can re-tier',
    );
    expect(wontfix).toHaveLength(1);
    expect(wontfix[0]?.status).toBe('WONTFIX');
  });

  it('is case-insensitive on the keyword and status', () => {
    const out = parseResolutions('resolution F042 (verified): regression test passes');
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('VERIFIED');
  });

  it('captures multi-line descriptions until a blank line or next marker', () => {
    const text = [
      'RESOLUTION F003 (FIXED): clamped profile index in src/auth.ts:127',
      'regression test added at tests/auth.test.ts',
      '',
      'some other unrelated text the agent emitted',
      'RESOLUTION F004 (WONTFIX): false alarm',
      'reviewer was mistaken; existing behavior is correct per spec §2.4',
    ].join('\n');
    const out = parseResolutions(text);
    expect(out).toHaveLength(2);
    expect(out[0]?.fid).toBe('F003');
    expect(out[0]?.resolution).toMatch(/clamped profile index/);
    expect(out[0]?.resolution).toMatch(/regression test added/);
    expect(out[1]?.fid).toBe('F004');
    expect(out[1]?.status).toBe('WONTFIX');
    expect(out[1]?.resolution).toMatch(/false alarm/);
    expect(out[1]?.resolution).toMatch(/reviewer was mistaken/);
  });

  it('rejects malformed lines that look like markers', () => {
    expect(parseResolutions('RESOLUTION F003 FIXED: missing parens around status')).toEqual([]);
    expect(parseResolutions('RESOLUTION F003 (DONE): not a recognized status')).toEqual([]);
    expect(parseResolutions('RESOLUTION 003 (FIXED): missing F prefix on id')).toEqual([]);
    expect(parseResolutions('RESOLUTION F003 (FIXED) missing colon after parens')).toEqual([]);
  });

  it('ignores RESOLUTION mentions mid-line (line-anchored regex)', () => {
    const text = 'as documented, "RESOLUTION F003 (FIXED): foo" flips the row';
    expect(parseResolutions(text)).toEqual([]);
  });

  it('tolerates extra whitespace around the FID and status', () => {
    const out = parseResolutions('RESOLUTION   F042   (FIXED):  clamped value');
    expect(out).toHaveLength(1);
    expect(out[0]?.fid).toBe('F042');
    expect(out[0]?.resolution).toBe('clamped value');
  });

  it('parses multiple back-to-back resolutions', () => {
    const text = [
      'RESOLUTION F010 (FIXED): first fix in src/a.ts',
      'RESOLUTION F011 (FIXED): second fix in src/b.ts',
      'RESOLUTION F012 (VERIFIED): third one — verify test green',
    ].join('\n');
    const out = parseResolutions(text);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.fid)).toEqual(['F010', 'F011', 'F012']);
    expect(out.map((r) => r.status)).toEqual(['FIXED', 'FIXED', 'VERIFIED']);
  });
});
