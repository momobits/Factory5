/**
 * Cross-platform tests for the path-prefix algebra. Mirrors the
 * compatibility table in ADR 0028 §2 — every row should be a case here.
 *
 * Tests that depend on Windows-specific normalisation (case-insensitive
 * compare, drive-letter tolerance, UNC paths) skip on Linux/macOS;
 * tests that depend on Linux byte-equal behaviour skip on Windows.
 * Path-platform-agnostic tests run everywhere.
 */

import { describe, expect, it } from 'vitest';

import { normaliseForCompare, pathInsideAny, resolveAgainst } from './path-prefix.js';

const onWindows = process.platform === 'win32';

describe('normaliseForCompare', () => {
  it('returns empty string for empty input', () => {
    expect(normaliseForCompare('')).toBe('');
  });

  it('replaces backslashes with forward slashes', () => {
    if (onWindows) {
      expect(normaliseForCompare('C:\\foo\\bar')).toBe('c:/foo/bar');
    } else {
      expect(normaliseForCompare('a\\b\\c')).toBe('a/b/c');
    }
  });

  it('strips trailing slash but not the root slash', () => {
    expect(normaliseForCompare('/foo/')).toBe('/foo');
    expect(normaliseForCompare('/foo/bar/')).toBe('/foo/bar');
  });

  it('preserves single root slash', () => {
    expect(normaliseForCompare('/')).toBe('/');
  });

  it('is idempotent', () => {
    const once = normaliseForCompare('/a/b/c/');
    expect(normaliseForCompare(once)).toBe(once);
  });

  describe.skipIf(!onWindows)('Windows-specific', () => {
    it('lowercases drive letter', () => {
      expect(normaliseForCompare('C:\\Users\\Foo')).toBe('c:/users/foo');
      expect(normaliseForCompare('c:\\Users\\Foo')).toBe('c:/users/foo');
    });

    it('preserves drive-root trailing slash', () => {
      expect(normaliseForCompare('C:\\')).toBe('c:/');
      expect(normaliseForCompare('C:/')).toBe('c:/');
    });

    it('lowercases the whole path', () => {
      expect(normaliseForCompare('C:/Users/Momo/Documents')).toBe('c:/users/momo/documents');
    });
  });

  describe.skipIf(onWindows)('Linux/macOS-specific', () => {
    it('preserves case (byte-equal compare)', () => {
      expect(normaliseForCompare('/Users/Foo')).toBe('/Users/Foo');
    });
  });
});

describe('pathInsideAny', () => {
  it('returns false for empty roots', () => {
    expect(pathInsideAny('/anywhere', [])).toBe(false);
  });

  it('returns false for empty path', () => {
    expect(pathInsideAny('', ['/anywhere'])).toBe(false);
  });

  it('matches a path equal to a root', () => {
    expect(pathInsideAny('/a/b', ['/a/b'])).toBe(true);
  });

  it('matches a path inside a root', () => {
    expect(pathInsideAny('/a/b/c', ['/a/b'])).toBe(true);
    expect(pathInsideAny('/a/b/c/d', ['/a/b'])).toBe(true);
  });

  it('rejects a path that prefix-matches but is not inside (no separator boundary)', () => {
    // /foo/bar must NOT be considered inside /foo/ba.
    expect(pathInsideAny('/foo/bar', ['/foo/ba'])).toBe(false);
  });

  it('handles trailing slash on root', () => {
    expect(pathInsideAny('/a/b/c', ['/a/b/'])).toBe(true);
    expect(pathInsideAny('/a/b', ['/a/b/'])).toBe(true);
  });

  it('handles trailing slash on path', () => {
    expect(pathInsideAny('/a/b/', ['/a/b'])).toBe(true);
  });

  it('returns true if any root in the array matches', () => {
    expect(pathInsideAny('/a/b', ['/x', '/a/b', '/y'])).toBe(true);
  });

  it('returns false when no root matches', () => {
    expect(pathInsideAny('/c', ['/a', '/b'])).toBe(false);
  });

  it('skips empty roots without throwing', () => {
    expect(pathInsideAny('/a/b', ['', '/a'])).toBe(true);
    expect(pathInsideAny('/a/b', ['', ''])).toBe(false);
  });

  describe.skipIf(!onWindows)('Windows-specific', () => {
    it('matches case-insensitively', () => {
      expect(pathInsideAny('C:\\Users\\Momo\\file.txt', ['c:\\users\\momo'])).toBe(true);
      expect(pathInsideAny('c:/users/momo/file.txt', ['C:/USERS/MOMO'])).toBe(true);
    });

    it('handles mixed separators', () => {
      expect(pathInsideAny('C:\\Users\\Momo/file.txt', ['C:/Users/Momo'])).toBe(true);
    });

    it('handles drive letter case mismatch', () => {
      expect(pathInsideAny('c:\\Users\\X', ['C:\\Users'])).toBe(true);
    });

    it('preserves separator-boundary requirement on Windows too', () => {
      expect(pathInsideAny('C:\\Users\\Foo', ['C:\\Use'])).toBe(false);
    });
  });

  describe.skipIf(onWindows)('Linux/macOS-specific', () => {
    it('matches case-sensitively (byte-equal)', () => {
      expect(pathInsideAny('/Users/Momo/file.txt', ['/users/momo'])).toBe(false);
      expect(pathInsideAny('/Users/Momo/file.txt', ['/Users/Momo'])).toBe(true);
    });
  });
});

describe('resolveAgainst', () => {
  it('returns absolute path unchanged (after normalisation)', () => {
    if (onWindows) {
      expect(resolveAgainst('C:\\cwd', 'C:\\absolute\\path')).toBe('C:\\absolute\\path');
    } else {
      expect(resolveAgainst('/cwd', '/absolute/path')).toBe('/absolute/path');
    }
  });

  it('resolves a relative path against cwd', () => {
    if (onWindows) {
      expect(resolveAgainst('C:\\cwd', 'sub/file.txt')).toBe('C:\\cwd\\sub\\file.txt');
    } else {
      expect(resolveAgainst('/cwd', 'sub/file.txt')).toBe('/cwd/sub/file.txt');
    }
  });

  it('collapses .. traversal to absolute', () => {
    if (onWindows) {
      expect(resolveAgainst('C:\\cwd\\sub', '..\\..\\escape')).toBe('C:\\escape');
    } else {
      expect(resolveAgainst('/cwd/sub', '../../escape')).toBe('/escape');
    }
  });

  it('handles `.` (current dir) by returning cwd', () => {
    if (onWindows) {
      expect(resolveAgainst('C:\\cwd', '.')).toBe('C:\\cwd');
    } else {
      expect(resolveAgainst('/cwd', '.')).toBe('/cwd');
    }
  });
});
