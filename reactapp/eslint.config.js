// reactapp/eslint.config.js — flat config: JS + TypeScript recommended rules
// plus React hooks correctness. Pragmatic set only — no style rules; Prettier-
// style formatting is left to the editor.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['node_modules', '../tethysapp/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Allow intentionally-unused function args when underscore-prefixed
      // (matches the tsc noUnusedParameters convention already in use).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
