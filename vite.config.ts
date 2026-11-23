import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // Relative base so the build also works from any folder or from disk.
  base: './',
  server: { port: 5173 },
  // The Rapier physics engine ships as embedded WASM (~2 MB), so the main chunk is large by design.
  build: { chunkSizeWarningLimit: 4000 },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { include: ['tests/**/*.test.ts'] },
});
