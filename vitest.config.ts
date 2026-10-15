import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // The fence-rendering regression test renders React elements directly, and
  // the renderer imports the automatic JSX runtime rather than depending on a
  // per-file pragma. Vitest's default esbuild config uses jsx: 'transform'
  // (classic React.createElement), which needs React in scope and fails with
  // "React is not defined" - so override it here. Per-task environments are the
  // wrong lever: this affects the JSX TRANSFORM, not the DOM.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});