/**
 * `factory completion <shell>` — unit tests (Phase 4.5).
 *
 * Verifies the script-shape contract of the three supported shells
 * (`bash`, `zsh`, `pwsh`). Manual `factory completion <shell> >> rcfile`
 * + tab-test is the acceptance gate per the tier-4 plan; these tests
 * gate the structural invariants (script type, top-level commands
 * present, nested sub-subcommands present, install hint present).
 *
 * Static completion only — no project / directive runtime lookup, so the
 * scripts have no dynamic data to fixture against.
 */

import { describe, expect, it } from 'vitest';

import { runCompletion } from './completion.js';

describe('runCompletion (Phase 4.5)', () => {
  describe('bash', () => {
    it('returns a bash completion script with shebang-style hint and complete -F binding', () => {
      const result = runCompletion({ shell: 'bash' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('# factory bash completion');
      expect(result.stdout).toContain('complete -F _factory_complete factory');
    });

    it('lists all top-level commands the operator can tab into', () => {
      const result = runCompletion({ shell: 'bash' });
      // Sample of high-traffic commands from cli.ts — every one MUST appear
      // in the completion word list, otherwise tab won't surface them.
      const expected = [
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
      for (const cmd of expected) {
        expect(result.stdout).toContain(cmd);
      }
    });

    it('handles nested groups (daemon / budget / directive / findings / project / questions)', () => {
      const result = runCompletion({ shell: 'bash' });
      // Sub-subcommand presence — operator typing `factory daemon <TAB>`
      // should see start/stop/status/restart, etc.
      expect(result.stdout).toMatch(/start.*stop.*status.*restart|restart.*start.*stop.*status/);
      expect(result.stdout).toContain('mark-blocked'); // directive
      expect(result.stdout).toContain('list'); // findings / project
      expect(result.stdout).toContain('cleanup'); // questions
      expect(result.stdout).toContain('set'); // budget
    });
  });

  describe('zsh', () => {
    it('returns a zsh completion script with #compdef directive', () => {
      const result = runCompletion({ shell: 'zsh' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('#compdef factory');
    });

    it('lists all top-level commands', () => {
      const result = runCompletion({ shell: 'zsh' });
      expect(result.stdout).toContain('build');
      expect(result.stdout).toContain('chat');
      expect(result.stdout).toContain('ask');
      expect(result.stdout).toContain('budget');
      expect(result.stdout).toContain('project');
    });
  });

  describe('pwsh', () => {
    it('returns a PowerShell completion script using Register-ArgumentCompleter', () => {
      const result = runCompletion({ shell: 'pwsh' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Register-ArgumentCompleter');
      expect(result.stdout).toContain('-CommandName factory');
    });

    it('lists all top-level commands', () => {
      const result = runCompletion({ shell: 'pwsh' });
      expect(result.stdout).toContain('build');
      expect(result.stdout).toContain('cancel');
      expect(result.stdout).toContain('ask');
    });
  });

  describe('errors', () => {
    it('rejects an unknown shell with exit 2 and a helpful message', () => {
      const result = runCompletion({ shell: 'fish' as 'bash' });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('fish');
      expect(result.stdout).toMatch(/bash|zsh|pwsh/);
    });
  });

  describe('install hint', () => {
    it('every shell variant includes a brief install hint at the top', () => {
      for (const shell of ['bash', 'zsh', 'pwsh'] as const) {
        const result = runCompletion({ shell });
        expect(result.stdout).toMatch(/install/i);
      }
    });
  });
});
