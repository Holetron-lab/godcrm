module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true
    },
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  plugins: ['react', 'react-hooks', 'jsx-a11y', '@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
    'plugin:jsx-a11y/recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier'
  ],
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
    ],
    // ADR-031: Use logger instead of console.*
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    // ADR-033: XSS Protection - use SafeHtml component instead
    'react/no-danger': ['error'],
    // ADR-035: TypeScript Strict Mode - eliminate `: any`
    '@typescript-eslint/no-explicit-any': 'warn',
    // Max 800 lines per file — prevent monolith components
    'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }]
  },
  overrides: [
    {
      // SafeHtml is the ONLY place where dangerouslySetInnerHTML is allowed (it sanitizes input)
      files: ['**/SafeHtml/SafeHtml.tsx'],
      rules: {
        'react/no-danger': 'off'
      }
    }
  ]
};
