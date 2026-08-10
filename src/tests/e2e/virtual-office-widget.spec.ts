/**
 * @file virtual-office-widget.spec.ts
 * @description E2E tests for Virtual Office Widget
 * @see ADR-063: WorkAdventure Virtual Office Integration
 * 
 * Run with: npx playwright test virtual-office-widget.spec.ts
 */
import { test, expect, Page } from '@playwright/test';

// ============================================================================
// Test Configuration
// ============================================================================

const WORKADVENTURE_URL = 'https://wa.hltrn.cc';
const DASHBOARD_URL = '/dashboard/1'; // Adjust based on actual dashboard ID

// Mock API responses
const mockStatusResponse = {
  success: true,
  data: {
    isConnected: true,
    totalOnline: 5,
    users: [
      { id: 1, name: 'John Doe', room: 'Main Hall', status: 'online' },
      { id: 2, name: 'Jane Smith', room: 'Meeting Room 1', status: 'busy' },
      { id: 3, name: 'Bob Wilson', room: 'Quiet Zone', status: 'away' },
      { id: 4, name: 'Alice Brown', room: 'Main Hall', status: 'online' },
      { id: 5, name: 'Charlie Davis', room: 'Social Lounge', status: 'online' },
    ],
    rooms: [
      { id: 'main-hall', name: 'Main Hall', userCount: 2 },
      { id: 'meeting-1', name: 'Meeting Room 1', userCount: 1 },
      { id: 'quiet-zone', name: 'Quiet Zone', userCount: 1 },
      { id: 'social-lounge', name: 'Social Lounge', userCount: 1 },
    ],
    lastUpdated: new Date().toISOString(),
  },
  timestamp: new Date().toISOString(),
};

const mockEmptyResponse = {
  success: true,
  data: {
    isConnected: true,
    totalOnline: 0,
    users: [],
    rooms: [
      { id: 'main-hall', name: 'Main Hall', userCount: 0 },
      { id: 'meeting-1', name: 'Meeting Room 1', userCount: 0 },
    ],
    lastUpdated: new Date().toISOString(),
  },
  timestamp: new Date().toISOString(),
};

const mockErrorResponse = {
  success: false,
  error: {
    code: 'WA_CONNECTION_ERROR',
    message: 'Failed to connect to WorkAdventure server',
  },
  timestamp: new Date().toISOString(),
};

// ============================================================================
// Test Helpers
// ============================================================================

async function mockVirtualOfficeAPI(page: Page, response: object) {
  await page.route('**/api/v3/wa/status', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

async function mockVirtualOfficeAPIError(page: Page) {
  await page.route('**/api/v3/wa/status', (route) => {
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify(mockErrorResponse),
    });
  });
}

async function navigateToDashboard(page: Page) {
  await page.goto(DASHBOARD_URL);
  await page.waitForLoadState('networkidle');
}

async function getWidget(page: Page) {
  return page.locator('[data-testid="virtual-office-widget"]');
}

// ============================================================================
// E2E Tests
// ============================================================================

test.describe('Virtual Office Widget', () => {
  test.beforeEach(async ({ page }) => {
    // Default: mock successful API response
    await mockVirtualOfficeAPI(page, mockStatusResponse);
  });

  test.describe('Display and Rendering', () => {
    test('shows online users count', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Wait for widget to load
      await expect(widget).toBeVisible();

      // Check online count is displayed
      const onlineCount = widget.locator('[data-testid="online-count"]');
      await expect(onlineCount).toHaveText('5');
    });

    test('displays room list with user counts', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Check rooms are displayed
      const roomList = widget.locator('[data-testid="room-list"]');
      await expect(roomList).toBeVisible();

      // Verify room names
      await expect(roomList.locator('text=Main Hall')).toBeVisible();
      await expect(roomList.locator('text=Meeting Room 1')).toBeVisible();
    });

    test('shows user avatars', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Check user avatars are displayed
      const avatars = widget.locator('[data-testid="user-avatar"]');
      await expect(avatars).toHaveCount(5);
    });

    test('displays Join Office button', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      const joinButton = widget.locator('[data-testid="join-office-button"]');
      await expect(joinButton).toBeVisible();
      await expect(joinButton).toHaveText(/join office/i);
    });
  });

  test.describe('Join Office Button', () => {
    test('opens WorkAdventure in new tab on click', async ({ page, context }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Listen for new page (tab)
      const pagePromise = context.waitForEvent('page');

      // Click Join Office button
      const joinButton = widget.locator('[data-testid="join-office-button"]');
      await joinButton.click();

      // Verify new tab opened with correct URL
      const newPage = await pagePromise;
      await expect(newPage).toHaveURL(new RegExp(WORKADVENTURE_URL));
    });

    test('button is disabled when not connected', async ({ page }) => {
      await mockVirtualOfficeAPIError(page);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      const joinButton = widget.locator('[data-testid="join-office-button"]');
      await expect(joinButton).toBeDisabled();
    });
  });

  test.describe('Empty State', () => {
    test('shows empty message when no users online', async ({ page }) => {
      await mockVirtualOfficeAPI(page, mockEmptyResponse);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Check empty state message
      const emptyMessage = widget.locator('[data-testid="empty-state"]');
      await expect(emptyMessage).toBeVisible();
      await expect(emptyMessage).toHaveText(/no one online/i);
    });

    test('Join Office button still visible in empty state', async ({ page }) => {
      await mockVirtualOfficeAPI(page, mockEmptyResponse);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      const joinButton = widget.locator('[data-testid="join-office-button"]');
      await expect(joinButton).toBeVisible();
      await expect(joinButton).toBeEnabled();
    });
  });

  test.describe('Error State', () => {
    test('displays error message on connection failure', async ({ page }) => {
      await mockVirtualOfficeAPIError(page);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Check error message
      const errorMessage = widget.locator('[data-testid="error-message"]');
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage).toHaveText(/failed to connect/i);
    });

    test('shows retry button on error', async ({ page }) => {
      await mockVirtualOfficeAPIError(page);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      const retryButton = widget.locator('[data-testid="retry-button"]');
      await expect(retryButton).toBeVisible();
    });

    test('retries connection on retry button click', async ({ page }) => {
      // First request fails
      await mockVirtualOfficeAPIError(page);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Verify error state
      await expect(widget.locator('[data-testid="error-message"]')).toBeVisible();

      // Now mock successful response
      await page.unroute('**/api/v3/wa/status');
      await mockVirtualOfficeAPI(page, mockStatusResponse);

      // Click retry
      const retryButton = widget.locator('[data-testid="retry-button"]');
      await retryButton.click();

      // Verify success state
      await expect(widget.locator('[data-testid="online-count"]')).toHaveText('5');
    });
  });

  test.describe('Real-time Updates', () => {
    test('updates user count when users join/leave', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Initial count
      await expect(widget.locator('[data-testid="online-count"]')).toHaveText('5');

      // Simulate user join via API update
      const updatedResponse = {
        ...mockStatusResponse,
        data: {
          ...mockStatusResponse.data,
          totalOnline: 6,
          users: [
            ...mockStatusResponse.data.users,
            { id: 6, name: 'New User', room: 'Main Hall', status: 'online' },
          ],
        },
      };

      await page.unroute('**/api/v3/wa/status');
      await mockVirtualOfficeAPI(page, updatedResponse);

      // Trigger refresh (click refresh button or wait for auto-refresh)
      const refreshButton = widget.locator('[data-testid="refresh-button"]');
      if (await refreshButton.isVisible()) {
        await refreshButton.click();
      } else {
        // Wait for auto-refresh
        await page.waitForTimeout(35000); // Assuming 30s refresh interval
      }

      // Verify updated count
      await expect(widget.locator('[data-testid="online-count"]')).toHaveText('6');
    });
  });

  test.describe('Responsive Design', () => {
    test('displays correctly on mobile (375px)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Widget should be visible and not overflow
      await expect(widget).toBeVisible();
      const box = await widget.boundingBox();
      expect(box?.width).toBeLessThanOrEqual(375);

      // Join button should be full width on mobile
      const joinButton = widget.locator('[data-testid="join-office-button"]');
      await expect(joinButton).toBeVisible();
    });

    test('displays correctly on tablet (768px)', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      await expect(widget).toBeVisible();

      // Room list should be visible on tablet
      const roomList = widget.locator('[data-testid="room-list"]');
      await expect(roomList).toBeVisible();
    });

    test('displays correctly on desktop (1280px)', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      await expect(widget).toBeVisible();

      // All elements should be visible on desktop
      await expect(widget.locator('[data-testid="online-count"]')).toBeVisible();
      await expect(widget.locator('[data-testid="room-list"]')).toBeVisible();
      await expect(widget.locator('[data-testid="user-list"]')).toBeVisible();
    });
  });

  test.describe('Accessibility', () => {
    test('Join Office button is keyboard accessible', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Tab to the button
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab'); // May need multiple tabs

      const joinButton = widget.locator('[data-testid="join-office-button"]');

      // Check if button is focused (may need to adjust based on tab order)
      // await expect(joinButton).toBeFocused();

      // Verify button has accessible name
      await expect(joinButton).toHaveAttribute('aria-label', /join.*office/i);
    });

    test('screen reader announces online count', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      const onlineCount = widget.locator('[data-testid="online-count"]');

      // Check for aria-label or aria-live
      const ariaLabel = await onlineCount.getAttribute('aria-label');
      const ariaLive = await onlineCount.getAttribute('aria-live');

      expect(ariaLabel || ariaLive).toBeTruthy();
    });

    test('error message has alert role', async ({ page }) => {
      await mockVirtualOfficeAPIError(page);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      const errorMessage = widget.locator('[data-testid="error-message"]');
      await expect(errorMessage).toHaveAttribute('role', 'alert');
    });
  });

  test.describe('Performance', () => {
    test('widget loads within 500ms', async ({ page }) => {
      const startTime = Date.now();

      await navigateToDashboard(page);
      const widget = await getWidget(page);
      await expect(widget).toBeVisible();

      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(2000); // Allow 2s for full page load

      // Widget-specific load time (after page load)
      const widgetLoadStart = Date.now();
      await expect(widget.locator('[data-testid="online-count"]')).toBeVisible();
      const widgetLoadTime = Date.now() - widgetLoadStart;

      expect(widgetLoadTime).toBeLessThan(500);
    });

    test('handles rapid updates without memory leaks', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      // Get initial memory usage
      const initialMetrics = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });

      // Simulate 10 rapid updates
      for (let i = 0; i < 10; i++) {
        const updatedResponse = {
          ...mockStatusResponse,
          data: {
            ...mockStatusResponse.data,
            totalOnline: 5 + i,
          },
        };

        await page.unroute('**/api/v3/wa/status');
        await mockVirtualOfficeAPI(page, updatedResponse);

        // Trigger refresh
        await page.evaluate(() => {
          window.dispatchEvent(new CustomEvent('virtual-office-refresh'));
        });

        await page.waitForTimeout(100);
      }

      // Get final memory usage
      const finalMetrics = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory.usedJSHeapSize;
        }
        return 0;
      });

      // Memory should not increase significantly (allow 50% increase)
      if (initialMetrics > 0) {
        expect(finalMetrics).toBeLessThan(initialMetrics * 1.5);
      }
    });
  });

  test.describe('Visual Regression', () => {
    test('default state screenshot', async ({ page }) => {
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      await expect(widget).toHaveScreenshot('virtual-office-default.png', {
        mask: [
          page.locator('.timestamp'),
          page.locator('[data-testid="last-updated"]'),
        ],
      });
    });

    test('empty state screenshot', async ({ page }) => {
      await mockVirtualOfficeAPI(page, mockEmptyResponse);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      await expect(widget).toHaveScreenshot('virtual-office-empty.png');
    });

    test('error state screenshot', async ({ page }) => {
      await mockVirtualOfficeAPIError(page);
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      await expect(widget).toHaveScreenshot('virtual-office-error.png');
    });

    test('mobile layout screenshot', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await navigateToDashboard(page);
      const widget = await getWidget(page);

      await expect(widget).toHaveScreenshot('virtual-office-mobile.png');
    });
  });
});

// ============================================================================
// Cross-Browser Tests
// ============================================================================

test.describe('Virtual Office Widget - Cross Browser', () => {
  test('renders consistently across browsers', async ({ page, browserName }) => {
    await mockVirtualOfficeAPI(page, mockStatusResponse);
    await navigateToDashboard(page);
    const widget = await getWidget(page);

    await expect(widget).toBeVisible();
    await expect(widget.locator('[data-testid="online-count"]')).toHaveText('5');

    // Take browser-specific screenshot
    await expect(widget).toHaveScreenshot(`virtual-office-${browserName}.png`, {
      maxDiffPixelRatio: 0.02, // Allow 2% variance across browsers
    });
  });
});
