import { test, expect } from '@playwright/test';
import { installFake, makeData } from './fakeBackend.js';

// Hilfsfunktionen
const open = async (page, hash) => { await page.goto('/#/' + hash); await expect(page.locator('#page')).toBeVisible(); };
const toast = (page, text) => expect(page.locator('div.fixed', { hasText: text }).first()).toBeVisible();

test.describe('Katalog', () => {
  test('zeigt Artikel mit Status in Text und Symbol, Filter wirkt', async ({ page, context }) => {
    await installFake(context);
    await open(page, 'katalog');
    await page.click('[data-room="ALL"]');
    await expect(page.locator('[data-card]')).toHaveCount(4);
    await expect(page.locator('[data-card="T-CAM"]')).toContainText('Ausgeliehen');
    await expect(page.locator('[data-card="K-TOPF"]')).toContainText('Defekt');
    await expect(page.locator('[data-card="K-PAPIER"]')).toContainText('Bestand: 2');
    await page.click('#filterBtn'); await page.click('[data-st="maintenance"]'); await page.click('#dApply');
    await expect(page.locator('[data-card]')).toHaveCount(1);
    await expect(page.locator('[data-card="K-TOPF"]')).toBeVisible();
  });

  test('leerer Raum erklärt den nächsten Schritt', async ({ page, context }) => {
    await installFake(context);
    await open(page, 'katalog');
    await page.click('[data-room="Büro"]');
    await expect(page.getByText('Dieser Raum ist noch leer')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ersten Artikel anlegen/ })).toBeVisible();
  });

  test('Suche ohne Treffer bietet Zurücksetzen an', async ({ page, context }) => {
    const data = makeData();
    await installFake(context, { data });
    await open(page, 'katalog');
    await page.click('[data-room="Technik"]');
    await page.click('#filterBtn'); await page.click('[data-st="low"]'); await page.click('#dApply');
    await expect(page.getByText('Nichts gefunden')).toBeVisible();
    await page.getByRole('button', { name: /zurücksetzen/ }).first().click();
    await expect(page.locator('[data-card]')).toHaveCount(2);
  });
});

test.describe('Ausleihe und Rückgabe', () => {
  test('Schnellwahl + Buchen sendet die richtigen Daten und merkt sich das Projekt', async ({ page, context }) => {
    const { calls } = await installFake(context, { rpcHandlers: { rent_item: () => 'rental-1' } });
    await open(page, 'katalog');
    await page.click('[data-room="Technik"]');
    await page.click('[data-card="T-DRILL"] [data-act="rent"]');
    await page.fill('input[name="project"]', 'Sommerlager');
    await page.click('[data-q="week"]');
    await page.click('#book');
    await toast(page, 'Ausleihe gebucht');
    const call = calls.rpc.find((c) => c.name === 'rent_item');
    expect(call.args.p_item_id).toBe('T-DRILL');
    expect(call.args.p_project).toBe('Sommerlager');
    const days = (new Date(call.args.p_end) - new Date(call.args.p_start)) / 86400000;
    expect(days).toBe(7);
    // nächste Ausleihe: Projekt ist vorbelegt
    await page.click('[data-card="T-DRILL"] [data-act="rent"]');
    await expect(page.locator('input[name="project"]')).toHaveValue('Sommerlager');
  });

  test('Fehler der Datenbank wird verständlich angezeigt', async ({ page, context }) => {
    await installFake(context, { rpcHandlers: { rent_item: () => ({ __error: 'Der Artikel ist im gewählten Zeitraum bereits belegt' }) } });
    await open(page, 'katalog');
    await page.click('[data-room="Technik"]');
    await page.click('[data-card="T-DRILL"] [data-act="rent"]');
    await page.click('#book');
    await toast(page, 'bereits belegt');
  });

  test('Rückgabe mit Schaden meldet Defekt', async ({ page, context }) => {
    const { calls } = await installFake(context, { rpcHandlers: { return_rentals: () => 1 } });
    await open(page, 'ich');
    await page.click('[data-ret="r1"]');
    await page.check('#dmg');
    await page.fill('#dmgText', 'Linse zerkratzt');
    await page.getByRole('button', { name: 'Rückgabe bestätigen' }).click();
    await toast(page, 'Rückgabe verbucht');
    const call = calls.rpc.find((c) => c.name === 'return_rentals');
    expect(call.args.p_rental_ids).toEqual(['r1']);
    expect(call.args.p_damage).toBe('Linse zerkratzt');
  });

  test('Entnahme von Verbrauchsmaterial', async ({ page, context }) => {
    const { calls } = await installFake(context, { rpcHandlers: { consume_item: () => 1 } });
    await open(page, 'katalog');
    await page.click('[data-room="Küche"]');
    await page.click('[data-card="K-PAPIER"] [data-act="consume"]');
    await page.fill('input[name="qty"]', '1');
    await page.getByRole('button', { name: 'Entnahme buchen' }).click();
    await toast(page, 'Neuer Bestand: 1');
    expect(calls.rpc.find((c) => c.name === 'consume_item').args).toMatchObject({ p_item_id: 'K-PAPIER', p_qty: 1 });
  });
});

test.describe('Inventur', () => {
  test('Zählen und Abschließen übergibt die gescannten Codes', async ({ page, context }) => {
    const { calls } = await installFake(context, {
      rpcHandlers: { save_inventory: () => ({ id: 'x', expected: 2, found: 1, missing: [{ id: 'T-DRILL', name: 'Bohrmaschine' }], unexpected: [], unknown: [], rented: [{ id: 'T-CAM', name: 'Kamera' }] }) },
    });
    await open(page, 'inventur');
    await page.selectOption('#room', 'Technik');
    await page.click('#start');
    await page.fill('#codeIn', 'ITEM:T-CAM');
    await page.press('#codeIn', 'Enter');
    page.once('dialog', (d) => d.accept());
    await page.click('#finish');
    await expect(page.getByText(/Inventur Technik/)).toBeVisible();
    const call = calls.rpc.find((c) => c.name === 'save_inventory');
    expect(call.args.p_room).toBe('Technik');
    expect(call.args.p_scanned).toEqual(['T-CAM']);
  });
});

test('Übersicht lädt ohne Laufzeitfehler', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await installFake(context);
  await open(page, 'uebersicht');
  await expect(page.getByText('Hallo, Ada')).toBeVisible();
  expect(errors).toEqual([]);
});
