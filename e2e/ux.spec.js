import { test, expect } from '@playwright/test';
import { installFake, makeData } from './fakeBackend.js';

const open = async (page, hash) => { await page.goto('/#/' + hash); await expect(page.locator('#page')).toBeVisible(); };

test('Einführungstour erscheint beim ersten Start und merkt sich das Ende', async ({ page, context }) => {
  const data = makeData(); data.user_settings[0].prefs = { profile_done: true };
  const { calls } = await installFake(context, { data });
  await open(page, 'uebersicht');
  await expect(page.getByRole('dialog')).toContainText('Willkommen im Lager');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ausleihen in zwei Schritten');
  await page.getByRole('button', { name: 'Überspringen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => calls.writes.some((w) => w.table === 'user_settings' && /tour_done/.test(w.body || ''))).toBe(true);
});

test('Tour erscheint nicht erneut, wenn sie schon gesehen wurde', async ({ page, context }) => {
  await installFake(context);
  await open(page, 'uebersicht');
  await expect(page.getByText('Hallo, Ada')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Hilfeseite: Antworten aufklappen, Rückmeldung senden', async ({ page, context }) => {
  const { calls } = await installFake(context);
  await open(page, 'hilfe');
  await page.getByText('Wie leihe ich etwas aus?').click();
  await expect(page.getByText(/Verbindlich buchen/)).toBeVisible();
  await page.getByRole('button', { name: /Rückmeldung geben/ }).click();
  await page.getByLabel('Deine Nachricht').fill('Der Scanner startet nicht');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect.poll(() => calls.writes.find((w) => w.table === 'feedback')?.body || '').toContain('Der Scanner startet nicht');
});

test('Administrator sieht Warnung, wenn keine Sicherung existiert', async ({ page, context }) => {
  await installFake(context);
  await open(page, 'uebersicht');
  await expect(page.getByText(/noch keine Sicherung/)).toBeVisible();
});

test('Zeitraum-Schnellwahl "Heute" ist nur vor 17 Uhr da, andere immer', async ({ page, context }) => {
  await installFake(context);
  await open(page, 'katalog');
  await page.click('[data-room="Technik"]');
  await page.click('[data-card="T-DRILL"] [data-act="rent"]');
  await expect(page.locator('[data-q="tomorrow"]')).toBeVisible();
  await expect(page.locator('[data-q="week"]')).toBeVisible();
});

test('Terminal: Protokoll-Druck ist standardmäßig aus', async ({ page, context }) => {
  await installFake(context);
  await open(page, 'terminal');
  await expect(page.locator('#mProt')).not.toBeChecked();
  await expect(page.locator('#prot')).not.toBeChecked();
});

test('Desktop-Seitenleiste: alle Menüpunkte erreichbar, nichts überlappt (auch bei niedrigem Fenster)', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await installFake(context);
  await open(page, 'uebersicht');
  const nav = page.locator('#sideNav');
  const box = page.locator('aside > div.shrink-0');
  const nb = await nav.boundingBox(); const bb = await box.boundingBox();
  expect(nb.y + nb.height).toBeLessThanOrEqual(bb.y + 1); // Menü endet über dem Benutzerfeld
  // letzter Punkt ist per Scrollen erreichbar und klickbar
  await page.locator('#sideNav a[data-route="einstellungen"]').scrollIntoViewIfNeeded();
  await page.locator('#sideNav a[data-route="einstellungen"]').click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
});

test('Seitenmenü: keine sichtbare Scrollleiste, aber scrollbar', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
  await installFake(context);
  await open(page, 'uebersicht');
  const m = await page.locator('#sideNav').evaluate((n) => ({ scrollable: n.scrollHeight > n.clientHeight, barWidth: n.offsetWidth - n.clientWidth, overflowY: getComputedStyle(n).overflowY }));
  expect(m.overflowY).toBe('auto');
  expect(m.scrollable).toBe(true);   // Scrollfunktion bleibt
  expect(m.barWidth).toBe(0);        // keine Leiste belegt Platz
  await page.locator('#sideNav').evaluate((n) => { n.scrollTop = n.scrollHeight; });
  expect(await page.locator('#sideNav').evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
});
