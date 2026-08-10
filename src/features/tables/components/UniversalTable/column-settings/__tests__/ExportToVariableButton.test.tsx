import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ExportToVariableButton } from '../ExportToVariableButton';

describe('ExportToVariableButton', () => {
  it('returns null when aggregation is not enabled', () => {
    const { container } = render(<ExportToVariableButton enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "📤 В переменные" button when enabled but not linked', () => {
    render(<ExportToVariableButton enabled={true} linked={null} />);
    expect(screen.getByText('📤')).toBeInTheDocument();
    expect(screen.getByText('В переменные')).toBeInTheDocument();
  });

  it('shows variable chip with name and remove button when linked', () => {
    render(
      <ExportToVariableButton
        enabled={true}
        linked={{ variableId: 1, variableName: '$revenue_sum' }}
      />
    );

    expect(screen.getByText('$revenue_sum')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /удалить|×/i })).toBeInTheDocument();
  });

  it('calls onExport when export button clicked', async () => {
    const onExport = vi.fn().mockResolvedValue({ id: 1, name: '$sum' });
    render(
      <ExportToVariableButton enabled={true} linked={null} onExport={onExport} />
    );

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
  });

  it('calls onUnlink when remove button clicked', () => {
    const onUnlink = vi.fn();
    render(
      <ExportToVariableButton
        enabled={true}
        linked={{ variableId: 1, variableName: '$sum' }}
        onUnlink={onUnlink}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /удалить|×/i }));
    expect(onUnlink).toHaveBeenCalled();
  });

  it('shows loading state during export', async () => {
    const onExport = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 100)));
    render(
      <ExportToVariableButton enabled={true} linked={null} onExport={onExport} />
    );

    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(button).toHaveAttribute('disabled');
    });
  });

  it('shows error state on export failure', async () => {
    const onExport = vi.fn().mockRejectedValue(new Error('API Error'));
    render(
      <ExportToVariableButton enabled={true} linked={null} onExport={onExport} />
    );

    fireEvent.click(screen.getByRole('button'));
    
    await waitFor(() => {
      expect(screen.getByText(/ошибка/i)).toBeInTheDocument();
    });
  });
});
