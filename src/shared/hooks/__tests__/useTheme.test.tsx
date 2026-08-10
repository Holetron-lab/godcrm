import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme, COLOR_PRESETS, PrimaryColor } from '../useTheme';
import { ReactNode } from 'react';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get store() { return store; }
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('useTheme - Primary Color', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset document styles
    document.documentElement.style.cssText = '';
  });

  describe('COLOR_PRESETS', () => {
    it('should export COLOR_PRESETS with all 8 colors', () => {
      expect(COLOR_PRESETS).toBeDefined();
      const expectedColors: PrimaryColor[] = ['blue', 'purple', 'green', 'orange', 'red', 'pink', 'teal', 'indigo'];
      expectedColors.forEach(color => {
        expect(COLOR_PRESETS[color]).toBeDefined();
        expect(COLOR_PRESETS[color]).toHaveProperty('50');
        expect(COLOR_PRESETS[color]).toHaveProperty('100');
        expect(COLOR_PRESETS[color]).toHaveProperty('200');
        expect(COLOR_PRESETS[color]).toHaveProperty('300');
        expect(COLOR_PRESETS[color]).toHaveProperty('400');
        expect(COLOR_PRESETS[color]).toHaveProperty('500');
        expect(COLOR_PRESETS[color]).toHaveProperty('600');
        expect(COLOR_PRESETS[color]).toHaveProperty('700');
        expect(COLOR_PRESETS[color]).toHaveProperty('800');
        expect(COLOR_PRESETS[color]).toHaveProperty('900');
        expect(COLOR_PRESETS[color]).toHaveProperty('950');
      });
    });

    it('should have valid hex color values', () => {
      const hexPattern = /^#[0-9a-fA-F]{6}$/;
      Object.values(COLOR_PRESETS).forEach(preset => {
        Object.values(preset).forEach(color => {
          expect(color).toMatch(hexPattern);
        });
      });
    });
  });

  describe('primaryColor state', () => {
    it('should default to "blue"', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.primaryColor).toBe('blue');
    });

    it('should restore primaryColor from localStorage', () => {
      localStorageMock.setItem('god-crm-primary-color', 'purple');
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.primaryColor).toBe('purple');
    });

    it('should ignore invalid primaryColor in localStorage and use default', () => {
      localStorageMock.setItem('god-crm-primary-color', 'invalid-color');
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.primaryColor).toBe('blue');
    });
  });

  describe('setPrimaryColor', () => {
    it('should update primaryColor', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      
      act(() => {
        result.current.setPrimaryColor('green');
      });
      
      expect(result.current.primaryColor).toBe('green');
    });

    it('should persist primaryColor to localStorage', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      
      act(() => {
        result.current.setPrimaryColor('orange');
      });
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('god-crm-primary-color', 'orange');
    });

    it('should inject CSS variables into document root', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      
      act(() => {
        result.current.setPrimaryColor('purple');
      });
      
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--color-primary-50')).toBe(COLOR_PRESETS.purple['50']);
      expect(style.getPropertyValue('--color-primary-500')).toBe(COLOR_PRESETS.purple['500']);
      expect(style.getPropertyValue('--color-primary-600')).toBe(COLOR_PRESETS.purple['600']);
    });

    it('should work with all available colors', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      const colors: PrimaryColor[] = ['blue', 'purple', 'green', 'orange', 'red', 'pink', 'teal', 'indigo'];
      
      colors.forEach(color => {
        act(() => {
          result.current.setPrimaryColor(color);
        });
        expect(result.current.primaryColor).toBe(color);
      });
    });
  });

  describe('CSS variables injection', () => {
    it('should inject blue colors on initial render', () => {
      renderHook(() => useTheme(), { wrapper });
      
      const style = document.documentElement.style;
      expect(style.getPropertyValue('--color-primary-500')).toBe(COLOR_PRESETS.blue['500']);
    });

    it('should inject all required color shades', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      
      act(() => {
        result.current.setPrimaryColor('teal');
      });
      
      const style = document.documentElement.style;
      const shades = ['50', '100', '400', '500', '600', '700'] as const;
      
      shades.forEach(shade => {
        expect(style.getPropertyValue(`--color-primary-${shade}`)).toBe(COLOR_PRESETS.teal[shade]);
      });
    });
  });

  describe('existing theme functionality', () => {
    it('should still provide theme (light/dark) functionality', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      
      expect(result.current.theme).toBeDefined();
      expect(['light', 'dark']).toContain(result.current.theme);
      expect(typeof result.current.toggleTheme).toBe('function');
      expect(typeof result.current.setTheme).toBe('function');
    });

    it('should still provide defaultTheme functionality', () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      
      expect(result.current.defaultTheme).toBeDefined();
      expect(['light', 'dark', 'system']).toContain(result.current.defaultTheme);
      expect(typeof result.current.setDefaultTheme).toBe('function');
    });
  });
});
