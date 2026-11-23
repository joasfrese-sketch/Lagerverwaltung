import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFake } from './fakeBackend.js';

// Automatische Barrierefreiheits-Prüfung (Kontrast, Beschriftungen, Rollen) in Hell- und Dunkelmodus.
// Prüft nur „ernste“ und „kritische“ Verstöße, damit der Test stabil bleibt.
const scan = async (page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
};

for (const theme of ['light', 'dark']) {
  test.describe(`Barrierefreiheit (${theme})`, () => {
    test.beforeEach(async ({ context, page }) => {
      await context.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* egal */ } }, theme);
      await installFake(context);
      await page.goto('/');
      await expect(page.locator('#page')).toBeVisible();
    });

    for (const [name, hash] of [['Übersicht', 'uebersicht'], ['Katalog', 'katalog'], ['Kalender', 'kalender'], ['Einstellungen', 'einstellungen']]) {
      test(name, async ({ page }) => {
        await page.goto('/#/' + hash); await page.waitForTimeout(600);
        expect(await scan(page)).toEqual([]);
      });
    }

    test('Artikelliste und Ausleih-Dialog', async ({ page }) => {
      await page.goto('/#/katalog'); await page.click('[data-room="Technik"]');
      await expect(page.locator('[data-card]').first()).toBeVisible();
      expect(await scan(page)).toEqual([]);
      await page.click('[data-card="T-DRILL"] [data-act="rent"]');
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await scan(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  });
}
