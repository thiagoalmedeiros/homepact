// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.angular/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['apps/api/**/*.ts', '**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.ts'], languageOptions: { globals: globals.browser } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
