import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Logging goes through the structured logger (Phase 4) so redaction applies.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/operator/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Plain Node scripts (e.g. the marketing preview server) get Node globals.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
);
