/**
 * Tests for PublicAttachmentPlaceholder (ADR-0060 AC13).
 *
 * The placeholder must never trigger network fetches and must always
 * surface a recognisable filename label to the public viewer.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PublicAttachmentPlaceholder } from '../PublicAttachmentPlaceholder';

describe('PublicAttachmentPlaceholder', () => {
  it('renders em-dash when value is empty', () => {
    render(<PublicAttachmentPlaceholder value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('extracts filename from a single URL string', () => {
    render(<PublicAttachmentPlaceholder value="/uploads/abc-123/My%20Photo.png" variant="image" />);
    expect(screen.getByText('My Photo.png')).toBeInTheDocument();
  });

  it('handles comma-joined URL lists by taking the first', () => {
    render(<PublicAttachmentPlaceholder value="/uploads/a.pdf,/uploads/b.pdf" variant="file" />);
    expect(screen.getByText('a.pdf')).toBeInTheDocument();
  });

  it('reads name from an object payload', () => {
    render(<PublicAttachmentPlaceholder value={{ name: 'invoice.pdf', url: '/foo/bar' }} />);
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
  });

  it('falls back to extracting from object.url when name is missing', () => {
    render(<PublicAttachmentPlaceholder value={{ url: '/uploads/report%202024.csv' }} />);
    expect(screen.getByText('report 2024.csv')).toBeInTheDocument();
  });

  it('never renders an <img> element regardless of variant', () => {
    const { container } = render(
      <PublicAttachmentPlaceholder value="/uploads/photo.jpg" variant="image" />,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('never renders an <a href> for the value', () => {
    const { container } = render(
      <PublicAttachmentPlaceholder value="/uploads/file.zip" variant="file" />,
    );
    expect(container.querySelector('a[href]')).toBeNull();
  });
});
