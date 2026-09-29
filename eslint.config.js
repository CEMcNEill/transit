import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Game logic must be a pure function of (runSeed, actions). These are the ways
// nondeterminism usually leaks in; use rng.ts and the turn counter instead.
const determinismMessage =
  'packages/core must be deterministic: use the seeded RNG in rng.ts and the game turn, not wall-clock time or ambient randomness.';

export default tseslint.config(
  { ignores: ['**/dist/**', 'raw/**', 'data/**', 'pipeline/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: determinismMessage },
        { object: 'Date', property: 'now', message: determinismMessage },
        { object: 'performance', property: 'now', message: determinismMessage },
        { object: 'crypto', property: 'getRandomValues', message: determinismMessage },
        { object: 'crypto', property: 'randomUUID', message: determinismMessage },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: determinismMessage },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'packages/core has no DOM.' },
        { name: 'document', message: 'packages/core has no DOM.' },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['packages/*/test/**/*.ts', '**/*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
);
