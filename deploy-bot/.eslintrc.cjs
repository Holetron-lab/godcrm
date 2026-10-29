// The bot is a separate Node.js package using CommonJS, with ESM helpers.
// Like backend/.eslintrc.cjs, use the JavaScript rules for this package rather
// than inheriting the frontend TypeScript/React parser and import restrictions.
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  extends: ['eslint:recommended'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
  },
  ignorePatterns: ['node_modules'],
  overrides: [{ files: ['*.mjs'], parserOptions: { sourceType: 'module' } }],
};
