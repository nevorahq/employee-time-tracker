import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const serverImportBan = {
  patterns: [
    {
      group: ['@/server', '@/server/*', '**/server/**'],
      message: 'Client code must not import server code. Use @/shared/* instead.',
    },
    {
      group: ['better-sqlite3', 'node:*'],
      message: 'Node-only modules are not allowed in client code.',
    },
  ],
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/client/**/*.{ts,tsx}', 'app/**/*.tsx'],
    rules: { 'no-restricted-imports': ['error', serverImportBan] },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'data/**', 'coverage/**']),
]);
