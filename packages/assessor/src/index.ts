/**
 * @factory5/assessor — ground-truth project assessment.
 *
 * Phase 1 implementation will add real runners + checks. For now this is a
 * scaffold so consumers can typecheck-import the package.
 *
 * @packageDocumentation
 */

import { createLogger } from '@factory5/logger';

const log = createLogger('assessor');

export interface AssessResult {
  modulesExisting: number;
  modulesMissing: string[];
  testsPassed: number;
  testsFailed: number;
  testsErrors: number;
  testFramework: string;
  importsOk: boolean;
  importErrors: string[];
  hasReadme: boolean;
  hasLicense: boolean;
  hasGitignore: boolean;
  hasArchitecture: boolean;
  gitClean: boolean;
  gateResults: { build: boolean; integration: boolean; verify: boolean };
}

/** Stub — Phase 1. */
export async function assess(_projectPath: string): Promise<AssessResult> {
  log.warn('assess: stub — Phase 1 implementation pending');
  throw new Error('@factory5/assessor.assess not yet implemented (Phase 1)');
}
