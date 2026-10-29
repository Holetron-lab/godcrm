import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DynamicFormRenderer } from '../DynamicFormRenderer';
import type { FormConfig, FormTextBlock } from '../../../types/form-config.types';

vi.mock('../../modals/FieldRenderer', () => ({ FieldRenderer: () => null }));
afterEach(cleanup);

const textBlock: FormTextBlock = { id: 'text', type: 'text', content: '**Hello** {{name}}', order: 0 };
const config: FormConfig = { version: 1, layout: 'grid', fields: [], elements: [textBlock] };

describe('DynamicFormRenderer text blocks', () => {
  it.each([undefined, 'full', 'half', 'third', 'quarter', 'auto'] as const)(
    'renders text with width %s without crashing', width => {
      render(<DynamicFormRenderer config={{ ...config, elements: [{ ...textBlock, width }] }} columns={[]} formData={{ name: 'Ada' }} onChange={vi.fn()} />);
      expect(screen.getByText('Hello').tagName).toBe('STRONG');
      expect(screen.getByText(/Ada/)).toBeInTheDocument();
    }
  );

  it('keeps interpolated HTML sanitized', () => {
    const { container } = render(<DynamicFormRenderer config={config} columns={[]} formData={{ name: '<img src="x" onerror="alert(1)"><script>alert(1)</script>' }} onChange={vi.fn()} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(container.querySelector('script, [onerror]')).toBeNull();
  });

  it('renders text on a later page and supports returning by button', () => {
    render(<DynamicFormRenderer config={{ ...config, elements: [{ id: 'page', type: 'page-break', order: 0 }, { ...textBlock, order: 1 }] }} columns={[]} formData={{ name: 'Ada' }} onChange={vi.fn()} />);
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    expect(screen.getByText('Hello')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.queryByText('Hello')).not.toBeInTheDocument();
  });
});
