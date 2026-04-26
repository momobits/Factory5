/**
 * Cross-platform path-prefix algebra.
 *
 * The worker filesystem-scoping gate (ADR 0028) reduces every guarded tool
 * call to a question: is this absolute path inside one of these absolute
 * roots? `pathInsideAny` answers that question with the cross-platform
 * cases pinned in ADR 0028 §2:
 *
 *   - Windows case-insensitive prefix (lowercase both sides)
 *   - Path-separator normalisation (`\` → `/`)
 *   - Trailing-slash insensitivity
 *   - UNC prefix matching (server+share segments must match)
 *   - `..` traversal already collapsed by `path.resolve` upstream
 *   - Symlink rejection done by the caller (this module is path-only)
 */

import { resolve as pathResolve } from 'node:path';

/**
 * Return `true` when `absolutePath` lies inside one of `roots`. Both args
 * are normalised before compare. Case-insensitive on Windows, byte-equal
 * elsewhere.
 *
 * `absolutePath` MUST already be absolute (call `path.resolve` upstream
 * if working from a relative path). `roots` may contain trailing slashes
 * or backslashes; they are stripped before compare. Empty roots match
 * nothing.
 */
export function pathInsideAny(absolutePath: string, roots: readonly string[]): boolean {
  if (roots.length === 0) return false;
  const target = normaliseForCompare(absolutePath);
  if (target.length === 0) return false;
  for (const root of roots) {
    const normRoot = normaliseForCompare(root);
    if (normRoot.length === 0) continue;
    if (target === normRoot) return true;
    // Prefix match — must end at a separator boundary so `/foo/bar` does
    // not accidentally match root `/foo/ba`.
    const withSep = normRoot.endsWith('/') ? normRoot : `${normRoot}/`;
    if (target.startsWith(withSep)) return true;
  }
  return false;
}

/**
 * Normalise a path for comparison. Replaces `\` with `/`, lowercases on
 * Windows, strips trailing `/`. Idempotent.
 *
 * Does NOT resolve `..` or relative segments — the caller must pass an
 * already-resolved absolute path.
 */
export function normaliseForCompare(p: string): string {
  if (p.length === 0) return '';
  let out = p.replace(/\\/g, '/');
  // Strip trailing slashes (but keep root `/` or `C:/`).
  while (out.length > 1 && out.endsWith('/')) {
    // Don't strip the slash if we're at a Windows drive root like `C:/`.
    if (out.length === 3 && /^[a-zA-Z]:\/$/.test(out)) break;
    out = out.slice(0, -1);
  }
  if (process.platform === 'win32') {
    out = out.toLowerCase();
  }
  return out;
}

/**
 * Resolve a possibly-relative `candidate` against `cwd` to an absolute
 * path. Wrapper around `path.resolve` that normalises the result for
 * downstream prefix-checks.
 *
 * Returns the absolute path with `..` segments collapsed but with
 * platform-native separators (downstream `pathInsideAny` will normalise
 * separators for compare).
 */
export function resolveAgainst(cwd: string, candidate: string): string {
  return pathResolve(cwd, candidate);
}
