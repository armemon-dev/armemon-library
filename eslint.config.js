// @ts-check
/**
 * FILE: eslint.config.js
 * PATH: eslint.config.js
 *
 * WHAT: Flat ESLint config for the whole monorepo.
 * WHY:  The previous config had neither the react nor the react-hooks plugin in a
 *       codebase that is mostly React — so hook rules went unchecked, and a
 *       `// eslint-disable-next-line react-hooks/exhaustive-deps` comment in
 *       KitProvider.tsx referenced a rule that didn't exist, which ESLint itself
 *       reported as an error. Adding the plugins both fixes that and makes the
 *       disable comments meaningful.
 * HOW:  Recommended JS + TypeScript rules everywhere; React and hooks rules only for
 *       .tsx files, since the CLI packages are plain Node. Test files are allowed
 *       non-null assertions, which are appropriate in assertions.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/*.tmpl'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'no-return-await': 'error',
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-key': 'error',
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Config files run in Node and legitimately reference Node globals.
    files: ['**/*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: { process: 'readonly', __dirname: 'readonly' } },
  },
);
