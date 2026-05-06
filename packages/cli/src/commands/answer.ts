/**
 * `factory answer <question-id> <text>` — close a pending question created
 * by the brain's `askUser` / `escalateBlocked` helpers.
 *
 * Writes the answer to `pending_questions.answer` and ticks `answered_at`.
 * The brain's polling loop picks it up and unblocks its directive. The CLI
 * doesn't need the daemon running — SQLite is the bus.
 *
 * Usage examples:
 *
 *   factory answer 01K0...ULID "continue"
 *   factory answer 01K0...ULID skip
 *   factory answer 01K0...ULID -             # read answer from stdin
 */

import process, { exit, stdin, stdout } from 'node:process';

import { createLogger } from '@factory5/logger';
import { openDatabase, pendingQuestions, runMigrations } from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.answer');

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      buf += chunk.toString();
    });
    stdin.on('end', () => resolve(buf));
    stdin.on('error', reject);
  });
}

export function registerAnswerCommand(program: Command): void {
  program
    .command('answer <questionId> [text...]')
    .description('answer a pending question raised by the brain (askUser / escalate_blocked)')
    .addHelpText(
      'after',
      `
Examples:
  factory answer 01K0…ULID "continue"
  factory answer 01K0…ULID skip
  echo "yes" | factory answer 01K0…ULID -          # read answer from stdin
`,
    )
    .action(async (questionId: string, textParts: string[]) => {
      const db = openDatabase();
      try {
        runMigrations(db);
        const existing = pendingQuestions.getById(db, questionId);
        if (existing === undefined) {
          stdout.write(`factory answer: no pending question with id ${questionId}\n`);
          exit(2);
        }
        if (existing.answeredAt !== undefined) {
          stdout.write(
            `factory answer: question ${questionId} was already answered at ${existing.answeredAt}\n`,
          );
          stdout.write(`  previous answer: ${existing.answer ?? '(empty)'}\n`);
          exit(2);
        }

        let answer: string;
        if (textParts.length === 1 && textParts[0] === '-') {
          answer = (await readStdin()).trim();
          if (answer.length === 0) {
            stdout.write('factory answer: stdin was empty; refusing to record an empty answer\n');
            exit(2);
          }
        } else if (textParts.length > 0) {
          answer = textParts.join(' ');
        } else {
          stdout.write(
            'factory answer: no answer text provided (pass the text as arguments, or `-` to read stdin)\n',
          );
          exit(2);
        }

        pendingQuestions.answer(db, questionId, answer, new Date().toISOString());
        stdout.write(
          `factory answer: recorded answer for ${questionId} (directive ${existing.directiveId})\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, 'answer failed');
        stdout.write(`factory answer: error: ${msg}\n`);
        exit(1);
      } finally {
        db.close();
      }

      // Graceful exit — Commander may leave the event loop pinned.
      process.exitCode ??= 0;
    });
}
