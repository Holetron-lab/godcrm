/**
 * ESLint Configuration for Backend
 * ADR-037: No-Console rule to enforce logger usage
 * @see ADR-031 for Pino logger documentation
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  globals: {
    // Node.js globals
    process: 'readonly',
    __dirname: 'readonly',
    __filename: 'readonly',
    Buffer: 'readonly'
  },
  extends: ['eslint:recommended'],
  rules: {
    // ADR-031: Use logger instead of console.*
    // Use: import { logger } from '../../utils/logger.js';
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    
    // Allow unused args starting with _
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
  },
  ignorePatterns: ['node_modules', '__tests__', 'public/**', '**/swagger-ui-dist/**']
};
