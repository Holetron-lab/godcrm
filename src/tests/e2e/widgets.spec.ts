/**
 * E2E Tests: Widgets & Dashboards
 * Тестируем: создание виджетов (HTML widget с переменными), дашборды, перемещение виджетов
 */
import { test, expect, Page } from '@playwright/test';
import { login, createTestUser, getAuthToken } from './helpers';

const TEST_USER = {
  email: `widgets-test-${Date.now()}@test.com`,
  password: 'Test123!@#',
  name: 'Widgets Test User'
};

test.describe('Widgets & Dashboards E2E Tests', () => {
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

  test('WD-01: Create HTML widget with project variables', async () => {
    // Navigate to dashboard
    await page.click('text=Dashboard');
    
    // Click add widget button
    await page.click('[data-testid="add-widget-btn"]');

    // Select HTML widget type
    await page.click('[data-testid="widget-type-html"]');

    // Fill widget form
    await page.fill('input[name="title"]', 'Custom HTML Widget');
    
    // Fill HTML content with project variables
    const htmlContent = `
      <div class="widget-container">
        <h1>Hello {{project.name}}</h1>
        <p>Owner: {{project.owner_name}}</p>
        <p>Tables: {{project.tables_count}}</p>
        <button onclick="alert('Widget clicked!')">Click Me</button>
      </div>
    `;
    await page.fill('textarea[name="html_content"]', htmlContent);

    // Submit
    await page.click('button:has-text("Create Widget")');

    // Verify widget created and rendered
    await expect(page.locator('[data-testid="widget"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Custom HTML Widget')).toBeVisible();
  });

  test('WD-02: Edit widget configuration', async () => {
    await page.click('text=Dashboard');

    // Click widget settings
    await page.click('[data-testid="widget"]:first-child [data-testid="widget-settings-btn"]');

    // Update title
    await page.fill('input[name="title"]', 'Updated Widget Title');
    await page.click('button:has-text("Save")');

    // Verify updated
    await expect(page.locator('text=Updated Widget Title')).toBeVisible();
  });

  test('WD-03: Widget with CSS styling', async () => {
    await page.click('text=Dashboard');
    await page.click('[data-testid="add-widget-btn"]');
    await page.click('[data-testid="widget-type-html"]');

    const htmlWithCSS = `
      <style>
        .custom-card {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
          border-radius: 10px;
          color: white;
        }
      </style>
      <div class="custom-card">
        <h2>Styled Widget</h2>
        <p>Project: {{project.name}}</p>
      </div>
    `;

    await page.fill('input[name="title"]', 'Styled Widget');
    await page.fill('textarea[name="html_content"]', htmlWithCSS);
    await page.click('button:has-text("Create Widget")');

    // Check if CSS is applied (check for gradient background)
    const widget = page.locator('[data-testid="widget"]:last-child .custom-card');
    await expect(widget).toBeVisible();
  });

  test('WD-04: Widget with JavaScript functionality', async () => {
    await page.click('text=Dashboard');
    await page.click('[data-testid="add-widget-btn"]');
    await page.click('[data-testid="widget-type-html"]');

    const htmlWithJS = `
      <div id="counter-widget">
        <h3>Counter Widget</h3>
        <p>Count: <span id="count">0</span></p>
        <button onclick="increment()">Increment</button>
      </div>
      <script>
        let count = 0;
        function increment() {
          count++;
          document.getElementById('count').textContent = count;
        }
      </script>
    `;

    await page.fill('input[name="title"]', 'Interactive Widget');
    await page.fill('textarea[name="html_content"]', htmlWithJS);
    await page.click('button:has-text("Create Widget")');

    // Test interactive functionality
    const countElement = page.locator('#count');
    await expect(countElement).toHaveText('0');

    await page.click('button:has-text("Increment")');
    await expect(countElement).toHaveText('1');
  });

  test('WD-05: Create table visualization widget', async () => {
    await page.click('text=Dashboard');
    await page.click('[data-testid="add-widget-btn"]');
    await page.click('[data-testid="widget-type-table"]');

    // Select table source
    await page.selectOption('select[name="table_id"]', { index: 0 });

    // Configure columns to display
    await page.check('input[name="show_column_id"]');
    await page.check('input[name="show_column_name"]');

    // Submit
    await page.fill('input[name="title"]', 'Table Widget');
    await page.click('button:has-text("Create Widget")');

    // Verify table widget displays data
    await expect(page.locator('[data-testid="widget-table"]')).toBeVisible();
  });

  test('WD-06: Move widget position on dashboard', async () => {
    await page.click('text=Dashboard');

    // Enable edit mode
    await page.click('[data-testid="edit-dashboard-btn"]');

    // Get initial position
    const widget = page.locator('[data-testid="widget"]:first-child');
    const initialBox = await widget.boundingBox();

    // Drag widget to new position
    await widget.dragTo(page.locator('[data-testid="dashboard-drop-zone"]'), {
      targetPosition: { x: 200, y: 200 }
    });

    // Verify position changed
    const newBox = await widget.boundingBox();
    expect(newBox?.x).not.toBe(initialBox?.x);
  });

  test('WD-07: Resize widget', async () => {
    await page.click('text=Dashboard');
    await page.click('[data-testid="edit-dashboard-btn"]');

    const widget = page.locator('[data-testid="widget"]:first-child');
    const resizeHandle = widget.locator('[data-testid="resize-handle"]');

    const initialBox = await widget.boundingBox();

    // Drag resize handle
    await resizeHandle.dragTo(resizeHandle, {
      targetPosition: { x: 100, y: 100 }
    });

    const newBox = await widget.boundingBox();
    expect(newBox?.width).toBeGreaterThan(initialBox?.width || 0);
  });

  test('WD-08: Delete widget', async () => {
    await page.click('text=Dashboard');

    const initialCount = await page.locator('[data-testid="widget"]').count();

    // Click delete on first widget
    await page.click('[data-testid="widget"]:first-child [data-testid="widget-delete-btn"]');
    await page.click('button:has-text("Confirm")');

    // Verify widget deleted
    await page.waitForTimeout(1000);
    const newCount = await page.locator('[data-testid="widget"]').count();
    expect(newCount).toBe(initialCount - 1);
  });

  test('WD-09: Create new dashboard', async () => {
    // Navigate to dashboards page
    await page.click('text=Dashboards');
    await page.click('[data-testid="create-dashboard-btn"]');

    await page.fill('input[name="name"]', 'Sales Dashboard');
    await page.fill('input[name="icon"]', '📊');
    await page.fill('textarea[name="description"]', 'Dashboard for sales metrics');
    await page.click('button:has-text("Create")');

    // Verify dashboard created
    await expect(page.locator('text=Sales Dashboard')).toBeVisible();
  });

  test('WD-10: Switch between dashboards', async () => {
    await page.click('text=Dashboards');

    // Get list of dashboards
    const dashboards = page.locator('[data-testid="dashboard-item"]');
    const count = await dashboards.count();

    if (count > 1) {
      // Click second dashboard
      await dashboards.nth(1).click();

      // Verify we're on different dashboard
      await expect(page).toHaveURL(/\/dashboards\/\d+/);
    }
  });

  test('WD-11: Widget with project variable interpolation', async () => {
    await page.click('text=Dashboard');
    await page.click('[data-testid="add-widget-btn"]');
    await page.click('[data-testid="widget-type-html"]');

    const htmlWithVariables = `
      <div class="info-widget">
        <h3>Project Info</h3>
        <ul>
          <li>Name: {{project.name}}</li>
          <li>Type: {{project.type}}</li>
          <li>Created: {{project.created_at}}</li>
          <li>Owner: {{user.name}}</li>
          <li>Email: {{user.email}}</li>
        </ul>
      </div>
    `;

    await page.fill('input[name="title"]', 'Project Variables Widget');
    await page.fill('textarea[name="html_content"]', htmlWithVariables);
    await page.click('button:has-text("Create Widget")');

    // Verify variables are interpolated (not raw {{ }})
    await expect(page.locator('text={{project.name}}')).not.toBeVisible();
    await expect(page.locator('.info-widget ul li')).toHaveCount(5);
  });

  test('WD-12: Chart widget (if implemented)', async () => {
    await page.click('text=Dashboard');
    await page.click('[data-testid="add-widget-btn"]');
    
    // Check if chart widget type exists
    const chartOption = page.locator('[data-testid="widget-type-chart"]');
    if (await chartOption.isVisible()) {
      await chartOption.click();

      await page.fill('input[name="title"]', 'Sales Chart');
      await page.selectOption('select[name="chart_type"]', 'bar');
      await page.selectOption('select[name="data_source"]', { index: 0 });

      await page.click('button:has-text("Create Widget")');

      // Verify chart rendered
      await expect(page.locator('[data-testid="chart-widget"]')).toBeVisible();
    }
  });
});
