// ESLint 9 flat config. See `docs/decisions/0001-typescript-on-node.md` for the
// language stack; lint discipline (no console, no any, type-only imports) is
// enforced here.

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.cjs',
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
      'eslint.config.js',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Pull in typescript-eslint's recommended ruleset, then layer ours.
      ...tsPlugin.configs.recommended.rules,

      // Enforce structured logging — no console anywhere except the logger
      // package (overridden below). console.warn / console.error stay allowed
      // as a last-resort escape for the logger itself before init.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // The logger package itself may use console (it implements the sinks).
    files: ['packages/logger/src/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests can be looser about typing.
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Prettier last so it disables stylistic rules that conflict with formatter.
  prettierConfig,
];
