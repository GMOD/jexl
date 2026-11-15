import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import-x'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    // the type-aware rules need every linted file in tsconfig.lint.json's
    // program, and that config has no allowJs, so the plain-JS trees are out.
    // `pnpm typecheck` still covers test/ through the config's own include.
    ignores: [
      'test/*',
      'bench/*',
      'dist/*',
      'esm/*',
      // vitest writes JS reporter assets here, so `pnpm coverage && pnpm lint`
      // failed on them. Already ignored by git and prettier.
      'coverage/*',
      'eslint.config.mjs',
      'vitest.config.ts',
      '.claude/**'
    ]
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  importPlugin.flatConfigs.recommended,
  {
    rules: {
      'no-empty': 'off',
      'no-console': [
        'warn',
        {
          allow: ['error', 'warn']
        }
      ],
      'no-underscore-dangle': 'off',
      curly: 'error',
      'object-shorthand': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      semi: ['error', 'never'],
      'spaced-comment': [
        'error',
        'always',
        {
          markers: ['/']
        }
      ],

      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true }
      ],

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true }
      ],

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          caughtErrors: 'none'
        }
      ],

      'import-x/extensions': ['error', 'ignorePackages'],
      'import-x/no-unresolved': 'off',
      'import-x/order': [
        'error',
        {
          named: true,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc'
          },
          groups: [
            'builtin',
            ['external', 'internal'],
            ['parent', 'sibling', 'index', 'object'],
            'type'
          ]
        }
      ]
    }
  }
)
