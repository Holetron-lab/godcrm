/**
 * E2E smoke for the `/ticket` ticket-as-atom feature (ADR-0012 Phase 5 / M4).
 *
 * Coverage:
 *   1. The "Add → Тикет" entry in the documents-widget toolbar opens the
 *      InsertTicketAtomModal (the slash-command picker).
 *   2. The mode radio group exposes all three modes (live | snapshot | hybrid).
 *   3. Switching modes updates the picker state.
 *
 * The full insert + render path requires a seeded documents widget +
 * tickets table; that flow is exercised manually on devcrm.hltrn.cc per
 * ADR-0009 (manual UI tests on PROD-DB DEV are tagged). Here we just
 * smoke-test the entry-point — enough to catch wiring regressions.
 *
 * Tests are skipped unless TICKET_REF_ATOM_E2E=1 is set, because they
 * depend on a logged-in user with a documents-widget already configured.
 */
import { test, expect } from '@playwright/test';

const ENABLED = process.env.TICKET_REF_ATOM_E2E === '1';

test.describe('Ticket-as-atom — slash command UX (ADR-0012 M4)', () => {
  test.skip(!ENABLED, 'Set TICKET_REF_ATOM_E2E=1 to run; needs a documents widget on the dashboard.');

  test('TRA-01: Add menu surfaces the /ticket entry', async ({ page }) => {
    await page.goto('/');
    // Hover over the documents-widget add menu — implementation uses
    // mouseenter, so a hover triggers the dropdown.
    const addMenuTrigger = page.locator('button:has-text("Добавить")').first();
    await addMenuTrigger.hover();
    await expect(page.locator('[data-testid="documents-add-menu"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Тикет/ })).toBeVisible();
  });

  test('TRA-02: /ticket modal opens with all three modes', async ({ page }) => {
    await page.goto('/');
    const addMenuTrigger = page.locator('button:has-text("Добавить")').first();
    await addMenuTrigger.hover();
    await page.getByRole('button', { name: /Тикет/ }).click();
    // Modal title
    await expect(page.locator('text=Вставить тикет')).toBeVisible();
    // Mode radios — sr-only inputs, so query by name attr
    await expect(page.locator('[data-testid="ticket-atom-mode-live"]')).toBeAttached();
    await expect(page.locator('[data-testid="ticket-atom-mode-snapshot"]')).toBeAttached();
    await expect(page.locator('[data-testid="ticket-atom-mode-hybrid"]')).toBeAttached();
  });

  test('TRA-03: switching modes updates the picker state', async ({ page }) => {
    await page.goto('/');
    const addMenuTrigger = page.locator('button:has-text("Добавить")').first();
    await addMenuTrigger.hover();
    await page.getByRole('button', { name: /Тикет/ }).click();

    const liveRadio = page.locator('[data-testid="ticket-atom-mode-live"]');
    const snapshotRadio = page.locator('[data-testid="ticket-atom-mode-snapshot"]');
    const hybridRadio = page.locator('[data-testid="ticket-atom-mode-hybrid"]');

    await expect(liveRadio).toBeChecked();
    await snapshotRadio.click();
    await expect(snapshotRadio).toBeChecked();
    await hybridRadio.click();
    await expect(hybridRadio).toBeChecked();
  });

  test('TRA-04: refresh button only visible in snapshot/hybrid mode atoms', async ({ page }) => {
    // This test asserts the rendered-atom contract: when a ticket_ref atom is
    // in `live` mode, the per-atom toolbar should NOT show the refresh button.
    // Requires at least one ticket_ref atom already inserted into a document.
    test.skip(true, 'Manual UI verification — needs seeded ticket_ref atom on DEV');
  });
});
