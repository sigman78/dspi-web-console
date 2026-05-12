import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      '_base/**',
      'docs/**',
      'hil/**',
      '.svelte-kit/**',
      'svelte.config.js',
      'vite.config.ts',
      'vitest.config.ts',
      'vitest.hil.config.ts',
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      // Allow intentional `any` in narrow generic plumbing (binCodec.struct).
      '@typescript-eslint/no-explicit-any': 'off',

      // Empty bodies are deliberate placeholders (mock methods, ignored catches).
      'no-empty': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      // Allow `_`-prefixed unused vars / args.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      'no-unused-vars': 'off',

      // Style + correctness.
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-useless-escape': 'warn',

      // We ban TS triple-slash directives but allow `@ts-expect-error` with description.
      '@typescript-eslint/ban-ts-comment': ['warn', {
        'ts-expect-error': 'allow-with-description',
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
      }],
    },
  },

  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        svelteFeatures: {
          experimentalGenerics: true,
        },
      },
    },
  },

  {
    files: ['**/*.test.ts', '**/*.hil.test.ts', 'src/test-setup.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
);
