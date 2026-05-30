/**
 * Doc-fiction engine. Executes documented code blocks under user-facing
 * section headings (Quick Start, Configuration, etc.) per the project's
 * validator config. Non-zero exit → structured finding pointing at the
 * doc location with a "this example fails for users" message.
 *
 * Runtime-agnostic: each (language, runner) tuple in the config defines
 * a shell command template with substitution markers (<interpreter>,
 * <CODE>, <BLOCK_FILE>, <binary>, <ARGS>).
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { glob } from 'glob';

import { killProcessTree } from '@factory5/core/proc';
import { createLogger } from '@factory5/logger';

import type { ValidatorConfig } from './config-schema.js';
import type { PartialFinding } from './schema-check.js';

const log = createLogger('coherence-validator.doc-fiction');

export interface DocFictionOptions {
  projectPath: string;
  config: ValidatorConfig;
}

interface CodeBlock {
  filePath: string;
  language: string;
  content: string;
  startLine: number;
  sectionHeading: string;
  sectionAnchor: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractCodeBlocks(filePath: string, content: string, headingsRegex: RegExp): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split(/\r?\n/);
  let currentHeading = '';
  let inBlock = false;
  let blockLang = '';
  let blockStart = 0;
  let blockBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch !== null && !inBlock) {
      currentHeading = headingMatch[1] ?? '';
      continue;
    }
    const fenceMatch = line.match(/^```(\S*)\s*$/);
    if (fenceMatch !== null && !inBlock) {
      inBlock = true;
      blockLang = fenceMatch[1] ?? '';
      blockStart = i + 1;
      blockBuffer = [];
      continue;
    }
    if (fenceMatch !== null && inBlock) {
      inBlock = false;
      if (headingsRegex.test(currentHeading) && blockLang.length > 0) {
        blocks.push({
          filePath,
          language: blockLang,
          content: blockBuffer.join('\n'),
          startLine: blockStart + 1,
          sectionHeading: currentHeading,
          sectionAnchor: slugify(currentHeading),
        });
      }
      continue;
    }
    if (inBlock) blockBuffer.push(line);
  }
  return blocks;
}

async function runWithTimeout(
  cmd: readonly string[],
  timeoutMs: number,
  cwd: string,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolveFn) => {
    const [bin, ...args] = cmd;
    if (bin === undefined) {
      resolveFn({ exitCode: 1, stderr: 'empty command' });
      return;
    }
    const child = spawn(bin, args, { cwd, shell: false });
    let stderr = '';
    const timer = setTimeout(() => {
      // Graceful first (POSIX), then force-kill the whole tree — a documented
      // example may itself spawn children (servers, subprocesses).
      child.kill('SIGTERM');
      setTimeout(() => killProcessTree(child), 2000);
      resolveFn({ exitCode: 124, stderr: stderr + '\n<timed out>' });
    }, timeoutMs);
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveFn({ exitCode: code ?? 1, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveFn({ exitCode: 1, stderr: err.message });
    });
  });
}

function substituteTemplate(
  template: string,
  vars: {
    code?: string;
    blockFile?: string;
    binary?: string;
    args?: string;
    interpreter: string;
  },
): string {
  return template
    .replace(/<interpreter>/g, vars.interpreter)
    .replace(/<CODE>/g, vars.code ?? '')
    .replace(/<BLOCK_FILE>/g, vars.blockFile ?? '')
    .replace(/<binary>/g, vars.binary ?? '')
    .replace(/<ARGS>/g, vars.args ?? '');
}

/**
 * Executes documented code blocks found within headings matched by
 * `config.doc_fiction.section_headings` and emits a finding for each
 * block that exits non-zero.
 *
 * @param opts - Project path and resolved validator config.
 * @returns Array of partial findings; empty array means no doc-fiction violations.
 */
export async function checkDocFiction(opts: DocFictionOptions): Promise<PartialFinding[]> {
  if (opts.config.doc_fiction === undefined) return [];
  const findings: PartialFinding[] = [];
  const headingsRegex = new RegExp(`^(${opts.config.doc_fiction.section_headings})$`, 'i');

  // Resolve interpreter path relative to project (for paths starting with `.`)
  const interpreter = opts.config.interpreter.startsWith('.')
    ? resolve(opts.projectPath, opts.config.interpreter)
    : opts.config.interpreter;

  const tmpDir = await mkdtemp(join(tmpdir(), 'factory5-doc-fiction-'));

  for (const pattern of opts.config.doc_globs) {
    const files = await glob(pattern, { cwd: opts.projectPath, absolute: false });
    for (const rel of files) {
      const abs = resolve(opts.projectPath, rel);
      let content: string;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        continue;
      }

      const blocks = extractCodeBlocks(rel, content, headingsRegex);
      for (const block of blocks) {
        const runner = opts.config.doc_fiction.code_block_runners[block.language];
        if (runner === undefined) continue;

        // Write block to tmp file for BLOCK_FILE substitution
        const blockFile = join(
          tmpDir,
          `block-${String(Date.now())}-${Math.random().toString(36).slice(2)}.${block.language}`,
        );
        await writeFile(blockFile, block.content, 'utf8');

        const cmd = runner.command.map((c) =>
          substituteTemplate(c, {
            code: block.content,
            blockFile,
            interpreter,
          }),
        );

        const { exitCode, stderr } = await runWithTimeout(
          cmd,
          runner.timeout_ms ?? 30000,
          opts.projectPath,
        );

        if (exitCode !== 0) {
          findings.push({
            category: 'doc-fiction',
            severity: 'high',
            title: `Documented example fails to execute: ${rel} §${block.sectionHeading}`,
            why: `The ${block.language} code block under "${block.sectionHeading}" produced exit code ${String(exitCode)}. Users following this example will hit the same error.`,
            suggested_fix: `Either fix the code so the example runs, update the documented surface to match working code, or move the block out of an example-section heading.`,
            auto_fixable: false,
            location: {
              file: rel,
              line: block.startLine,
              anchor: `#${block.sectionAnchor}`,
            },
          });
          log.debug(
            { filePath: rel, exitCode, stderr: stderr.slice(0, 200) },
            'doc-fiction: block failed',
          );
        }
      }
    }
  }

  return findings;
}
