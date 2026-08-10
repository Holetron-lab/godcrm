/**
 * E2E Tests: Spaces & Navigation
 * Тестируем: работу с пространствами (Spaces), навигацию, проекты
 */
import { test, expect, Page } from '@playwright/test';
import { login, createTestUser, getAuthToken } from './helpers';

const TEST_USER = {
  email: `spaces-test-${Date.now()}@test.com`,
  password: 'Test123!@#',
  name: 'Spaces Test User'
};

test.describe('Spaces & Projects E2E Tests', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    
    await createTestUser(TEST_USER.email, TEST_USER.password, TEST_USER.name);
    await getAuthToken(TEST_USER.email, TEST_USER.password);
  });

  test.beforeEach(async () => {
    await login(page, TEST_USER.email, TEST_USER.password);
  });

  test('SP-01: View spaces list', async () => {
    // Click spaces menu
    await page.click('[data-testid="spaces-menu"]');

    // Verify at least Personal Space exists
    await expect(page.locator('text=Personal Space')).toBeVisible();
  });

  test('SP-02: Create new space', async () => {
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="create-space-btn"]');

    // Fill form
    await page.fill('input[name="name"]', 'Marketing Space');
    await page.fill('input[name="icon"]', '🎨');
    await page.selectOption('select[name="type"]', 'business');
    await page.fill('textarea[name="description"]', 'Space for marketing projects');

    await page.click('button:has-text("Create")');

    // Verify space created
    await expect(page.locator('text=Marketing Space')).toBeVisible();
  });

  test('SP-03: Switch between spaces', async () => {
    await page.click('[data-testid="spaces-menu"]');

    // Get current space name
    const currentSpace = await page.locator('[data-testid="current-space"]').textContent();

    // Click another space
    await page.click('[data-testid="space-item"]:nth-child(2)');

    // Verify space changed
    const newSpace = await page.locator('[data-testid="current-space"]').textContent();
    expect(newSpace).not.toBe(currentSpace);
  });

  test('SP-04: Create project in space', async () => {
    // Make sure we're in a space
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="space-item"]:first-child');

    // Navigate to projects
    await page.click('text=Projects');
    await page.click('[data-testid="create-project-btn"]');

    // Fill form
    await page.fill('input[name="name"]', 'CRM Project');
    await page.fill('input[name="icon"]', '👥');
    await page.fill('textarea[name="description"]', 'Customer relationship management');

    await page.click('button:has-text("Create")');

    // Verify project created
    await expect(page.locator('text=CRM Project')).toBeVisible();
  });

  test('SP-05: Space theme customization', async () => {
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="space-settings-btn"]');

    // Change theme colors
    await page.fill('input[name="theme_primary"]', '#FF5733');
    await page.fill('input[name="theme_secondary"]', '#33FF57');
    await page.fill('input[name="theme_tertiary"]', '#3357FF');

    await page.click('button:has-text("Save")');

    // Verify theme applied (check CSS variable)
    const primaryColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--theme-primary');
    });

    expect(primaryColor.trim()).toBe('#FF5733');
  });

  test('SP-06: View space dashboard', async () => {
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="space-item"]:first-child');

    // Should show space dashboard
    await expect(page.locator('[data-testid="space-dashboard"]')).toBeVisible();

    // Should show aggregated widgets from all projects in space
    const widgets = page.locator('[data-testid="widget"]');
    await expect(widgets.first()).toBeVisible();
  });

  test('SP-07: Navigate to project from space', async () => {
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="space-item"]:first-child');

    // Click on a project
    await page.click('[data-testid="project-card"]:first-child');

    // Verify we're in project view
    await expect(page).toHaveURL(/\/projects\/\d+/);
  });

  test('SP-08: Owner space (admin) visibility', async () => {
    // Check if current user is owner (first user)
    const spacesMenu = page.locator('[data-testid="spaces-menu"]');
    await spacesMenu.click();

    const adminSpace = page.locator('text=Admin Owner\'s Space');
    
    // If user is owner, should see admin space
    // If not, should NOT see it
    const isVisible = await adminSpace.isVisible().catch(() => false);
    
    if (isVisible) {
      // Click admin space
      await adminSpace.click();
      
      // Should see system tables
      await expect(page.locator('text=Users Table')).toBeVisible();
      await expect(page.locator('text=Projects Table')).toBeVisible();
      await expect(page.locator('text=Tables Table')).toBeVisible();
    }
  });

  test('SP-09: Space with multiple projects - aggregation', async () => {
    // Create multiple projects in a space
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="space-item"]:first-child');

    // Create projects
    for (let i = 1; i <= 3; i++) {
      await page.click('[data-testid="create-project-btn"]');
      await page.fill('input[name="name"]', `Project ${i}`);
      await page.click('button:has-text("Create")');
    }

    // View space dashboard
    await page.click('[data-testid="space-dashboard-link"]');

    // Should see aggregated data from all 3 projects
    const projectCount = await page.locator('[data-testid="projects-count"]').textContent();
    expect(parseInt(projectCount || '0')).toBeGreaterThanOrEqual(3);
  });

  test('SP-10: Delete space', async () => {
    await page.click('[data-testid="spaces-menu"]');

    const initialCount = await page.locator('[data-testid="space-item"]').count();

    // Delete last space (not Personal Space)
    await page.click('[data-testid="space-item"]:last-child [data-testid="space-menu-btn"]');
    await page.click('text=Delete Space');
    await page.click('button:has-text("Confirm")');

    // Verify space deleted
    await page.waitForTimeout(1000);
    const newCount = await page.locator('[data-testid="space-item"]').count();
    expect(newCount).toBe(initialCount - 1);
  });
});
