/**
 * @file VirtualOfficeWidget.visual.test.tsx
 * @description Visual regression tests for Virtual Office Widget
 * @see ADR-063: WorkAdventure Virtual Office Integration
 * 
 * NOTE: These tests are designed to run with Playwright.
 * For Vitest component tests, see VirtualOfficeWidget.test.tsx
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock data
import {
  mockVirtualOfficeWidget,
  mockDefaultState,
  mockEmptyState,
  mockErrorState,
  mockLoadingState,
  mockManyUsers,
  createMockStatus,
} from '../__fixtures__/mockData';

// Component will be imported when created
// import { VirtualOfficeWidget } from '../VirtualOfficeWidget';

// ============================================================================
// Test Setup
// ============================================================================

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
};

// ============================================================================
// Visual Regression Tests (Vitest Snapshots)
// ============================================================================

describe('VirtualOfficeWidget Visual Tests', () => {
  describe('Component Snapshots', () => {
    it.todo('matches snapshot - default state');

    it.todo('matches snapshot - empty state (no users)');

    it.todo('matches snapshot - loading state');

    it.todo('matches snapshot - error state');

    it.todo('matches snapshot - many users (25+)');

    it.todo('matches snapshot - expanded user list');

    it.todo('matches snapshot - expanded room list');

    it.todo('matches snapshot - with iframe mini-view');
  });

  describe('Responsive Snapshots', () => {
    it.todo('matches snapshot - mobile (320px)');

    it.todo('matches snapshot - mobile (375px)');

    it.todo('matches snapshot - tablet (768px)');

    it.todo('matches snapshot - desktop (1024px)');

    it.todo('matches snapshot - wide (1920px)');
  });

  describe('Theme Snapshots', () => {
    it.todo('matches snapshot - light theme');

    it.todo('matches snapshot - dark theme');

    it.todo('matches snapshot - high contrast');
  });

  describe('State Transitions', () => {
    it.todo('matches snapshot - loading to loaded transition');

    it.todo('matches snapshot - user join animation');

    it.todo('matches snapshot - user leave animation');

    it.todo('matches snapshot - error to retry transition');
  });
});

// ============================================================================
// Visual Test Configuration for Playwright
// ============================================================================

/**
 * PLAYWRIGHT VISUAL TEST CONFIGURATION
 * 
 * Add to playwright.config.ts:
 * 
 * expect: {
 *   toHaveScreenshot: {
 *     maxDiffPixels: 100,
 *     maxDiffPixelRatio: 0.01,
 *     threshold: 0.2,
 *   },
 * },
 * 
 * VIEWPORTS TO TEST:
 * - Mobile S: 320x568
 * - Mobile M: 375x667
 * - Mobile L: 425x812
 * - Tablet: 768x1024
 * - Laptop: 1024x768
 * - Desktop: 1280x720
 * - Wide: 1920x1080
 * 
 * ELEMENTS TO MASK (dynamic content):
 * - Timestamps (last updated)
 * - User avatars (may vary)
 * - Animation frames
 */

// ============================================================================
// Playwright Visual Test Examples
// ============================================================================

/**
 * Example Playwright visual tests (to be placed in e2e/virtual-office-widget.visual.spec.ts):
 * 
 * import { test, expect } from '@playwright/test';
 * 
 * test.describe('Virtual Office Widget Visual Tests', () => {
 *   test.beforeEach(async ({ page }) => {
 *     // Navigate to dashboard with widget
 *     await page.goto('/dashboard/1');
 *     // Wait for widget to load
 *     await page.waitForSelector('[data-testid="virtual-office-widget"]');
 *   });
 * 
 *   test('default state screenshot', async ({ page }) => {
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-default.png', {
 *       mask: [
 *         page.locator('.timestamp'),
 *         page.locator('.user-avatar'),
 *       ],
 *     });
 *   });
 * 
 *   test('responsive - mobile', async ({ page }) => {
 *     await page.setViewportSize({ width: 375, height: 667 });
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-mobile.png');
 *   });
 * 
 *   test('responsive - tablet', async ({ page }) => {
 *     await page.setViewportSize({ width: 768, height: 1024 });
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-tablet.png');
 *   });
 * 
 *   test('empty state screenshot', async ({ page }) => {
 *     // Mock API to return empty state
 *     await page.route('**\/api/v3/wa/status', (route) => {
 *       route.fulfill({
 *         status: 200,
 *         body: JSON.stringify({ success: true, data: { users: [], rooms: [] } }),
 *       });
 *     });
 *     
 *     await page.reload();
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-empty.png');
 *   });
 * 
 *   test('error state screenshot', async ({ page }) => {
 *     // Mock API to return error
 *     await page.route('**\/api/v3/wa/status', (route) => {
 *       route.fulfill({
 *         status: 500,
 *         body: JSON.stringify({ success: false, error: 'Connection failed' }),
 *       });
 *     });
 *     
 *     await page.reload();
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-error.png');
 *   });
 * 
 *   test('dark theme screenshot', async ({ page }) => {
 *     // Enable dark theme
 *     await page.emulateMedia({ colorScheme: 'dark' });
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-dark.png');
 *   });
 * 
 *   test('hover states', async ({ page }) => {
 *     const joinButton = page.locator('[data-testid="join-office-button"]');
 *     
 *     // Default state
 *     await expect(joinButton).toHaveScreenshot('join-button-default.png');
 *     
 *     // Hover state
 *     await joinButton.hover();
 *     await expect(joinButton).toHaveScreenshot('join-button-hover.png');
 *     
 *     // Focus state
 *     await joinButton.focus();
 *     await expect(joinButton).toHaveScreenshot('join-button-focus.png');
 *   });
 * 
 *   test('cross-browser consistency', async ({ page, browserName }) => {
 *     const widget = page.locator('[data-testid="virtual-office-widget"]');
 *     
 *     await expect(widget).toHaveScreenshot('virtual-office-' + browserName + '.png', {
 *       maxDiffPixelRatio: 0.02, // Allow slightly more variance across browsers
 *     });
 *   });
 * });
 */

// ============================================================================
// Visual Test Utilities
// ============================================================================

/**
 * Utility to disable animations for consistent screenshots
 */
export const disableAnimations = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

/**
 * Viewports for responsive testing
 */
export const testViewports = {
  mobileS: { width: 320, height: 568 },
  mobileM: { width: 375, height: 667 },
  mobileL: { width: 425, height: 812 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1024, height: 768 },
  desktop: { width: 1280, height: 720 },
  wide: { width: 1920, height: 1080 },
};

/**
 * Elements to mask in screenshots (dynamic content)
 */
export const dynamicElements = [
  '.timestamp',
  '.last-updated',
  '[data-testid="user-avatar"]',
  '.live-counter',
];
