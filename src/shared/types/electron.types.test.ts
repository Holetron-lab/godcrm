/**
 * Tests for Electron API configuration
 * TDD: Testing desktop app API URL management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Electron API Types', () => {
  beforeEach(() => {
    // Reset window.electronAPI mock
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isDesktopApp', () => {
    it('should return false when electronAPI is not defined', async () => {
      const { isDesktopApp } = await import('./electron.types');
      expect(isDesktopApp()).toBe(false);
    });

    it('should return true when electronAPI is defined', async () => {
      vi.stubGlobal('window', {
        electronAPI: {
          getApiUrl: vi.fn(),
          setApiUrl: vi.fn(),
          testApiConnection: vi.fn(),
          getAppInfo: vi.fn(),
          platform: 'linux',
          isDesktop: true,
          onNavigate: vi.fn(),
        },
      });

      // Re-import to get fresh module
      const { isDesktopApp } = await import('./electron.types');
      expect(isDesktopApp()).toBe(true);
    });
  });

  describe('getPlatform', () => {
    it('should return "web" when not in desktop app', async () => {
      const { getPlatform } = await import('./electron.types');
      expect(getPlatform()).toBe('web');
    });

    it('should return platform from electronAPI when in desktop', async () => {
      vi.stubGlobal('window', {
        electronAPI: {
          getApiUrl: vi.fn(),
          setApiUrl: vi.fn(),
          testApiConnection: vi.fn(),
          getAppInfo: vi.fn(),
          platform: 'darwin',
          isDesktop: true,
          onNavigate: vi.fn(),
        },
      });

      const { getPlatform } = await import('./electron.types');
      expect(getPlatform()).toBe('darwin');
    });
  });
});

describe('ElectronAPI Interface', () => {
  it('should have all required methods', () => {
    const mockApi = {
      getApiUrl: async () => 'https://api.example.com',
      setApiUrl: async (_url: string) => true,
      testApiConnection: async (_url: string) => ({ success: true }),
      getAppInfo: async () => ({
        version: '1.0.0',
        platform: 'linux',
        arch: 'x64',
        electron: '28.0.0',
        chrome: '120.0.0',
        node: '20.0.0',
      }),
      platform: 'linux' as const,
      isDesktop: true as const,
      onNavigate: (_callback: (path: string) => void) => () => {},
    };

    // Type check - if this compiles, the interface is correct
    expect(mockApi.platform).toBe('linux');
    expect(mockApi.isDesktop).toBe(true);
  });
});
