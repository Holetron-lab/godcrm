import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { CreateColumnModal } from '../CreateColumnModal';

// Radix Select needs pointer capture; a native select keeps the test on the submit contract.
vi.mock('@/shared/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/ui')>();
  const Select = ({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label?: string }[] }) => (
    <label>{label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label || option.value}</option>)}
      </select>
    </label>
  );
  return { ...actual, Select };
});

const submitColumn = (type: string) => {
  const onSubmit = vi.fn();
  render(<LanguageProvider><CreateColumnModal open onOpenChange={() => undefined} onSubmit={onSubmit} tableId="100684" projectId="8420" /></LanguageProvider>);
  fireEvent.change(screen.getByPlaceholderText('email'), { target: { value: 'photos' } });
  fireEvent.change(screen.getByLabelText('Тип колонки'), { target: { value: type } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  return onSubmit.mock.calls[0][0] as { type: string; config?: { file?: { prefix?: string; saveFormat?: string } } };
};

describe('CreateColumnModal column key', () => {
  it('derives a latin key from a Cyrillic title and keeps the title as display name', () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><CreateColumnModal open onOpenChange={() => undefined} onSubmit={onSubmit} tableId="100684" projectId="8420" /></LanguageProvider>);
    fireEvent.change(screen.getByPlaceholderText('email'), { target: { value: 'Цена, USD' } });
    expect(screen.getByText(/cena_usd/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    const submitted = onSubmit.mock.calls[0][0] as { name: string; displayName: string };
    expect(submitted.name).toBe('cena_usd');
    expect(submitted.displayName).toBe('Цена, USD');
  });

  it('leaves a valid latin key untouched and shows no derived hint', () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><CreateColumnModal open onOpenChange={() => undefined} onSubmit={onSubmit} tableId="100684" projectId="8420" /></LanguageProvider>);
    fireEvent.change(screen.getByPlaceholderText('email'), { target: { value: 'spec_ref' } });
    expect(screen.queryByText(/Будет сохранено как/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect((onSubmit.mock.calls[0][0] as { name: string }).name).toBe('spec_ref');
  });

  it('blocks submit when the title yields an empty key', () => {
    const onSubmit = vi.fn();
    render(<LanguageProvider><CreateColumnModal open onOpenChange={() => undefined} onSubmit={onSubmit} tableId="100684" projectId="8420" /></LanguageProvider>);
    fireEvent.change(screen.getByPlaceholderText('email'), { target: { value: '???' } });
    expect(screen.getByRole('button', { name: 'Создать' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('CreateColumnModal upload defaults', () => {
  it('creates image columns without an external prefix so space uploads keep their own URL', () => {
    const submitted = submitColumn('image');
    expect(submitted.type).toBe('image');
    expect(submitted.config).toBeUndefined();
  });

  it('points file columns at the current origin instead of a foreign ring host', () => {
    const submitted = submitColumn('file');
    expect(submitted.config?.file).toEqual({ prefix: window.location.origin, saveFormat: 'url' });
    expect(JSON.stringify(submitted)).not.toContain('crm.hltrn.cc');
  });
});
