import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ImageCell } from '../ImageCell';

const value = '/wide.png,/portrait.png,/third.png';
const wrapper = LanguageProvider;

describe('image column display', () => {
  it.each(['cover', 'contain', 'fill', 'none'] as const)('applies %s to actual images', fit => {
    render(<ImageCell value={value} readOnly config={{ image: { fit, rowHeight: 96, shape: 'circle', displayMode: 'single' } }} />, { wrapper });
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveStyle({ objectFit: fit, width: '96px', height: '96px' });
    expect(images[0]).toHaveClass('rounded-full');
  });

  it('limits the stack, applies its offset and hides the optional counter', () => {
    const { container } = render(<ImageCell value={value} readOnly config={{ image: { displayMode: 'stack', maxImages: 2, stackOffset: 20, showCount: false } }} />, { wrapper });
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(container.querySelector('[style*="left: 20px"]')).toBeInTheDocument();
    expect(screen.queryByText(/3/)).not.toBeInTheDocument();
  });

  it('uses the grid thumbnail size and displays filenames', () => {
    render(<ImageCell value={value} readOnly config={{ image: { displayMode: 'grid', thumbnailSize: 24, showFilename: true } }} />, { wrapper });
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getAllByRole('img')[0]).toHaveStyle({ width: '24px', height: '24px' });
    expect(screen.getByText('wide.png')).toBeVisible();
  });

  it('navigates the carousel by keyboard and removes the displayed source index', async () => {
    localStorage.setItem('god-crm-language', 'en');
    const update = vi.fn();
    render(<ImageCell value={value.replace(/\//g, '')} onUpdate={update} config={{ file: { prefix: '/' }, image: { displayMode: 'carousel', lightbox: false } }} />, { wrapper });
    screen.getByRole('button', { name: 'Next image' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('img')).toHaveAttribute('src', '/portrait.png');
    expect(screen.queryByRole('button', { name: /Open image/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(update).toHaveBeenCalledWith('wide.png,third.png');
  });

  it('opens a lightbox with keyboard, closes with Escape and restores focus', async () => {
    localStorage.setItem('god-crm-language', 'en');
    render(<ImageCell value={value} readOnly config={{ image: { displayMode: 'single' } }} />, { wrapper });
    const open = screen.getByRole('button', { name: 'Open image 1' });
    open.focus();
    await userEvent.keyboard('{Enter}');
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/wide.png');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it('offers an explicit retry instead of repeatedly reloading a failed image', () => {
    render(<ImageCell value="/broken.png" readOnly />, { wrapper });
    const image = screen.getByRole('img');
    fireEvent.error(image);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Повторить загрузку/ }));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/broken.png');
  });
});

describe('image cell hover bar', () => {
  it('shows the count next to the upload control for editors and only the count when read-only', () => {
    const { rerender } = render(<ImageCell value={value} tableId={1} rowId="2" columnId="images" />, { wrapper });
    const count = screen.getByText('Images: 3');
    expect(within(count.parentElement as HTMLElement).getByRole('button', { name: 'Add images' })).toBeInTheDocument();
    expect(count.parentElement).toHaveClass('sticky');
    rerender(<ImageCell value={value} readOnly />);
    expect(screen.getByText('Images: 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add images' })).not.toBeInTheDocument();
  });
});
