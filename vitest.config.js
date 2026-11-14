import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    // Dummy-Werte: Unit-Tests sprechen nie mit einer echten Datenbank
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_ANON_KEY: 'test-anon-key' },
  },
});
