/**
 * Wiki readiness gate — before the planner runs, verify the architect has
 * produced enough structured design documentation to decompose into tasks.
 *
 * This is factory2's `wiki-readiness` discipline ported: the gate forces the
 * architect to put concrete interfaces and module contracts into the wiki
 * rather than hand-waving.
 */

import { createLogger } from '@factory5/logger';

import { readWiki, type WikiPage } from './wiki.js';

const log = createLogger('wiki.readiness');

export interface ReadinessCheck {
  id: string;
  description: string;
  ok: boolean;
  detail?: string;
}

export interface ReadinessReport {
  ok: boolean;
  checks: ReadinessCheck[];
}

/**
 * Run the readiness gate on a project's wiki. Does not throw on failure —
 * returns a structured report.
 *
 * Current checks (Phase 1, intentionally simple):
 *   1. At least one page named `overview*.md` or `architecture*.md` exists
 *   2. At least one page references module contracts (contains `## Modules`
 *      or a page under `modules/`)
 *   3. At least one page documents testing (`## Testing` section or
 *      `testing*.md` page)
 *   4. Total wiki content exceeds a minimum byte threshold (signals real
 *      design work, not just a placeholder)
 */
export async function wikiReadiness(projectPath: string): Promise<ReadinessReport> {
  const pages = await readWiki(projectPath);
  const checks: ReadinessCheck[] = [
    checkOverview(pages),
    checkModules(pages),
    checkTesting(pages),
    checkMinimumContent(pages),
  ];
  const ok = checks.every((c) => c.ok);
  log.info(
    { projectPath, ok, failed: checks.filter((c) => !c.ok).map((c) => c.id) },
    'readiness checked',
  );
  return { ok, checks };
}

function pageSlugLower(p: WikiPage): string {
  return p.slug.toLowerCase();
}

function checkOverview(pages: readonly WikiPage[]): ReadinessCheck {
  const hit = pages.some((p) => {
    const s = pageSlugLower(p);
    return s.includes('overview') || s.includes('architecture');
  });
  return {
    id: 'overview-exists',
    description: 'An overview or architecture page is present.',
    ok: hit,
    ...(hit ? {} : { detail: 'no page matching overview*.md or architecture*.md' }),
  };
}

function checkModules(pages: readonly WikiPage[]): ReadinessCheck {
  const hitByDir = pages.some((p) => pageSlugLower(p).startsWith('modules/'));
  const hitBySection = pages.some((p) => /\n##\s+Modules\b/i.test(p.content));
  const ok = hitByDir || hitBySection;
  return {
    id: 'modules-documented',
    description: 'Modules are documented (pages under modules/ or a `## Modules` section).',
    ok,
    ...(ok ? {} : { detail: 'no modules/ pages and no `## Modules` section found' }),
  };
}

function checkTesting(pages: readonly WikiPage[]): ReadinessCheck {
  const ok = pages.some((p) => {
    const s = pageSlugLower(p);
    if (s.includes('testing') || s.includes('test')) return true;
    return /\n##\s+Testing\b/i.test(p.content);
  });
  return {
    id: 'testing-documented',
    description: 'Testing approach is documented.',
    ok,
    ...(ok ? {} : { detail: 'no testing page or `## Testing` section' }),
  };
}

const MIN_WIKI_BYTES = 800;

function checkMinimumContent(pages: readonly WikiPage[]): ReadinessCheck {
  const total = pages.reduce((n, p) => n + Buffer.byteLength(p.content, 'utf8'), 0);
  const ok = total >= MIN_WIKI_BYTES;
  return {
    id: 'minimum-content',
    description: `Wiki has at least ${String(MIN_WIKI_BYTES)} bytes of content.`,
    ok,
    ...(ok ? {} : { detail: `only ${String(total)} bytes across ${String(pages.length)} pages` }),
  };
}
