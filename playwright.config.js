import { defineConfig } from '@playwright/test';

// End-to-End-Tests gegen den Produktions-Build mit gefälschtem Backend (siehe e2e/fakeBackend.js).
// PW_CHROMIUM: optionaler Pfad zu einem vorhandenen Chromium (z. B. in Sandboxen ohne Browser-Download).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: { VITE_SUPABASE_URL: 'http://fake.supabase.test', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
  },
});
