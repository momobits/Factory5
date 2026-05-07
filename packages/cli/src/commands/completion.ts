/**
 * `factory completion <shell>` — emit a static tab-completion script
 * (Phase 4.5).
 *
 * Three shells supported: `bash`, `zsh`, `pwsh`. Each emits a self-
 * contained script the operator pipes into their rc-file:
 *
 *   factory completion bash >> ~/.bashrc
 *   factory completion zsh  > ~/.zsh/_factory   (and add to fpath)
 *   factory completion pwsh >> $PROFILE
 *
 * Static surface only — completes top-level command names and the
 * fixed nested sub-subcommands (e.g. `daemon start|stop|status|restart`,
 * `project list|show|delete`). Dynamic completion (project names,
 * directive ids) is intentionally deferred — it would require running
 * factory inside the completion script, which adds latency on every
 * tab press. See the tier-4 plan §4.5 "Risks + decisions" for context.
 *
 * Manual smoke is the acceptance gate (per the plan): install on each
 * shell, type `factory <TAB>`, see the command list. The tests gate the
 * structural invariants — script type, command list completeness —
 * because behavioural tests would need a real shell harness.
 *
 * Exit codes:
 *   0 — script printed to stdout
 *   2 — unknown `<shell>` (operator typo)
 */

import { exit, stdout } from 'node:process';

import type { Command } from 'commander';

export const COMPLETION_EXIT = {
  OK: 0,
  INVALID_INPUT: 2,
} as const;

export type CompletionExitCode = (typeof COMPLETION_EXIT)[keyof typeof COMPLETION_EXIT];

export type SupportedShell = 'bash' | 'zsh' | 'pwsh';

export interface CompletionOptions {
  shell: SupportedShell;
}

export interface HandlerResult {
  stdout: string;
  exitCode: CompletionExitCode;
}

/**
 * Single source of truth for the static-completion surface. Mirrors
 * what `cli.ts` registers, plus the nested sub-subcommands each
 * `program.command(...)` group exposes. Update whenever a top-level
 * command is added or a nested group changes shape.
 */
const TOP_LEVEL_COMMANDS: readonly string[] = [
  'answer',
  'ask',
  'budget',
  'build',
  'cancel',
  'chat',
  'completion',
  'daemon',
  'directive',
  'doctor',
  'findings',
  'init',
  'project',
  'questions',
  'resume',
  'spend',
  'status',
  'ui-token',
];

const NESTED_SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  budget: ['set'],
  daemon: ['start', 'stop', 'status', 'restart'],
  directive: ['mark-blocked'],
  findings: ['list', 'show', 'backfill', 'mark'],
  project: ['list', 'show', 'delete'],
  questions: ['cleanup'],
  completion: ['bash', 'zsh', 'pwsh'],
};

export function runCompletion(opts: CompletionOptions): HandlerResult {
  switch (opts.shell) {
    case 'bash':
      return { stdout: bashScript(), exitCode: COMPLETION_EXIT.OK };
    case 'zsh':
      return { stdout: zshScript(), exitCode: COMPLETION_EXIT.OK };
    case 'pwsh':
      return { stdout: pwshScript(), exitCode: COMPLETION_EXIT.OK };
    default:
      return {
        stdout: `factory completion: unknown shell "${String(opts.shell)}" — expected one of: bash | zsh | pwsh\n`,
        exitCode: COMPLETION_EXIT.INVALID_INPUT,
      };
  }
}

// -----------------------------------------------------------------------------
// Templates — one per shell. Each is self-contained and idempotent: sourcing
// twice rebinds the completer, no leaked state.
// -----------------------------------------------------------------------------

function bashScript(): string {
  const top = TOP_LEVEL_COMMANDS.join(' ');
  const cases = Object.entries(NESTED_SUBCOMMANDS)
    .map(
      ([cmd, subs]) =>
        `    ${cmd})\n      COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") )\n      ;;`,
    )
    .join('\n');

  return `# factory bash completion
#
# Install:
#   factory completion bash >> ~/.bashrc
#   source ~/.bashrc
#
# Or for one shell session:
#   source <(factory completion bash)

_factory_complete() {
  local cur
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"

  local commands="${top}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  local first="\${COMP_WORDS[1]}"
  case "$first" in
${cases}
    *)
      COMPREPLY=( $(compgen -f -- "$cur") )
      ;;
  esac
  return 0
}

complete -F _factory_complete factory
`;
}

function zshScript(): string {
  // _describe-friendly format: 'name:short description'. Descriptions come
  // from the operator-facing surface: keep short and informational.
  const descriptions: Record<string, string> = {
    answer: 'Close a pending askUser/escalate_blocked question',
    ask: 'Single-shot chat (one directive, one reply, exit)',
    budget: 'Per-project budget defaults (max-usd / max-steps)',
    build: 'Build a project',
    cancel: 'Actively cancel a directive',
    chat: 'Interactive chat against factoryd',
    completion: 'Emit a shell completion script',
    daemon: 'Start / stop / status / restart factoryd',
    directive: 'Directive lifecycle (mark-blocked)',
    doctor: 'Smoke-check the stack',
    findings: 'Cross-project findings registry',
    init: 'Write config.toml with sensible defaults',
    logs: 'Pointer to ~/.factory5/logs/ (placeholder)',
    project: 'Per-project introspection + lifecycle (list/show/delete)',
    questions: 'Pending-question maintenance (cleanup)',
    resume: 'Resume the most recent build for a project',
    spend: 'Cross-session spend dashboard',
    status: 'Projects + recent directives + per-directive spend',
    'ui-token': 'Print the dashboard URL with the live FACTORY5_UI_TOKEN',
  };

  const commandLines = TOP_LEVEL_COMMANDS.map((c) => `    '${c}:${descriptions[c] ?? c}'`).join(
    '\n',
  );
  const subLines = Object.entries(NESTED_SUBCOMMANDS)
    .map(
      ([cmd, subs]) =>
        `    ${cmd})    _values 'subcommand' ${subs.map((s) => `'${s}'`).join(' ')} ;;`,
    )
    .join('\n');

  return `#compdef factory
#
# factory zsh completion
#
# Install:
#   factory completion zsh > "\${fpath[1]}/_factory"
#   compinit
#
# Or for one shell session:
#   source <(factory completion zsh)

_factory() {
  local -a commands
  commands=(
${commandLines}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
${subLines}
  esac
}

_factory "$@"
`;
}

function pwshScript(): string {
  const top = TOP_LEVEL_COMMANDS.map((c) => `'${c}'`).join(', ');
  const subs = Object.entries(NESTED_SUBCOMMANDS)
    .map(([cmd, list]) => `    '${cmd}'     { @(${list.map((s) => `'${s}'`).join(', ')}) }`)
    .join('\n');

  return `# factory PowerShell completion
#
# Install:
#   factory completion pwsh >> $PROFILE
#   . $PROFILE
#
# Or for one shell session:
#   factory completion pwsh | Out-String | Invoke-Expression

Register-ArgumentCompleter -Native -CommandName factory -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(${top})

  $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $depth = $tokens.Count

  if ($depth -le 2) {
    return $commands |
      Where-Object { $_ -like "$wordToComplete*" } |
      ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
  }

  $first = $tokens[1]
  $subList = switch ($first) {
${subs}
    default { @() }
  }

  return $subList |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;
}

// -----------------------------------------------------------------------------
// Commander wiring
// -----------------------------------------------------------------------------

function isSupportedShell(s: string): s is SupportedShell {
  return s === 'bash' || s === 'zsh' || s === 'pwsh';
}

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion <shell>')
    .description('emit a tab-completion script for bash | zsh | pwsh')
    .addHelpText(
      'after',
      `
Examples:
  factory completion bash >> ~/.bashrc && source ~/.bashrc
  factory completion zsh > "\${fpath[1]}/_factory" && compinit
  factory completion pwsh >> $PROFILE && . $PROFILE
  source <(factory completion bash)                 # one-shot, current shell
`,
    )
    .action((shellArg: string): void => {
      const shell = isSupportedShell(shellArg) ? shellArg : (shellArg as SupportedShell);
      const result = runCompletion({ shell });
      stdout.write(result.stdout);
      if (result.exitCode !== COMPLETION_EXIT.OK) exit(result.exitCode);
    });
}
