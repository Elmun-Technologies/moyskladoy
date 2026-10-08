import { defineConfig } from '@playwright/test';

/**
 * E2E - Playwright. Ishga tushirish uchun:
 *   1) API + admin ishlab turishi kerak (demo mode yetarli):
 *      npm run dev:api   (port 4000)
 *      npm run dev:admin  (port 3000)
 *   2) npx playwright install chromium   (bir marta, internet kerak)
 *   3) npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000' },
});
