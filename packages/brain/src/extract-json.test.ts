import { describe, expect, it } from 'vitest';

import { extractJsonObject } from './triage.js';

describe('extractJsonObject', () => {
  it('returns the object when the input is a single object', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('strips surrounding prose', () => {
    expect(extractJsonObject('here you go: {"a":1}\n\nhope that helps')).toBe('{"a":1}');
  });

  it('returns undefined when no object is present', () => {
    expect(extractJsonObject('just words, no json here')).toBeUndefined();
  });

  it('returns the outer object when objects are nested', () => {
    expect(extractJsonObject('{"a":{"b":2}}')).toBe('{"a":{"b":2}}');
  });

  it('does not count `{` inside a string value (regression: architect wiki content)', () => {
    // The architect's response has `content` strings with `{` characters
    // (e.g. a `package.json` snippet inside a markdown code block). Without
    // string-state tracking the brace counter went wrong and the parser
    // failed with "no JSON object" on otherwise-valid responses.
    const s = '{"pages":[{"slug":"o.md","content":"```json\\n{ \\"name\\": \\"x\\" }\\n```"}]}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it('does not count `}` inside a string value', () => {
    const s = '{"a":"closer-} inside string","b":1}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it('handles escaped quotes inside strings', () => {
    const s = '{"a":"has \\"escaped\\" quotes and a { brace"}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it('handles a backslash escape immediately before a closing quote', () => {
    // Sanity: `"\\"` is a valid JSON string containing a single backslash;
    // the closing `"` after the escape must not be treated as escaped.
    const s = '{"a":"\\\\"}';
    expect(extractJsonObject(s)).toBe(s);
  });

  it('returns the FIRST balanced object when several exist', () => {
    expect(extractJsonObject('{"a":1} extra {"b":2}')).toBe('{"a":1}');
  });

  it('parses-out roundtrips through JSON.parse', () => {
    const s =
      'prefix ```json\n{"pages":[{"slug":"o.md","content":"# Header\\n\\n```json\\n{\\"k\\":1}\\n```"}]}\n``` suffix';
    const out = extractJsonObject(s);
    expect(out).toBeDefined();
    const parsed = JSON.parse(out as string) as {
      pages: { slug: string; content: string }[];
    };
    expect(parsed.pages[0].slug).toBe('o.md');
    expect(parsed.pages[0].content).toContain('{"k":1}');
  });
});
