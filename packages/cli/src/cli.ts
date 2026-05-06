/**
 * Commander program assembly. Each subcommand's implementation lives in its
 * own file under `src/commands/`; `buildCli` just wires them up.
 */

import { Command } from 'commander';

import { registerAnswerCommand } from './commands/answer.js';
import { registerBudgetCommand } from './commands/budget.js';
import { registerBuildCommand } from './commands/build.js';
import { registerCancelCommand } from './commands/cancel.js';
import { registerChatCommand } from './commands/chat.js';
import { registerDaemonCommand } from './commands/daemon.js';
import { registerDirectiveCommand } from './commands/directive.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerFindingsCommand } from './commands/findings.js';
import { registerInitCommand } from './commands/init.js';
import { registerProjectCommand } from './commands/project.js';
import { registerQuestionsCommand } from './commands/questions.js';
import { registerResumeCommand } from './commands/resume.js';
import { registerSpendCommand } from './commands/spend.js';
import { registerStatusCommand } from './commands/status.js';
import { registerStubCommands } from './commands/stubs.js';
import { registerUiTokenCommand } from './commands/ui-token.js';

export interface BuildCliOptions {
  /** Override the binary name shown in --help. */
  name?: string;
  /** Override the version shown in --version. */
  version?: string;
}

export function buildCli(opts: BuildCliOptions = {}): Command {
  const program = new Command();
  program
    .name(opts.name ?? 'factory')
    .description('factory5 — autonomous (and human-directable) software builder')
    .version(opts.version ?? '0.0.1');

  registerAnswerCommand(program);
  registerBudgetCommand(program);
  registerBuildCommand(program);
  registerCancelCommand(program);
  registerChatCommand(program);
  registerDaemonCommand(program);
  registerDirectiveCommand(program);
  registerDoctorCommand(program);
  registerFindingsCommand(program);
  registerInitCommand(program);
  registerProjectCommand(program);
  registerQuestionsCommand(program);
  registerResumeCommand(program);
  registerSpendCommand(program);
  registerStatusCommand(program);
  registerStubCommands(program);
  registerUiTokenCommand(program);

  return program;
}
