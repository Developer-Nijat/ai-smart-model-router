import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['packages/**/test/**/*.test.js', 'apps/**/test/**/*.test.{js,jsx}', 'tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.js', 'apps/*/src/**/*.{js,jsx}'],
      exclude: ['apps/dashboard/src/main.jsx'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
