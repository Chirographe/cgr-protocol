import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  {
    ignores: ['**/dist/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  // A Node script that also runs code in the browser.
  { files: ['brand/**'], rules: { 'no-undef': 'off' } },
)
