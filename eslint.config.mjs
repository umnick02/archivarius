import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const browser = { ...globals.browser, ...globals.es2024 };
const node = { ...globals.node, ...globals.es2024 };

export default [
  {
    ignores: [
      'dist/',
      '.runtime/',
      'src/generated/',
      'docs/scripts/viewer/**/*.js',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: node,
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      'no-unused-vars': [
        'error',
        { args: 'after-used', caughtErrors: 'all', ignoreRestSiblings: true },
      ],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['log', 'error', 'warn'] }],
    },
  },
  {
    files: ['src/**/*.{jsx,mjs}'],
    languageOptions: { globals: browser },
    rules: {
      // Only the file-owning modules do I/O; the browser and core surfaces
      // must stay loadable in a bundler with no Node builtins.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'Browser and core modules do no I/O.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Browser and core modules do no I/O.' },
      ],
    },
  },
  {
    files: [
      'src/cli.mjs',
      'src/node.mjs',
      'src/document-files.mjs',
      'src/project-storage.mjs',
    ],
    languageOptions: { globals: node },
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
  {
    files: ['src/**/*.jsx'],
    languageOptions: {
      globals: browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
  {
    files: ['tooling/**/*.mjs', 'docs/scripts/**/*.mjs'],
    languageOptions: { globals: node },
  },
  {
    // Browser suites drive the page with functions serialized into Chrome.
    files: ['tests/**/*.mjs'],
    languageOptions: { globals: { ...node, ...browser } },
  },
  {
    files: ['tests/consumer/*.jsx', 'examples/**/*.{js,jsx,mjs}'],
    languageOptions: {
      globals: browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // TypeScript declaration usage is checked by the packaged-consumer tsc run.
    ignores: ['tests/consumer/types.tsx'],
  },
];
