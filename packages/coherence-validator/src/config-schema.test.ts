import { describe, expect, it } from 'vitest';
import { validatorConfigSchema } from './config-schema.js';

describe('validatorConfigSchema', () => {
  it('accepts the minimal Python config shape', () => {
    const config = {
      runtime: 'python',
      interpreter: '.factory/assessor-env/Scripts/python.exe',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start|Configuration|Example|Usage|Reference',
        code_block_runners: {
          python: {
            command: ['<interpreter>', '-c', '<CODE>'],
            timeout_ms: 30000,
          },
        },
      },
      dead_code: {
        package_globs: ['etl/**/*.py'],
        public_symbol_rule: 'no_underscore_prefix',
        exposed_via: [{ kind: 'entry_points', source: 'pyproject.toml::project.scripts' }],
        caller_scan: {
          method: 'ast_imports_and_calls',
          exclude_globs: ['tests/**'],
        },
      },
    };
    expect(() => validatorConfigSchema.parse(config)).not.toThrow();
  });

  it('rejects config missing runtime field', () => {
    expect(() => validatorConfigSchema.parse({ interpreter: 'x' })).toThrow();
  });

  it('accepts config with only doc_fiction (dead_code omitted)', () => {
    const config = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Example',
        code_block_runners: {},
      },
    };
    expect(() => validatorConfigSchema.parse(config)).not.toThrow();
  });
});
