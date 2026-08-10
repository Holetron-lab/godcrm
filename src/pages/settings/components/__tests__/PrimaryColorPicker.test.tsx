import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrimaryColorPicker } from '../PrimaryColorPicker';
import { ThemeProvider } from '@/shared/hooks/useTheme';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
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

const renderWithProvider = (component: React.ReactNode) => {
  return render(
    <ThemeProvider>
      {component}
    </ThemeProvider>
  );
};

// Helper to open dropdown
const openDropdown = () => {
  // Find the chevron button (dropdown toggle) - it's the second button
  const buttons = screen.getAllByRole('button');
  const dropdownButton = buttons.find(btn => btn.querySelector('svg.lucide-chevron-down')) || buttons[1];
  fireEvent.click(dropdownButton);
};

describe('PrimaryColorPicker', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should render 8 color options in dropdown', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    // Open dropdown first
    openDropdown();
    
    // Now check for 8 preset buttons (they have title attributes)
    const expectedColors = ['Синий', 'Фиолетовый', 'Зелёный', 'Оранжевый', 'Красный', 'Розовый', 'Бирюзовый', 'Индиго'];
    expectedColors.forEach(color => {
      expect(screen.getByTitle(color)).toBeInTheDocument();
    });
  });

  it('should render with title "Акцентный цвет"', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    expect(screen.getByText('Акцентный цвет')).toBeInTheDocument();
  });

  it('should render description text', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    expect(screen.getByText(/Выбранный цвет применяется/)).toBeInTheDocument();
  });

  it('should have all color options with correct titles when dropdown is open', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    // Open dropdown
    openDropdown();
    
    const expectedColors = ['Синий', 'Фиолетовый', 'Зелёный', 'Оранжевый', 'Красный', 'Розовый', 'Бирюзовый', 'Индиго'];
    expectedColors.forEach(color => {
      expect(screen.getByTitle(color)).toBeInTheDocument();
    });
  });

  it('should highlight the currently selected color', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    // Open dropdown
    openDropdown();
    
    const blueButton = screen.getByTitle('Синий');
    // Default is blue, should have ring class
    expect(blueButton.className).toContain('ring-2');
  });

  it('should change color when clicking a different option', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    // Open dropdown
    openDropdown();
    
    const purpleButton = screen.getByTitle('Фиолетовый');
    fireEvent.click(purpleButton);
    
    // Reopen dropdown to check selection
    openDropdown();
    
    // Purple should now have ring class
    const updatedPurpleButton = screen.getByTitle('Фиолетовый');
    expect(updatedPurpleButton.className).toContain('ring-2');
  });

  it('should persist color selection to localStorage', () => {
    renderWithProvider(<PrimaryColorPicker />);
    
    // Open dropdown
    openDropdown();
    
    const greenButton = screen.getByTitle('Зелёный');
    fireEvent.click(greenButton);
    
    expect(localStorageMock.setItem).toHaveBeenCalledWith('god-crm-primary-color', 'green');
  });
});
