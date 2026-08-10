import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SafeHtml } from './SafeHtml';

describe('SafeHtml', () => {
  // 🔴 RED: XSS script tags must be removed
  it('should sanitize XSS script tags', () => {
    const malicious = '<script>alert("xss")</script><p>Safe</p>';
    render(<SafeHtml html={malicious} />);
    
    expect(screen.getByText('Safe')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  // 🔴 RED: Event handlers must be removed
  it('should remove event handlers', () => {
    const malicious = '<img src="x" onerror="alert(1)" /><span>Text</span>';
    const { container } = render(<SafeHtml html={malicious} />);
    
    const img = container.querySelector('img');
    expect(img?.getAttribute('onerror')).toBeNull();
  });

  // 🔴 RED: Safe tags must be preserved
  it('should allow safe tags', () => {
    const safe = '<p><strong>Bold</strong> and <a href="https://example.com">link</a></p>';
    render(<SafeHtml html={safe} />);
    
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com');
  });

  // 🔴 RED: javascript: URLs must be removed
  it('should remove javascript: URLs', () => {
    const malicious = '<a href="javascript:alert(1)">Click</a>';
    render(<SafeHtml html={malicious} />);
    
    const link = screen.getByText('Click');
    const href = link.getAttribute('href');
    // DOMPurify either removes href completely or sanitizes the javascript: protocol
    expect(href === null || !href.includes('javascript:')).toBe(true);
  });

  // 🔴 RED: Should render as span when specified
  it('should render as span when specified', () => {
    const { container } = render(<SafeHtml html="<b>Text</b>" as="span" />);
    expect(container.querySelector('span')).toBeInTheDocument();
    expect(container.querySelector('div')).toBeNull();
  });

  // 🔴 RED: Should apply className
  it('should apply className', () => {
    const { container } = render(<SafeHtml html="<b>Text</b>" className="test-class" />);
    expect(container.querySelector('.test-class')).toBeInTheDocument();
  });

  // 🔴 RED: Should handle empty string
  it('should handle empty string', () => {
    const { container } = render(<SafeHtml html="" />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
