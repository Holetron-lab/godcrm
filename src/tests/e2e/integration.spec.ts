/**
 * E2E Tests: Full User Flow Integration
 * Тестируем: полный цикл работы пользователя от регистрации до создания виджетов
 */
import { test, expect, Page } from '@playwright/test';

const INTEGRATION_USER = {
  email: `integration-${Date.now()}@test.com`,
  password: 'IntegrationTest123!@#',
  name: 'Integration Test User'
};

test.describe('Full Integration E2E Tests', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test('INT-01: Complete user journey - Register to Dashboard with Data', async () => {
    // Step 1: Register
    await page.goto('/auth/register');
    await page.fill('input[name="email"]', INTEGRATION_USER.email);
    await page.fill('input[name="password"]', INTEGRATION_USER.password);
    await page.fill('input[name="name"]', INTEGRATION_USER.name);
    await page.click('button:has-text("Register")');

    // Should auto-login and redirect to dashboard
    await expect(page).toHaveURL('/dashboard', { timeout: 10000 });

    // Step 2: Create a space
    await page.click('[data-testid="spaces-menu"]');
    await page.click('[data-testid="create-space-btn"]');
    await page.fill('input[name="name"]', 'My Business');
    await page.selectOption('select[name="type"]', 'business');
    await page.click('button:has-text("Create")');

    // Step 3: Create a project
    await page.click('[data-testid="create-project-btn"]');
    await page.fill('input[name="name"]', 'Sales Pipeline');
    await page.click('button:has-text("Create")');

    // Step 4: Create a table
    await page.click('text=Tables');
    await page.click('[data-testid="create-table-btn"]');
    await page.fill('input[name="name"]', 'Leads');
    await page.click('button:has-text("Create")');

    // Step 5: Add columns
    await page.click('[data-testid="table-item"]:first-child');
    
    const columns = [
      { name: 'company_name', display: 'Company', type: 'text' },
      { name: 'email', display: 'Email', type: 'email' },
      { name: 'phone', display: 'Phone', type: 'phone' },
      { name: 'status', display: 'Status', type: 'select' },
      { name: 'value', display: 'Deal Value', type: 'number' }
    ];

    for (const col of columns) {
      await page.click('[data-testid="add-column-btn"]');
      await page.fill('input[name="column_name"]', col.name);
      await page.fill('input[name="display_name"]', col.display);
      await page.selectOption('select[name="type"]', col.type);
      await page.click('button:has-text("Add Column")');
    }

    // Step 6: Add sample data
    const leads = [
      { company: 'Tech Corp', email: 'info@techcorp.com', phone: '555-0001', status: 'New', value: '50000' },
      { company: 'StartupXYZ', email: 'hello@startup.xyz', phone: '555-0002', status: 'Qualified', value: '25000' },
      { company: 'Enterprise Inc', email: 'sales@enterprise.com', phone: '555-0003', status: 'Proposal', value: '100000' }
    ];

    for (const lead of leads) {
      await page.click('[data-testid="add-row-btn"]');
      const cells = page.locator('[data-testid="table-row"]:last-child [data-testid="table-cell"]');
      
      await cells.nth(0).locator('input').fill(lead.company);
      await cells.nth(1).locator('input').fill(lead.email);
      await cells.nth(2).locator('input').fill(lead.phone);
      await cells.nth(3).locator('select').selectOption(lead.status);
      await cells.nth(4).locator('input').fill(lead.value);
      
      await page.keyboard.press('Enter');
    }

    // Step 7: Create dashboard widget
    await page.click('text=Dashboard');
    await page.click('[data-testid="add-widget-btn"]');
    await page.click('[data-testid="widget-type-html"]');

    const widgetHTML = `
      <div class="leads-summary">
        <h2>Sales Pipeline Summary</h2>
        <p>Total Leads: {{leads_count}}</p>
        <p>Total Value: ${{total_value}}</p>
        <p>Project: {{project.name}}</p>
      </div>
    `;

    await page.fill('input[name="title"]', 'Pipeline Summary');
    await page.fill('textarea[name="html_content"]', widgetHTML);
    await page.click('button:has-text("Create Widget")');

    // Verify everything works
    await expect(page.locator('text=Pipeline Summary')).toBeVisible();
    await expect(page.locator('text=Sales Pipeline')).toBeVisible();
  });

  test('INT-02: Backend-Frontend Integration - CRUD Operations', async () => {
    // Login
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', INTEGRATION_USER.email);
    await page.fill('input[type="password"]', INTEGRATION_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Test 1: Create table via UI, verify API response
    await page.click('text=Tables');
    
    // Intercept API call
    const createTableResponse = page.waitForResponse(
      response => response.url().includes('/api/v3/tables') && response.request().method() === 'POST'
    );

    await page.click('[data-testid="create-table-btn"]');
    await page.fill('input[name="name"]', 'API Test Table');
    await page.click('button:has-text("Create")');

    const response = await createTableResponse;
    const data = await response.json();
    
    expect(response.status()).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data.name).toBe('API Test Table');

    // Test 2: Add column via UI, verify in backend
    await page.click('[data-testid="table-item"]:last-child');

    const addColumnResponse = page.waitForResponse(
      response => response.url().includes('/columns') && response.request().method() === 'POST'
    );

    await page.click('[data-testid="add-column-btn"]');
    await page.fill('input[name="column_name"]', 'test_field');
    await page.fill('input[name="display_name"]', 'Test Field');
    await page.click('button:has-text("Add Column")');

    const colResponse = await addColumnResponse;
    const colData = await colResponse.json();
    
    expect(colResponse.status()).toBe(201);
    expect(colData.data.column_name).toBe('test_field');

    // Test 3: Add row via UI, verify data persists
    const addRowResponse = page.waitForResponse(
      response => response.url().includes('/rows') && response.request().method() === 'POST'
    );

    await page.click('[data-testid="add-row-btn"]');
    await page.fill('[data-testid="table-cell"]:first-child input', 'Test Value');
    await page.keyboard.press('Enter');

    const rowResponse = await addRowResponse;
    expect(rowResponse.status()).toBe(201);

    // Reload page and verify data persists
    await page.reload();
    await expect(page.locator('td:has-text("Test Value")')).toBeVisible();
  });

  test('INT-03: Multi-user collaboration (if applicable)', async () => {
    // This test would require creating a second user and testing shared access
    // Skipped for now, but structure provided
    test.skip();
  });

  test('INT-04: Performance - Load 100 rows', async () => {
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', INTEGRATION_USER.email);
    await page.fill('input[type="password"]', INTEGRATION_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Create table with many rows via API
    const token = await page.evaluate(() => localStorage.getItem('auth_token'));

    // Use API to bulk create rows (faster than UI)
    const tableResponse = await page.request.post('http://localhost:5000/api/v3/tables', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: { name: 'Performance Test', project_id: 1 }
    });

    const tableData = await tableResponse.json();
    const tableId = tableData.data.id;

    // Add column
    await page.request.post(`http://localhost:5000/api/v3/tables/${tableId}/columns`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: {
        column_name: 'name',
        display_name: 'Name',
        type: 'text'
      }
    });

    // Bulk create 100 rows
    const startTime = Date.now();
    
    for (let i = 0; i < 100; i++) {
      await page.request.post(`http://localhost:5000/api/v3/tables/${tableId}/rows`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        data: {
          data: { name: `Row ${i}` }
        }
      });
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`Created 100 rows in ${duration}ms`);

    // Navigate to table and verify rendering
    await page.goto(`/tables/${tableId}`);
    
    const renderStartTime = Date.now();
    await page.waitForSelector('[data-testid="table-row"]', { timeout: 10000 });
    const renderEndTime = Date.now();
    const renderDuration = renderEndTime - renderStartTime;

    console.log(`Rendered 100 rows in ${renderDuration}ms`);

    // Verify count
    const rowCount = await page.locator('[data-testid="table-row"]').count();
    expect(rowCount).toBeGreaterThanOrEqual(10); // With pagination, might not show all 100

    // Performance assertion
    expect(renderDuration).toBeLessThan(3000); // Should render in under 3 seconds
  });

  test('INT-05: Error handling - Invalid data', async () => {
    await page.goto('/auth/login');
    await page.fill('input[type="email"]', INTEGRATION_USER.email);
    await page.fill('input[type="password"]', INTEGRATION_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');

    // Try to create table without name
    await page.click('text=Tables');
    await page.click('[data-testid="create-table-btn"]');
    await page.click('button:has-text("Create")'); // Submit without filling

    // Should show error
    await expect(page.locator('text=Name is required')).toBeVisible();

    // Try to add column with invalid type
    await page.fill('input[name="name"]', 'Valid Table');
    await page.click('button:has-text("Create")');
    
    await page.click('[data-testid="add-column-btn"]');
    await page.fill('input[name="column_name"]', 'invalid column name!'); // Invalid characters
    await page.click('button:has-text("Add Column")');

    // Should show validation error
    await expect(page.locator('text=Invalid column name')).toBeVisible();
  });
});
