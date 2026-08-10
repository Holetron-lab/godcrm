// E2E Test Helper Functions
import { Page, expect } from '@playwright/test';

/**
 * Login helper for E2E tests
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('/dashboard', { timeout: 10000 });
}

/**
 * Logout helper
 */
export async function logout(page: Page) {
  await page.click('[data-testid="user-menu"]');
  await page.click('text=Logout');
  await page.waitForURL('/auth/login');
}

/**
 * Create a test user via API
 */
export async function createTestUser(email: string, password: string, name: string) {
  const response = await fetch('http://localhost:5000/api/v3/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name })
  });
  return response.json();
}

/**
 * Get auth token via API
 */
export async function getAuthToken(email: string, password: string): Promise<string> {
  const response = await fetch('http://localhost:5000/api/v3/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  return data.data.token;
}

/**
 * Create a test table via API
 */
export async function createTestTable(token: string, projectId: number, name: string) {
  const response = await fetch('http://localhost:5000/api/v3/tables', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ project_id: projectId, name, icon: '📋' })
  });
  return response.json();
}

/**
 * Wait for element to be visible
 */
export async function waitForElement(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * Fill form field with label
 */
export async function fillFieldByLabel(page: Page, label: string, value: string) {
  const input = page.locator(`label:has-text("${label}") + input, label:has-text("${label}") + textarea`);
  await input.fill(value);
}

/**
 * Click button with text
 */
export async function clickButton(page: Page, text: string) {
  await page.click(`button:has-text("${text}")`);
}
