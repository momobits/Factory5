/**
 * Ad-hoc reassessment script for Phase 5c local validation.
 *
 * Runs `assess()` against an already-built project, prints the AssessResult.
 * Used to verify ADR 0017's shared-provisioning refactor produces
 * gate.verify=true on the Phase 5c built project without paying for another
 * full factory build.
 */

import { readFile } from 'node:fs/promises';
import { exit, stdout } from 'node:process';

import { assess } from '@factory5/assessor';
import { initLogger } from '@factory5/logger';

interface Plan {
  tasks: { expectedOutputs: { files: string[] } }[];
}

async function main(projectPath: string, planPath: string): Promise<void> {
  initLogger({ processName: 'reassess', noFile: true });

  const plan = JSON.parse(await readFile(planPath, 'utf8')) as Plan;
  const expectedModules = Array.from(
    new Set(plan.tasks.flatMap((t) => t.expectedOutputs.files).filter((f) => f.endsWith('.py'))),
  );

  const result = await assess({
    projectPath,
    expectedModules,
    testFramework: 'auto',
  });

  stdout.write(`\n=== AssessResult ===\n`);
  stdout.write(`gate.build:       ${String(result.gateResults.build)}\n`);
  stdout.write(`gate.integration: ${String(result.gateResults.integration)}\n`);
  stdout.write(`gate.verify:      ${String(result.gateResults.verify)}\n`);
  stdout.write(`testsPassed:      ${String(result.testsPassed)}\n`);
  stdout.write(`testsFailed:      ${String(result.testsFailed)}\n`);
  stdout.write(`importsOk:        ${String(result.importsOk)}\n`);
  if (result.importErrors.length > 0) {
    stdout.write(`importErrors:\n`);
    for (const e of result.importErrors.slice(0, 8)) stdout.write(`  - ${e}\n`);
  }
  stdout.write(`modulesExisting:  ${String(result.modulesExisting)}\n`);
  stdout.write(`modulesMissing:   [${result.modulesMissing.join(', ')}]\n`);
  stdout.write(`gitClean:         ${String(result.gitClean)}\n`);
  stdout.write(`hasReadme:        ${String(result.hasReadme)}\n`);
  stdout.write(`hasLicense:       ${String(result.hasLicense)}\n`);
  stdout.write(`hasGitignore:     ${String(result.hasGitignore)}\n`);
  stdout.write(`hasArchitecture:  ${String(result.hasArchitecture)}\n`);
  if (result.provisioning !== undefined) {
    stdout.write(`provisioning:\n`);
    stdout.write(`  runtime:     ${result.provisioning.runtime}\n`);
    stdout.write(`  toolPath:    ${result.provisioning.toolPath}\n`);
    stdout.write(`  toolVersion: ${result.provisioning.toolVersion}\n`);
    if (result.provisioning.installOk !== undefined) {
      stdout.write(`  installOk:   ${String(result.provisioning.installOk)}\n`);
    }
    if (result.provisioning.envSource !== undefined) {
      stdout.write(`  envSource:   ${result.provisioning.envSource}\n`);
    }
    if (result.provisioning.preflight !== undefined) {
      stdout.write(
        `  preflight:   ${result.provisioning.preflight.command} (ok=${String(result.provisioning.preflight.ok)})\n`,
      );
    }
  }
  if (result.failureMode !== undefined) {
    stdout.write(`failureMode:      ${result.failureMode}\n`);
  }
  stdout.write('\n');
  exit(result.gateResults.verify ? 0 : 2);
}

const projectArg = process.argv[2];
const planArg = process.argv[3];
if (projectArg === undefined || planArg === undefined) {
  stdout.write('usage: tsx scripts/reassess.ts <projectPath> <planPath>\n');
  exit(2);
}
main(projectArg, planArg).catch((err: unknown) => {
  stdout.write(`reassess failed: ${String(err)}\n`);
  exit(1);
});
