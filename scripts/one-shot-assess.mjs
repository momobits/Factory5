#!/usr/bin/env node
// One-shot assessor invocation. Used to re-evaluate a project's gate
// without going through the full brain pipeline. Argv: <projectPath> [runtime]
import { assess } from '../packages/assessor/dist/index.js';

const projectPath = process.argv[2];
const runtime = process.argv[3] ?? 'python';
if (projectPath === undefined) {
  console.error('usage: one-shot-assess.mjs <projectPath> [runtime]');
  process.exit(1);
}
const result = await assess({ projectPath, runtime, testFramework: 'auto' });
console.log(JSON.stringify(result, null, 2));
