import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const browser = { ...globals.browser, ...globals.es2024 };
const network = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map(
  (name) => ({ name, message: 'Only src/ui/load.mjs reads over the network.' }),
);
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
      // The browser and model surfaces must stay loadable in a bundler with no
      // Node builtins. src/io/ and the two entry points below own all file
      // access, so the boundary is the path, not a list of file names.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*'],
              message: 'Only src/io/, src/node.mjs and src/cli.mjs do I/O.',
            },
            {
              group: ['**/io/*'],
              message: 'Reach src/io/ through src/node.mjs, not directly.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'Only src/io/, src/node.mjs and src/cli.mjs do I/O.',
        },
        ...network,
      ],
    },
  },
  {
    // The one module that fetches a model over the network, so a component
    // cannot grow its own request and bypass the parse and validation it does.
    files: ['src/ui/load.mjs'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'Only src/io/, src/node.mjs and src/cli.mjs do I/O.',
        },
      ],
    },
  },
  {
    files: ['src/io/**/*.mjs', 'src/node.mjs', 'src/cli.mjs'],
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
];
