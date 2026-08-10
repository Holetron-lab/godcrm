import DOMPurify from 'dompurify';

interface SafeHtmlProps {
  /** HTML content to sanitize and render */
  html: string;
  /** CSS class name */
  className?: string;
  /** HTML tag to use (default: div) */
  as?: 'div' | 'span';
}

/**
 * Safely renders HTML content with XSS protection using DOMPurify.
 * 
 * @example
 * <SafeHtml html="<b>Bold</b> text" />
 * <SafeHtml html="<a href='#'>Link</a>" as="span" className="prose" />
 */
export function SafeHtml({ html, className, as: Tag = 'div' }: SafeHtmlProps) {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre', 'span', 'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'target', 'class', 'rel', 'src', 'alt', 'title'],
    ADD_ATTR: ['target'], // Allow target for links
  });

  return (
    <Tag
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
