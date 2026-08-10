import { ExternalLink, Link2, Globe, ArrowUpRight, MousePointerClick } from 'lucide-react';

interface UrlCellProps {
  value: unknown;
  rawMode?: boolean;
  config?: {
    url?: {
      prefix?: string;
      suffix?: string;
      valueTemplate?: string;  // Template for cell value, e.g. {{id}}
      linkText?: string;       // Display text template
      style?: 'default' | 'button' | 'minimal' | 'badge';
      buttonColor?: string;    // Color for button style
      multipleLinks?: boolean;
    };
  };
  rowData?: Record<string, unknown>;
}

/**
 * Replace template variables {{column_name}} with values from rowData
 */
const replaceTemplateVars = (template: string, currentValue?: string, rowData?: Record<string, unknown>): string => {
  if (!template) return template || '';
  
  // First replace {{value}} with current value
  let result = template.replace(/\{\{value\}\}/gi, currentValue || '');
  
  // Then replace other column references
  if (rowData) {
    result = result.replace(/\{\{(\w+)\}\}/g, (match, columnName) => {
      const value = rowData[columnName];
      if (value === null || value === undefined) return '';
      return String(value);
    });
  }
  
  return result;
};

/**
 * Parse value into array of values (split by comma, semicolon, or newline)
 */
const parseMultipleValues = (value: string): string[] => {
  // Split by newline, comma, or semicolon
  const parts = value.split(/[\n,;]+/).map(v => v.trim()).filter(v => v.length > 0);
  return parts;
};

interface SingleLinkProps {
  url: string;
  linkText: string;
  style: 'default' | 'button' | 'minimal' | 'badge';
  buttonColor?: string;
}

// Color presets for buttons
const buttonColorPresets: Record<string, { bg: string; hover: string; text: string; useVar?: boolean }> = {
  blue: { bg: 'var(--color-primary-600)', hover: 'var(--color-primary-700)', text: '#ffffff', useVar: true },
  green: { bg: '#22c55e', hover: '#16a34a', text: '#ffffff' },
  red: { bg: '#ef4444', hover: '#dc2626', text: '#ffffff' },
  orange: { bg: '#f97316', hover: '#ea580c', text: '#ffffff' },
  purple: { bg: '#8b5cf6', hover: '#7c3aed', text: '#ffffff' },
  pink: { bg: '#ec4899', hover: '#db2777', text: '#ffffff' },
  teal: { bg: '#14b8a6', hover: '#0d9488', text: '#ffffff' },
  indigo: { bg: '#6366f1', hover: '#4f46e5', text: '#ffffff' },
  gray: { bg: '#6b7280', hover: '#4b5563', text: '#ffffff' },
  system: { bg: 'var(--bg-tertiary)', hover: 'var(--bg-secondary)', text: 'var(--text-primary)', useVar: true },
};

const SingleLink = ({ url, linkText, style, buttonColor }: SingleLinkProps) => {
  if (style === 'badge') {
    const color = buttonColor && buttonColorPresets[buttonColor] ? buttonColorPresets[buttonColor] : null;
    
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:scale-105"
        style={color ? {
          backgroundColor: `${color.bg}20`,
          color: color.bg,
        } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="max-w-[120px] truncate">{linkText}</span>
        <ExternalLink className="w-3 h-3 opacity-70" />
      </a>
    );
  }
  
  if (style === 'button') {
    const color = buttonColor && buttonColorPresets[buttonColor] 
      ? buttonColorPresets[buttonColor] 
      : buttonColorPresets.blue;
    
    // For blue (primary), use CSS classes for proper theme support
    if (buttonColor === 'blue' || !buttonColor) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0 bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)] text-white"
          onClick={(e) => e.stopPropagation()}
        >
          <MousePointerClick className="w-4 h-4" />
          <span className="max-w-[150px] truncate">{linkText}</span>
        </a>
      );
    }
    
    // For system (neutral), use CSS classes for theme adaptation
    if (buttonColor === 'system') {
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]"
          onClick={(e) => e.stopPropagation()}
        >
          <MousePointerClick className="w-4 h-4" />
          <span className="max-w-[150px] truncate">{linkText}</span>
        </a>
      );
    }
    
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5 active:translate-y-0"
        style={{
          background: `linear-gradient(135deg, ${color.bg} 0%, ${color.hover} 100%)`,
          color: color.text,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <MousePointerClick className="w-4 h-4" />
        <span className="max-w-[150px] truncate">{linkText}</span>
      </a>
    );
  }
  
  if (style === 'minimal') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--color-primary-500)] transition-colors group"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="max-w-[180px] truncate underline underline-offset-2 decoration-dotted decoration-[var(--text-tertiary)] group-hover:decoration-[var(--color-primary-500)]">{linkText}</span>
        <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-70" />
      </a>
    );
  }
  
  // Default style
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-primary-500)] hover:text-[var(--color-primary-600)] dark:hover:text-[var(--color-primary-400)] hover:underline transition-colors"
      onClick={(e) => e.stopPropagation()}
    >
      <Link2 className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="max-w-[180px] truncate">{linkText}</span>
    </a>
  );
};

export const UrlCell = ({ value, rawMode, config, rowData }: UrlCellProps) => {
  // RAW mode - show URL as-is
  if (rawMode) {
    if (value === null || value === undefined) {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)]">
        {String(value)}
      </span>
    );
  }

  const urlConfig = config?.url;
  const style = urlConfig?.style ?? 'default';
  const buttonColor = urlConfig?.buttonColor ?? 'blue';
  const multipleLinks = urlConfig?.multipleLinks ?? false;
  
  // Check if we have template-based URL
  const hasTemplateUrl = urlConfig?.prefix || urlConfig?.suffix || urlConfig?.valueTemplate || urlConfig?.linkText;
  
  // If value is empty but we have template config - try to build URL from template
  const isEmpty = value === null || value === undefined || value === '';
  
  if (isEmpty && !hasTemplateUrl) {
    return <span className="text-[var(--text-tertiary)]">—</span>;
  }
  
  const cellValue = isEmpty ? '' : String(value);
  
  // Parse values (single or multiple)
  // If value is empty but we have template, use single empty value to trigger template processing
  const values = isEmpty ? [''] : (multipleLinks ? parseMultipleValues(cellValue) : [cellValue]);
  
  // Build URLs for each value
  const links = values.map((val) => {
    // If valueTemplate is set, use it to get the actual value
    let actualValue = val;
    if (urlConfig?.valueTemplate) {
      actualValue = replaceTemplateVars(urlConfig.valueTemplate, val, rowData);
    }
    
    let url = actualValue;
    
    // If prefix or suffix defined, construct URL
    if (urlConfig?.prefix || urlConfig?.suffix) {
      const prefix = replaceTemplateVars(urlConfig?.prefix || '', actualValue, rowData);
      const suffix = replaceTemplateVars(urlConfig?.suffix || '', actualValue, rowData);
      url = `${prefix}${actualValue}${suffix}`;
    }
    
    // Ensure URL has protocol
    if (url && !url.match(/^https?:\/\//i) && !url.startsWith('/')) {
      url = `https://${url}`;
    }
    
    // Determine link text
    let linkText = actualValue;
    if (urlConfig?.linkText) {
      linkText = replaceTemplateVars(urlConfig.linkText, actualValue, rowData);
      // If linkText template resulted in empty, use actualValue or url
      if (!linkText) linkText = actualValue || url;
    }
    // If still no linkText but we have URL, extract something meaningful
    if (!linkText && url) {
      // Try to show last path segment or domain
      try {
        const urlObj = new URL(url);
        linkText = urlObj.pathname.split('/').filter(Boolean).pop() || urlObj.hostname;
      } catch {
        linkText = url;
      }
    }
    
    return { url, linkText };
  });
  
  // Single link
  if (links.length === 1) {
    return <SingleLink url={links[0].url} linkText={links[0].linkText} style={style} buttonColor={buttonColor} />;
  }
  
  // Multiple links
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((link, index) => (
        <SingleLink key={index} url={link.url} linkText={link.linkText} style={style} buttonColor={buttonColor} />
      ))}
    </div>
  );
};
