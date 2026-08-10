import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DateCell } from '../DateCell';

/**
 * ADR-070: Date Modes — Component Tests for DateCell
 * Tests rendering of DateCell in all 6 modes
 */

// Mock useLanguage — DateCell uses it for locale-aware formatting
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'ru',
    t: (key: string) => key,
    setLanguage: vi.fn(),
  }),
}));

// ===================================================================
// RAW mode (all modes)
// ===================================================================
describe('DateCell - RAW mode', () => {
  it('should show NULL for null value', () => {
    render(<DateCell value={null} rawMode />);
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('should show NULL for empty string', () => {
    render(<DateCell value="" rawMode />);
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('should show raw ISO string', () => {
    render(<DateCell value="2025-12-15T14:30:00Z" rawMode />);
    expect(screen.getByText('2025-12-15T14:30:00Z')).toBeInTheDocument();
  });

  it('should show raw month value', () => {
    render(<DateCell value="2025-12" rawMode mode="month" />);
    expect(screen.getByText('2025-12')).toBeInTheDocument();
  });

  it('should show raw year value', () => {
    render(<DateCell value="2025" rawMode mode="year" />);
    expect(screen.getByText('2025')).toBeInTheDocument();
  });

  it('should show raw week value', () => {
    render(<DateCell value="2025-W50" rawMode mode="week" />);
    expect(screen.getByText('2025-W50')).toBeInTheDocument();
  });

  it('should show raw quarter value', () => {
    render(<DateCell value="2025-Q4" rawMode mode="quarter" />);
    expect(screen.getByText('2025-Q4')).toBeInTheDocument();
  });
});

// ===================================================================
// Empty state
// ===================================================================
describe('DateCell - Empty values', () => {
  it('should show "Date..." placeholder for null', () => {
    render(<DateCell value={null} />);
    expect(screen.getByText('Date...')).toBeInTheDocument();
  });

  it('should show "Date..." placeholder for empty string', () => {
    render(<DateCell value="" />);
    expect(screen.getByText('Date...')).toBeInTheDocument();
  });

  it('should show "Date..." placeholder for undefined', () => {
    render(<DateCell value={undefined} />);
    expect(screen.getByText('Date...')).toBeInTheDocument();
  });
});

// ===================================================================
// Month mode (ADR-070)
// ===================================================================
describe('DateCell - Month mode', () => {
  it('should render month in default format (full name)', () => {
    render(<DateCell value="2025-12" mode="month" />);
    expect(screen.getByText('Декабрь 2025')).toBeInTheDocument();
  });

  it('should render month in short format', () => {
    render(<DateCell value="2025-12" mode="month" displayFormat="short" />);
    expect(screen.getByText('Дек. 2025')).toBeInTheDocument();
  });

  it('should render month in numeric format', () => {
    render(<DateCell value="2025-12" mode="month" displayFormat="numeric" />);
    expect(screen.getByText('12.2025')).toBeInTheDocument();
  });

  it('should render month in ISO format', () => {
    render(<DateCell value="2025-12" mode="month" displayFormat="iso" />);
    expect(screen.getByText('2025-12')).toBeInTheDocument();
  });

  it('should show "Invalid month" for bad value', () => {
    render(<DateCell value="not-a-month" mode="month" />);
    expect(screen.getByText('Invalid month')).toBeInTheDocument();
  });

  it('should show "Invalid month" for month 13', () => {
    render(<DateCell value="2025-13" mode="month" />);
    expect(screen.getByText('Invalid month')).toBeInTheDocument();
  });
});

// ===================================================================
// Year mode (ADR-070)
// ===================================================================
describe('DateCell - Year mode', () => {
  it('should render year in default format', () => {
    render(<DateCell value="2025" mode="year" />);
    expect(screen.getByText('2025')).toBeInTheDocument();
  });

  it('should render year in full format (ru)', () => {
    render(<DateCell value="2025" mode="year" displayFormat="full" />);
    expect(screen.getByText('2025 г.')).toBeInTheDocument();
  });

  it('should show "Invalid year" for bad value', () => {
    render(<DateCell value="abc" mode="year" />);
    expect(screen.getByText('Invalid year')).toBeInTheDocument();
  });

  it('should show "Invalid year" for year below 1900', () => {
    render(<DateCell value="1899" mode="year" />);
    expect(screen.getByText('Invalid year')).toBeInTheDocument();
  });
});

// ===================================================================
// Week mode (ADR-070)
// ===================================================================
describe('DateCell - Week mode', () => {
  it('should render week in default format', () => {
    render(<DateCell value="2025-W50" mode="week" />);
    expect(screen.getByText('Неделя 50, 2025')).toBeInTheDocument();
  });

  it('should render week in short format', () => {
    render(<DateCell value="2025-W50" mode="week" displayFormat="short" />);
    expect(screen.getByText('Нед. 50')).toBeInTheDocument();
  });

  it('should render week in ISO format', () => {
    render(<DateCell value="2025-W50" mode="week" displayFormat="iso" />);
    expect(screen.getByText('2025-W50')).toBeInTheDocument();
  });

  it('should show "Invalid week" for bad value', () => {
    render(<DateCell value="2025-50" mode="week" />);
    expect(screen.getByText('Invalid week')).toBeInTheDocument();
  });

  it('should show "Invalid week" for week 0', () => {
    render(<DateCell value="2025-W00" mode="week" />);
    expect(screen.getByText('Invalid week')).toBeInTheDocument();
  });
});

// ===================================================================
// Quarter mode (ADR-070)
// ===================================================================
describe('DateCell - Quarter mode', () => {
  it('should render quarter in default format', () => {
    render(<DateCell value="2025-Q4" mode="quarter" />);
    expect(screen.getByText('4 квартал 2025')).toBeInTheDocument();
  });

  it('should render quarter in short format', () => {
    render(<DateCell value="2025-Q4" mode="quarter" displayFormat="short" />);
    expect(screen.getByText('Q4 2025')).toBeInTheDocument();
  });

  it('should render quarter in numeric format', () => {
    render(<DateCell value="2025-Q4" mode="quarter" displayFormat="numeric" />);
    expect(screen.getByText('4/2025')).toBeInTheDocument();
  });

  it('should show "Invalid quarter" for bad value', () => {
    render(<DateCell value="2025-4" mode="quarter" />);
    expect(screen.getByText('Invalid quarter')).toBeInTheDocument();
  });

  it('should show "Invalid quarter" for Q0', () => {
    render(<DateCell value="2025-Q0" mode="quarter" />);
    expect(screen.getByText('Invalid quarter')).toBeInTheDocument();
  });
});

// ===================================================================
// Date mode (classic)
// ===================================================================
describe('DateCell - Date mode', () => {
  it('should render date in default format', () => {
    render(<DateCell value="2025-12-15" mode="date" />);
    // Default locale format for ru-RU
    const el = screen.getByText(/2025/);
    expect(el).toBeInTheDocument();
  });

  it('should render date in ISO display format', () => {
    render(<DateCell value="2025-12-15" mode="date" displayFormat="iso_date" />);
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });

  it('should show "Invalid date" for garbage', () => {
    render(<DateCell value="not-a-date" mode="date" />);
    expect(screen.getByText('Invalid date')).toBeInTheDocument();
  });
});

// ===================================================================
// Datetime mode (classic)
// ===================================================================
describe('DateCell - Datetime mode', () => {
  it('should render datetime with time', () => {
    render(<DateCell value="2025-12-15T14:30:00Z" mode="datetime" showTime />);
    const el = screen.getByText(/2025/);
    expect(el).toBeInTheDocument();
  });

  it('should render ISO display format for datetime', () => {
    render(<DateCell value="2025-12-15T00:00:00Z" displayFormat="iso_date" showTime />);
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });
});

// ===================================================================
// Mode defaults
// ===================================================================
describe('DateCell - Mode defaults', () => {
  it('should default to date mode when no mode and showTime=false', () => {
    // Should render as date (not month/week/quarter)
    render(<DateCell value="2025-12-15" displayFormat="iso_date" />);
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });

  it('should default to datetime mode when no mode and showTime=true', () => {
    render(<DateCell value="2025-12-15T14:30:00Z" showTime displayFormat="iso_date" />);
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });
});

// ===================================================================
// EU format dates (parsed via parseDate)
// ===================================================================
describe('DateCell - EU format values', () => {
  it('should render EU date "15.12.2025" in date mode', () => {
    render(<DateCell value="15.12.2025" mode="date" displayFormat="iso_date" />);
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });

  it('should render EU date in default format', () => {
    render(<DateCell value="15.12.2025" mode="date" />);
    const el = screen.getByText(/2025/);
    expect(el).toBeInTheDocument();
  });
});

// ===================================================================
// US format dates (parsed via parseDate)
// ===================================================================
describe('DateCell - US format values', () => {
  it('should render US date "12/15/2025" in date mode', () => {
    render(<DateCell value="12/15/2025" mode="date" displayFormat="iso_date" />);
    expect(screen.getByText('2025-12-15')).toBeInTheDocument();
  });

  it('should render US date in default format', () => {
    render(<DateCell value="12/15/2025" mode="date" />);
    const el = screen.getByText(/2025/);
    expect(el).toBeInTheDocument();
  });
});
