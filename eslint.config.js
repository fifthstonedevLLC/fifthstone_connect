import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
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
    // The portal: React hooks must follow the rules of hooks (calls in a stable order).
    files: ['apps/portal/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Plain Node scripts (e.g. the marketing preview server) get Node globals.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { URL: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },
);
