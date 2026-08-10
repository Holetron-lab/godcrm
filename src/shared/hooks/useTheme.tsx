import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark';
type DefaultTheme = 'light' | 'dark' | 'system';
export type PrimaryColorPreset = 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'pink' | 'teal' | 'indigo';
// Support both preset names and custom hex colors
export type PrimaryColor = PrimaryColorPreset | `#${string}`;

interface ThemeContextValue {
  theme: Theme;
  defaultTheme: DefaultTheme;
  primaryColor: PrimaryColor;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setDefaultTheme: (theme: DefaultTheme) => void;
  setPrimaryColor: (color: PrimaryColor) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = 'god-crm-theme';
const DEFAULT_THEME_KEY = 'god-crm-default-theme';
const PRIMARY_COLOR_KEY = 'god-crm-primary-color';

// Color presets for primary accent color (full Tailwind palette)
export const COLOR_PRESETS: Record<PrimaryColor, {
  50: string; 100: string; 200: string; 300: string; 400: string; 
  500: string; 600: string; 700: string; 800: string; 900: string; 950: string;
}> = {
  blue: { 
    50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 
    500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a', 950: '#172554' 
  },
  purple: { 
    50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 
    500: '#a855f7', 600: '#9333ea', 700: '#7e22ce', 800: '#6b21a8', 900: '#581c87', 950: '#3b0764' 
  },
  green: { 
    50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 
    500: '#22c55e', 600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d', 950: '#052e16' 
  },
  orange: { 
    50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 
    500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12', 950: '#431407' 
  },
  red: { 
    50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 
    500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d', 950: '#450a0a' 
  },
  pink: { 
    50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 
    500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843', 950: '#500724' 
  },
  teal: { 
    50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 
    500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a', 950: '#042f2e' 
  },
  indigo: { 
    50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 
    500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b' 
  },
};

const VALID_PRIMARY_COLORS: PrimaryColorPreset[] = ['blue', 'purple', 'green', 'orange', 'red', 'pink', 'teal', 'indigo'];

// Helper: Check if color is a valid hex
const isHexColor = (color: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(color);

// Helper: Check if color is a preset name
const isPresetColor = (color: string): color is PrimaryColorPreset => 
  VALID_PRIMARY_COLORS.includes(color as PrimaryColorPreset);

// Helper: Generate color palette from a single hex color
// Uses HSL manipulation to create lighter/darker variants
const generatePaletteFromHex = (hex: string): Record<string, string> => {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  // Convert RGB to HSL
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm: h = ((gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)) / 6; break;
      case gNorm: h = ((bNorm - rNorm) / d + 2) / 6; break;
      case bNorm: h = ((rNorm - gNorm) / d + 4) / 6; break;
    }
  }
  
  // Convert HSL back to hex
  const hslToHex = (h: number, s: number, l: number): string => {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let rOut, gOut, bOut;
    if (s === 0) {
      rOut = gOut = bOut = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      rOut = hue2rgb(p, q, h + 1/3);
      gOut = hue2rgb(p, q, h);
      bOut = hue2rgb(p, q, h - 1/3);
    }
    
    const toHex = (x: number) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(rOut)}${toHex(gOut)}${toHex(bOut)}`;
  };
  
  // Generate palette with different lightness levels
  // Mapping: 50 (very light) -> 950 (very dark)
  return {
    50: hslToHex(h, s, 0.97),
    100: hslToHex(h, s, 0.94),
    200: hslToHex(h, s, 0.86),
    300: hslToHex(h, s, 0.74),
    400: hslToHex(h, s, 0.62),
    500: hslToHex(h, s, 0.50),  // Base color (approximately)
    600: hslToHex(h, s, 0.42),
    700: hslToHex(h, s, 0.34),
    800: hslToHex(h, s, 0.26),
    900: hslToHex(h, s, 0.20),
    950: hslToHex(h, s, 0.12),
  };
};

const getSystemTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
};

const getStoredDefaultTheme = (): DefaultTheme => {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(DEFAULT_THEME_KEY) as DefaultTheme | null;
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
};

const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') {
    return 'light';
  }
  // Check if user has manually set a theme (current session)
  const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  // Otherwise use default theme setting
  const defaultTheme = getStoredDefaultTheme();
  if (defaultTheme === 'system') {
    return getSystemTheme();
  }
  return defaultTheme;
};

const getStoredPrimaryColor = (): PrimaryColor => {
  if (typeof window === 'undefined') return 'blue';
  const stored = window.localStorage.getItem(PRIMARY_COLOR_KEY);
  if (stored) {
    // Check if it's a preset color
    if (isPresetColor(stored)) {
      return stored;
    }
    // Check if it's a valid hex color
    if (isHexColor(stored)) {
      return stored as PrimaryColor;
    }
  }
  return 'blue';
};

const applyPrimaryColorCSSVariables = (color: PrimaryColor): void => {
  if (typeof document === 'undefined') return;
  
  let colors: Record<string, string>;
  
  // Check if it's a preset or custom hex
  if (isPresetColor(color)) {
    colors = COLOR_PRESETS[color];
  } else if (isHexColor(color)) {
    colors = generatePaletteFromHex(color);
  } else {
    // Fallback to blue
    colors = COLOR_PRESETS.blue;
  }
  
  const root = document.documentElement;
  root.style.setProperty('--color-primary-50', colors[50]);
  root.style.setProperty('--color-primary-100', colors[100]);
  root.style.setProperty('--color-primary-200', colors[200]);
  root.style.setProperty('--color-primary-300', colors[300]);
  root.style.setProperty('--color-primary-400', colors[400]);
  root.style.setProperty('--color-primary-500', colors[500]);
  root.style.setProperty('--color-primary-600', colors[600]);
  root.style.setProperty('--color-primary-700', colors[700]);
  root.style.setProperty('--color-primary-800', colors[800]);
  root.style.setProperty('--color-primary-900', colors[900]);
  root.style.setProperty('--color-primary-950', colors[950]);
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [defaultTheme, setDefaultThemeState] = useState<DefaultTheme>(getStoredDefaultTheme);
  const [primaryColor, setPrimaryColorState] = useState<PrimaryColor>(getStoredPrimaryColor);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Apply primary color CSS variables
  useEffect(() => {
    applyPrimaryColorCSSVariables(primaryColor);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PRIMARY_COLOR_KEY, primaryColor);
    }
  }, [primaryColor]);

  const toggleTheme = () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  const setTheme = (nextTheme: Theme) => setThemeState(nextTheme);
  
  const setDefaultTheme = (nextDefaultTheme: DefaultTheme) => {
    setDefaultThemeState(nextDefaultTheme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DEFAULT_THEME_KEY, nextDefaultTheme);
    }
  };

  const setPrimaryColor = (color: PrimaryColor) => {
    setPrimaryColorState(color);
  };

  const value = useMemo(
    () => ({ theme, defaultTheme, primaryColor, toggleTheme, setTheme, setDefaultTheme, setPrimaryColor }),
    [theme, defaultTheme, primaryColor]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
