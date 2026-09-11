// reactapp/vitest.config.ts — standalone Vitest config (kept separate from
// vite.config.ts so tests never touch the Tethys build/proxy plumbing).
// jsdom because api.ts reads document.cookie for CSRF.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
