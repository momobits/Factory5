/**
 * Wiki page read/write — markdown pages under `<project>/docs/knowledge/`.
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { createLogger } from '@factory5/logger';

import { projectPaths } from './paths.js';

const log = createLogger('wiki.pages');

export interface WikiPage {
  /** Slug path relative to `docs/knowledge/`, e.g. `architecture.md` or `modules/api.md`. */
  slug: string;
  /** Full file path. */
  path: string;
  /** Raw markdown content. */
  content: string;
}

/**
 * Load every markdown page under `<project>/docs/knowledge/` recursively.
 * Returns an empty array if the directory does not exist.
 */
export async function readWiki(projectPath: string): Promise<WikiPage[]> {
  const { knowledge } = projectPaths(projectPath);
  const files = await listMarkdownFiles(knowledge);
  const pages: WikiPage[] = [];
  for (const path of files) {
    const content = await readFile(path, 'utf8');
    pages.push({
      slug: relative(knowledge, path).replace(/\\/g, '/'),
      path,
      content,
    });
  }
  return pages;
}

/**
 * Write a wiki page. Creates parent directories as needed. Slug may contain
 * forward slashes to nest into subdirectories (e.g. `modules/api.md`).
 *
 * Returns the absolute path written.
 */
export async function writeWikiPage(
  projectPath: string,
  slug: string,
  content: string,
): Promise<string> {
  const { knowledge } = projectPaths(projectPath);
  const normalizedSlug = slug.replace(/\\/g, '/');
  if (normalizedSlug.startsWith('/') || normalizedSlug.includes('..')) {
    throw new Error(`writeWikiPage: refuse unsafe slug: ${JSON.stringify(slug)}`);
  }
  const target = join(knowledge, ...normalizedSlug.split('/'));
  await mkdir(dirname(target), { recursive: true });
  const final = content.endsWith('\n') ? content : `${content}\n`;
  await writeFile(target, final, 'utf8');
  log.info({ projectPath, slug: normalizedSlug }, 'wiki page written');
  return target;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return out;
    throw err;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdownFiles(full)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out.sort();
}
