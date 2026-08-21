import globals from 'globals';
import { configs as airbnb, plugins as airbnbPlugins } from 'eslint-config-airbnb-extended';
import nodePlugin from 'eslint-plugin-n';
import promisePlugin from 'eslint-plugin-promise';
import tseslint from 'typescript-eslint';

/**
 * Flat config (ESLint 10 removed the .eslintrc system outright).
 *
 * The stack changed with it, because the old one could not come along:
 * eslint-config-airbnb-base and eslint-plugin-node are both eslintrc-only and
 * unmaintained. airbnb-extended is the maintained flat-config airbnb port, and
 * eslint-plugin-n is the maintained fork of eslint-plugin-node — hence the
 * `node/*` rules below are now `n/*`.
 *
 * Rule choices are carried over from .eslintrc.json as-is; this is a config
 * migration, not a change of house style.
 */

const maxLen = ['error', {
  code: 120,
  ignoreComments: true,
  ignoreStrings: true,
  ignoreTemplateLiterals: true,
}];

const devDependencyFiles = ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'];

export default tseslint.config(
  {
    // Replaces .eslintignore, which ESLint 10 no longer reads.
    ignores: [
      'node_modules/',
      'coverage/',
      'dist/',
      '.tsbuild/',
      'persistence/',
      'data/',
      'local_db_folder/',
    ],
  },

  // airbnb-extended ships the plugin registrations separately from the rule sets.
  airbnbPlugins.stylistic,
  airbnbPlugins.importX,
  airbnbPlugins.node,
  airbnbPlugins.typescriptEslint,

  ...airbnb.base.recommended,
  ...airbnb.base.typescript,
  nodePlugin.configs['flat/recommended'],
  promisePlugin.configs['flat/recommended'],

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'linebreak-style': 'off',
      'class-methods-use-this': 'off',
      // airbnb-extended routes formatting through @stylistic, since ESLint's own
      // formatting rules are deprecated and go away in v11.
      '@stylistic/max-len': maxLen,
      // airbnb-extended tightened these two relative to airbnb-base. Restored to
      // the old values: this fork's `try { x(); } catch { }` one-liners are a
      // deliberate style, not 138 new defects.
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
      '@stylistic/max-statements-per-line': 'off',
      'no-underscore-dangle': ['error', { allow: ['_id'] }],
      'promise/always-return': 'off',
      'promise/catch-or-return': 'off',
      // bun: specifiers are runtime builtins that the resolver cannot see.
      'import-x/no-unresolved': ['error', { ignore: ['^bun:'] }],
      'n/no-missing-import': 'off',
      'n/no-unpublished-require': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
      // We run on Bun 1.4, whose Node compatibility target is 26.3. Left at the
      // default the rule assumes Node 16 and flags fetch/AbortSignal.timeout.
      'n/no-unsupported-features/node-builtins': ['error', { version: '>=26.0.0' }],
      'n/no-unsupported-features/es-builtins': ['error', { version: '>=26.0.0' }],
    },
  },

  {
    // The config file itself only ever imports devDependencies.
    files: ['eslint.config.mjs'],
    rules: { 'n/no-unpublished-import': 'off' },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'import-x/no-unresolved': 'off',
      'import-x/extensions': 'off',
      'import-x/prefer-default-export': 'off',
      'import-x/no-extraneous-dependencies': ['error', { devDependencies: devDependencyFiles }],

      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      '@stylistic/lines-between-class-members': 'off',
      'lines-between-class-members': 'off',
      'no-underscore-dangle': ['error', { allow: ['_id', '_require'] }],
      // airbnb-extended adds naming-convention, which rejects the leading
      // underscore that no-underscore-dangle above explicitly allows.
      '@typescript-eslint/naming-convention': 'off',
      // The old config switched this off under its core name; the type-aware
      // build of the rule needs switching off under its own name too.
      '@typescript-eslint/prefer-destructuring': 'off',
      // Multi-line union types (`type X =` then `| A` / `| B`) break after the
      // `=`. The core rule never inspected type aliases, @stylistic does.
      '@stylistic/operator-linebreak': ['error', 'before', { overrides: { '=': 'ignore' } }],
      'no-await-in-loop': 'off',
      'no-restricted-syntax': 'off',
      'no-continue': 'off',
      'prefer-destructuring': 'off',
    },
  },
);
