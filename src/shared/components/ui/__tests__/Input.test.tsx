import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '../Input';

describe('Input', () => {
  it('shows label and hint text', () => {
    render(<Input name="email" label="Email" hint="Use company email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Use company email')).toBeInTheDocument();
  });

  it('renders error state', () => {
    render(<Input name="email" label="Email" error="Required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('propagates change events', () => {
    render(<Input name="email" label="Email" />);
    const input = screen.getByLabelText('Email');
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    expect((input as HTMLInputElement).value).toBe('test@example.com');
  });
});
