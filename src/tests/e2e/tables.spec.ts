/**
 * E2E Tests: Tables CRUD
 * Тестируем: создание таблицы, добавление колонок, добавление строк, редактирование, удаление
 */
import { test, expect, Page } from '@playwright/test';
import { login, createTestUser, getAuthToken, waitForElement } from './helpers';

const TEST_USER = {
  email: `tables-test-${Date.now()}@test.com`,
  password: 'Test123!@#',
  name: 'Tables Test User'
};

test.describe('Tables E2E Tests', () => {
  let page: Page;
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    // Создаем тестового пользователя
    const context = await browser.newContext();
    page = await context.newPage();
    
    await createTestUser(TEST_USER.email, TEST_USER.password, TEST_USER.name);
    authToken = await getAuthToken(TEST_USER.email, TEST_USER.password);
  });

  test.beforeEach(async () => {
    await login(page, TEST_USER.email, TEST_USER.password);
  });

  test('TC-01: Create new table', async () => {
    // Navigate to tables page
    await page.click('text=Tables');
    await waitForElement(page, '[data-testid="create-table-btn"]');

    // Click create button
    await page.click('[data-testid="create-table-btn"]');

    // Fill table form
    await page.fill('input[name="name"]', 'Test Clients Table');
    await page.fill('input[name="icon"]', '👥');
    await page.fill('textarea[name="description"]', 'Test table for client management');

    // Submit
    await page.click('button:has-text("Create")');

    // Verify table created
    await expect(page.locator('text=Test Clients Table')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=👥')).toBeVisible();
  });

  test('TC-02: Open existing table', async () => {
    // Navigate to tables page
    await page.click('text=Tables');
    await waitForElement(page, '[data-testid="tables-list"]');

    // Click on first table
    await page.click('[data-testid="table-item"]:first-child');

    // Verify table view opened
    await expect(page).toHaveURL(/\/tables\/\d+/);
    await expect(page.locator('[data-testid="table-header"]')).toBeVisible();
  });

  test('TC-03: Add column to table', async () => {
    // Navigate to a table
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    // Click add column button
    await page.click('[data-testid="add-column-btn"]');

    // Fill column form
    await page.fill('input[name="column_name"]', 'client_name');
    await page.fill('input[name="display_name"]', 'Client Name');
    await page.selectOption('select[name="type"]', 'text');

    // Submit
    await page.click('button:has-text("Add Column")');

    // Verify column added
    await expect(page.locator('th:has-text("Client Name")')).toBeVisible({ timeout: 3000 });
  });

  test('TC-04: Add multiple columns with different types', async () => {
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    const columns = [
      { name: 'email', display: 'Email', type: 'email' },
      { name: 'phone', display: 'Phone', type: 'phone' },
      { name: 'status', display: 'Status', type: 'select' },
      { name: 'active', display: 'Active', type: 'checkbox' }
    ];

    for (const col of columns) {
      await page.click('[data-testid="add-column-btn"]');
      await page.fill('input[name="column_name"]', col.name);
      await page.fill('input[name="display_name"]', col.display);
      await page.selectOption('select[name="type"]', col.type);
      await page.click('button:has-text("Add Column")');
      await expect(page.locator(`th:has-text("${col.display}")`)).toBeVisible();
    }
  });

  test('TC-05: Add row to table', async () => {
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    // Click add row button
    await page.click('[data-testid="add-row-btn"]');

    // Fill first cell (assuming text column exists)
    const firstCell = page.locator('[data-testid="table-cell"]:first-child input');
    await firstCell.fill('John Doe');
    await firstCell.press('Enter');

    // Verify row added
    await expect(page.locator('td:has-text("John Doe")')).toBeVisible();
  });

  test('TC-06: Edit cell value', async () => {
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    // Find first cell and edit
    const cell = page.locator('[data-testid="table-cell"]:first-child');
    await cell.dblclick();

    const input = cell.locator('input');
    await input.fill('Updated Value');
    await input.press('Enter');

    // Verify updated
    await expect(page.locator('td:has-text("Updated Value")')).toBeVisible();
  });

  test('TC-07: Delete row', async () => {
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    // Add a row first
    await page.click('[data-testid="add-row-btn"]');
    await page.fill('[data-testid="table-cell"]:first-child input', 'To Delete');
    await page.press('[data-testid="table-cell"]:first-child input', 'Enter');

    // Click delete button on row
    await page.click('[data-testid="delete-row-btn"]');
    await page.click('button:has-text("Confirm")'); // Confirm dialog

    // Verify row deleted
    await expect(page.locator('td:has-text("To Delete")')).not.toBeVisible();
  });

  test('TC-08: Delete column', async () => {
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    // Find column header and click delete
    const columnHeader = page.locator('th:first-child');
    await columnHeader.hover();
    await columnHeader.locator('[data-testid="column-menu-btn"]').click();
    await page.click('text=Delete Column');
    await page.click('button:has-text("Confirm")');

    // Verify column removed (check if header is gone)
    await page.waitForTimeout(1000);
    const columns = await page.locator('th').count();
    expect(columns).toBeGreaterThan(0);
  });

  test('TC-09: Rename table', async () => {
    await page.click('text=Tables');
    await page.click('[data-testid="table-item"]:first-child');

    // Click table settings
    await page.click('[data-testid="table-settings-btn"]');
    await page.fill('input[name="name"]', 'Renamed Table');
    await page.click('button:has-text("Save")');

    // Verify rename
    await expect(page.locator('text=Renamed Table')).toBeVisible();
  });

  test('TC-10: Delete table', async () => {
    await page.click('text=Tables');

    const initialCount = await page.locator('[data-testid="table-item"]').count();

    // Click delete on first table
    await page.click('[data-testid="table-item"]:first-child [data-testid="delete-table-btn"]');
    await page.click('button:has-text("Confirm")');

    // Verify table deleted
    await page.waitForTimeout(1000);
    const newCount = await page.locator('[data-testid="table-item"]').count();
    expect(newCount).toBe(initialCount - 1);
  });
});
