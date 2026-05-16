import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';
import decoratorPosition from 'eslint-plugin-decorator-position';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**', 'eslint.config.*'],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  prettier,

  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    plugins: {
      'decorator-position': decoratorPosition,
      import: importPlugin,
    },
    rules: {
      'decorator-position/decorator-position': [
        'error',
        {
          properties: 'above',
          methods: 'above',
        },
      ],
      'import/newline-after-import': ['error', { count: 1 }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: false }],

      'padding-line-between-statements': [
        'warn',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: 'const', next: 'expression' },
        { blankLine: 'always', prev: 'expression', next: 'const' },
        { blankLine: 'always', prev: 'expression', next: 'expression' },
        { blankLine: 'any', prev: 'const', next: 'const' },
      ],
    },
  },

  // architecture.md §3, §13: role isolation enforced at compile time.
  //   - calculator + detector: no @external/brokerage (vendor-agnostic)
  //   - every role: no cross-role @roles/* imports (bus + DB only)
  // Each role gets one combined no-restricted-imports rule below
  // (ESLint applies the last-matching config per rule key, so a single
  // rule per file is clearer than splitting across two blocks).
  {
    files: ['src/roles/collector/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@roles/calculator/*', '@roles/executor/*', '@roles/detector/*'] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/roles/calculator/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@external/brokerage/*', '@external/brokerage'],
              message: 'calculator must not depend on brokerage gateway.',
            },
            { group: ['@roles/collector/*', '@roles/executor/*', '@roles/detector/*'] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/roles/executor/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@roles/collector/*', '@roles/calculator/*', '@roles/detector/*'] },
          ],
        },
      ],
    },
  },
  {
    files: ['src/roles/detector/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@external/brokerage/*', '@external/brokerage'],
              message: 'detector must not depend on brokerage gateway.',
            },
            { group: ['@roles/collector/*', '@roles/calculator/*', '@roles/executor/*'] },
          ],
        },
      ],
    },
  },
);
