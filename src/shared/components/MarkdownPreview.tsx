/**
 * MarkdownPreview - компонент для отображения Markdown контента
 *
 * Поддерживает:
 * - GitHub Flavored Markdown (GFM)
 * - Таблицы, чекбоксы, strikethrough
 * - Подсветка синтаксиса кода
 * - Кастомные стили для CRM
 * - Переменные: {variable_name} заменяются на значения из props
 * - Интерактивные чекбоксы: клик переключает [ ] ↔ [x]
 * - Поддержка символов: ☐/☑, □/■, ⬜/✅, [*]
 *
 * @see src/shared/config/systemVariables.ts for available system variables
 */

import { memo, useState, useRef, useCallback, createContext, useContext } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { SafeChatImage } from './SafeChatImage';
import { SocialMediaLink } from './SocialMediaLink';
import { Copy, Check } from 'lucide-react';
import { substituteAllVariables } from '../config/systemVariables';
import {
  normalizeCheckboxes,
  toggleCheckboxByIndex,
  getCheckboxContext,
  denormalizeCheckboxes,
} from '../utils/markdownCheckbox';
import { MentionPill, CommandPill, handlePillClickExternal } from '../../features/ai-chat/components/InvocationPills';
import { useLanguage } from '@/shared/i18n/LanguageContext';

/**
 * Convert <<@slug>> and <</slug>> invocation tokens to markdown links
 * so ReactMarkdown can render them as pills via custom `a` component.
 *
 * Mention/command syntax inside fenced (```...```) or inline (`...`) code spans
 * is preserved verbatim — converting it would produce raw `[@slug](mention:slug)`
 * text inside `<code>` since the custom `a` renderer never runs there.
 */
function convertInvocationTokensToLinks(text: string): string {
  // Split by fenced (```...```) and inline (`...`) code spans.
  // Even indices = text outside code (apply replacements);
  // odd indices = code spans (keep as-is).
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/<<@([a-z0-9][a-z0-9_-]*)>>/gi, (_, slug) => `[@${slug}](mention:${slug.toLowerCase()})`)
        .replace(/<<\/([a-z0-9][a-z0-9_-]*)>>/gi, (_, slug) => `[/${slug}](command:${slug.toLowerCase()})`)
        // Plain @slug → outlined reference (only after whitespace/start, avoid emails and already-converted links)
        .replace(/(^|[\s\n])@([a-z0-9][a-z0-9_-]*)\b/gi, (_, pre, slug) => `${pre}[@${slug}](reference:${slug.toLowerCase()})`);
    })
    .join('');
}

/**
 * Convert ||spoiler text|| to markdown links with spoiler: protocol
 * so ReactMarkdown renders them via custom `a` component as clickable spoilers.
 */
function convertSpoilers(text: string): string {
  // Match ||content|| but not inside code blocks
  return text.replace(/\|\|([^|]+?)\|\|/g, (_, content) => `[${content}](spoiler:hidden)`);
}

export interface CheckboxUser {
  name: string;
  id: number;
}

export interface CheckboxClickInfo {
  /** The text of the checkbox line (without the checkbox syntax) */
  lineText: string;
  /** The nearest h2/h3 heading above the checkbox */
  heading: string;
  /** Whether the checkbox is now checked (after toggle) */
  checked: boolean;
  /** Zero-based index of the checkbox in the content */
  index: number;
  /** Who toggled the checkbox (if currentUser was provided) */
  user?: CheckboxUser;
}

/** Extract plain text from React children for clipboard copy */
function extractText(node: React.ReactNode): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as React.ReactElement).props?.children);
  }
  return '';
}

/** Code block wrapper with copy-to-clipboard button in the top-right corner */
function CodeBlockWithCopy({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = extractText(children);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  return (
    <div className="relative group mb-4">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 p-1.5 rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] border border-[var(--border-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
        title={copied ? t('Скопировано', 'Copied') : t('Скопировать', 'Copy')}
        aria-label={copied ? t('Скопировано', 'Copied') : t('Скопировать код', 'Copy code')}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre
        className="bg-[var(--bg-tertiary)] rounded-lg overflow-x-auto"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          whiteSpace: 'pre',
        }}
      >
        {children}
      </pre>
    </div>
  );
}

/** Clickable spoiler: hidden by default, revealed on click */
function SpoilerText({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [revealed, setRevealed] = useState(false);
  return (
    <button type="button" aria-expanded={revealed}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRevealed(prev => !prev); }}
      className={revealed
        ? 'bg-[var(--bg-tertiary)] rounded px-0.5 cursor-pointer transition-all'
        : 'bg-[var(--text-tertiary)] text-transparent rounded px-0.5 cursor-pointer select-none transition-all hover:opacity-80'}
      title={revealed ? t('Нажмите чтобы скрыть', 'Click to hide') : t('Нажмите чтобы раскрыть', 'Click to reveal')}
    >
      {children}
    </button>
  );
}

interface MarkdownPreviewProps {
  content: string;
  /** Rich external links in chat; document Markdown keeps ordinary links. */
  mediaLinks?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Variables to substitute in content. Use buildSystemVariables() or useSystemVariables() hook. */
  variables?: Record<string, string | number>;
  /** @deprecated Use variables={{ current_widget_id: `/widgets/${id}` }} instead */
  widgetId?: number;
  /** Callback for content changes (enables interactive checkboxes). Pass to make checkboxes clickable. */
  onContentChange?: (newContent: string) => void;
  /** Callback fired when a checkbox is clicked. Provides context (heading, line text, state). */
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  /** Current user info — attached to CheckboxClickInfo when a checkbox is toggled */
  currentUser?: CheckboxUser;
}

// Stable component types preserve text DOM nodes and browser selection across
// parent refreshes. Checkbox context keeps handlers current without remounting.
const CheckboxContext = createContext<{
  checkboxIndexRef: React.MutableRefObject<number>;
  isInteractive: boolean;
  handleCheckboxToggle: (index: number) => void;
}>({ checkboxIndexRef: { current: 0 }, isInteractive: false, handleCheckboxToggle: () => {} });
const MediaLinksContext = createContext(false);

const markdownComponents: Components = {
  // Custom heading styles - use em for scalability
  h1: ({ children }) => (
    <h1 className="font-bold text-[var(--text-primary)] border-b border-[var(--border-primary)] pb-2 mb-4" style={{ fontSize: '1.5em' }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-semibold text-[var(--text-primary)] border-b border-[var(--border-secondary)] pb-1 mb-3 mt-6" style={{ fontSize: '1.3em' }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="font-semibold text-[var(--text-primary)] mb-2 mt-4" style={{ fontSize: '1.15em' }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="font-semibold text-[var(--text-primary)] mb-2 mt-3" style={{ fontSize: '1.05em' }}>
      {children}
    </h4>
  ),

  // Paragraphs - inherit font size
  p: ({ children }) => (
    <p className="text-[var(--text-secondary)] mb-3 leading-relaxed" style={{ fontSize: '1em' }}>
      {children}
    </p>
  ),

  // Links - handle internal widget/table/space links + invocation pills
  a: function MarkdownLink({ href, children }) {
    const navigate = useNavigate();
    const mediaLinks = useContext(MediaLinksContext);
    const finalHref = href || '';

    // Invocation token pills (converted from <<@slug>> / <</slug>>)
    if (finalHref.startsWith('reference:')) {
      return <MentionPill slug={finalHref.slice(10)} reference />;
    }
    if (finalHref.startsWith('mention:')) {
      const slug = finalHref.slice(8);
      return <MentionPill slug={slug} />;
    }
    if (finalHref.startsWith('command:')) {
      const slug = finalHref.slice(8);
      return <CommandPill slug={slug} />;
    }

    // Spoiler text (converted from ||text||)
    if (finalHref.startsWith('spoiler:')) {
      return <SpoilerText>{children}</SpoilerText>;
    }

    // Internal links - use React Router navigation
    if (finalHref.startsWith('/widgets/') || finalHref.startsWith('/tables/') || finalHref.startsWith('/spaces/')) {
      return (
        <a
          href={finalHref}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            navigate(finalHref);
          }}
          className="text-[var(--color-primary-500)] hover:underline cursor-pointer"
        >
          {children}
        </a>
      );
    }

    // External links - open in new tab
    if (mediaLinks) return <SocialMediaLink href={finalHref}>{children}</SocialMediaLink>;
    return (
      <a
        href={finalHref}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-[var(--color-primary-500)] hover:underline"
      >
        {children}
      </a>
    );
  },

  // Lists - inherit font size
  ul: ({ children }) => (
    <ul className="list-disc list-inside text-[var(--text-secondary)] mb-3 space-y-1" style={{ fontSize: '1em' }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside text-[var(--text-secondary)] mb-3 space-y-1" style={{ fontSize: '1em' }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-[var(--text-secondary)]" style={{ fontSize: '1em' }}>
      {children}
    </li>
  ),

  // Code blocks - keep relative sizing
  code: ({ className: codeClassName, children, ...props }) => {
    const isInline = !codeClassName;
    const codeContent = String(children).replace(/\n$/, '');
    const lines = codeContent.split('\n');
    const hasMultipleLines = lines.length > 1;

    // Detect ASCII art/diagrams - box drawing characters
    const hasBoxChars = /[┌┐└┘│─├┤┬┴┼╭╮╰╯║═╔╗╚╝╠╣╦╩╬]/.test(codeContent);

    // Detect code-like patterns (JSON, objects, arrays, etc.)
    const looksLikeCode = (
      // JSON/object patterns
      /^\s*[[{]/.test(codeContent) ||
      // Key-value patterns (quotes with colons)
      /"[^"]+"\s*:/.test(codeContent) ||
      // Programming constructs
      /^(const|let|var|function|class|import|export|return|if|for|while)\s/.test(codeContent) ||
      // Has consistent indentation (2+ spaces at start of multiple lines)
      lines.filter(l => /^  +\S/.test(l)).length >= 2
    );

    // Detect table-like structures with pipes or dashes
    const hasTableChars = /[|+][-=]+[|+]/.test(codeContent) || /^\s*\|/.test(codeContent);

    const needsMonospace = hasBoxChars || looksLikeCode || hasTableChars || hasMultipleLines;

    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--color-primary-600)] font-mono break-all" style={{ fontSize: '0.9em' }}>
          {children}
        </code>
      );
    }

    // All code blocks get proper monospace treatment
    if (needsMonospace || !codeClassName) {
      return (
        <code
          className="block p-4 rounded-lg bg-[var(--bg-tertiary)] overflow-x-auto text-[var(--text-secondary)]"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
            whiteSpace: 'pre',
            lineHeight: 1.5,
            fontSize: '0.9em',
          }}
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <code
        className={`block p-4 rounded-lg bg-[var(--bg-tertiary)] font-mono overflow-x-auto ${codeClassName}`}
        style={{ whiteSpace: 'pre', fontSize: '0.9em' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <CodeBlockWithCopy>{children}</CodeBlockWithCopy>,

  // Tables - use em for font sizes
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4 max-w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
      <table
        className="border border-[var(--border-primary)] rounded-lg"
        style={{ fontSize: '1em', minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0 }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-[var(--bg-secondary)]">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th
      className="px-3 py-2 sm:px-4 text-left font-semibold text-[var(--text-primary)] border-b border-[var(--border-primary)]"
      style={{ fontSize: '1em', wordBreak: 'normal', overflowWrap: 'normal', whiteSpace: 'nowrap' }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      className="px-3 py-2 sm:px-4 text-[var(--text-secondary)] border-b border-[var(--border-secondary)] align-top"
      style={{ fontSize: '1em', wordBreak: 'normal', overflowWrap: 'normal' }}
    >
      {children}
    </td>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-[var(--bg-secondary)] transition-colors">
      {children}
    </tr>
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-[var(--color-primary-500)] pl-4 py-1 my-4 bg-[var(--bg-secondary)] rounded-r-lg">
      {children}
    </blockquote>
  ),

  // Horizontal rule
  hr: () => (
    <hr className="my-6 border-[var(--border-primary)]" />
  ),

  // Strong/Bold
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--text-primary)]">
      {children}
    </strong>
  ),

  // Emphasis/Italic
  em: ({ children }) => (
    <em className="italic text-[var(--text-secondary)]">
      {children}
    </em>
  ),

  // Strikethrough (GFM)
  del: ({ children }) => (
    <del className="line-through text-[var(--text-tertiary)]">
      {children}
    </del>
  ),

  // Images — wrapped in SafeChatImage to lazy-load, async-decode,
  // and gate oversized inline data: URLs behind a click-to-reveal
  // placeholder. Prevents a single multi-MB base64 image from
  // freezing chat scroll / streaming re-renders.
  img: ({ src, alt }) => (
    <SafeChatImage
      src={src}
      alt={alt}
      className="max-w-full h-auto rounded-lg shadow-sm my-4"
    />
  ),

  // Checkbox (GFM task lists) — interactive when onContentChange provided
  input: function MarkdownInput({ type, checked }) {
    const { checkboxIndexRef, isInteractive, handleCheckboxToggle } = useContext(CheckboxContext);
    if (type === 'checkbox') {
      const currentIndex = checkboxIndexRef.current++;

      return (
        <input
          type="checkbox"
          checked={checked}
          readOnly={!isInteractive}
          onChange={isInteractive ? () => handleCheckboxToggle(currentIndex) : undefined}
          onClick={isInteractive ? (e) => e.stopPropagation() : undefined}
          className={`mr-2 rounded border-[var(--border-primary)] ${
            isInteractive
              ? 'cursor-pointer hover:ring-2 hover:ring-[var(--color-primary-500)] hover:ring-offset-1 transition-shadow accent-[var(--color-primary-500)]'
              : ''
          }`}
          style={isInteractive ? { pointerEvents: 'auto' } : undefined}
        />
      );
    }
    return <input type={type} />;
  },
};

function MarkdownPreviewImpl({ content, mediaLinks = false, className = '', style, variables, widgetId, onContentChange, onCheckboxClick, currentUser }: MarkdownPreviewProps) {
  const { t } = useLanguage();
  const checkboxIndexRef = useRef(0);

  // Build combined variables (support legacy widgetId prop)
  const combinedVariables: Record<string, string | number> = { ...variables };
  if (widgetId && !combinedVariables.current_widget_id) {
    combinedVariables.current_widget_id = `/widgets/${widgetId}`;
  }

  // Substitute variables in content using centralized function
  // substituteAllVariables handles both {system_var} and $space_var syntax
  const afterVariables = Object.keys(combinedVariables).length > 0
    ? substituteAllVariables(content, combinedVariables)
    : content;

  // Normalize unicode/emoji checkboxes to GFM format for rendering
  const afterCheckboxes = normalizeCheckboxes(afterVariables);
  // Convert invocation tokens to markdown links for pill rendering
  const afterInvocations = convertInvocationTokensToLinks(afterCheckboxes);
  // Convert ||spoiler|| syntax to clickable spoiler links
  const processedContent = convertSpoilers(afterInvocations);

  // Reset checkbox counter before each render
  checkboxIndexRef.current = 0;

  // Handle checkbox click: toggle in original content and notify parent
  const handleCheckboxToggle = useCallback((index: number) => {
    if (!onContentChange && !onCheckboxClick) return;

    const normalized = normalizeCheckboxes(afterVariables);
    const context = getCheckboxContext(normalized, index);

    if (onContentChange) {
      // Work with the variable-substituted content (after variables, before normalization)
      const toggled = toggleCheckboxByIndex(normalized, index);
      // Convert back to original format if unicode symbols were used
      const result = denormalizeCheckboxes(toggled, content);
      onContentChange(result);
    }

    // Fire checkbox click event with context info
    if (onCheckboxClick) {
      // Determine new state: if it was unchecked before toggle, it's now checked
      const lines = normalized.split('\n');
      let currentIdx = 0;
      let wasChecked = false;
      for (const line of lines) {
        const match = line.match(/^\s*[-*+]\s+\[([ xX])\]/);
        if (match) {
          if (currentIdx === index) {
            wasChecked = match[1] !== ' ';
            break;
          }
          currentIdx++;
        }
      }

      onCheckboxClick({
        lineText: context.lineText,
        heading: context.heading,
        checked: !wasChecked, // After toggle
        index,
        user: currentUser,
      });
    }
  }, [onContentChange, onCheckboxClick, afterVariables, content, currentUser]);

  // Safety-net: catch clicks on <a href="mention:..."> or <a href="command:..."> that leak through
  // when React reconciliation fails to apply the custom `a` component
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('mention:')) {
      e.preventDefault();
      e.stopPropagation();
      const slug = href.slice(8);
      handlePillClickExternal(`<<@${slug}>>`, t);
    } else if (href.startsWith('command:')) {
      e.preventDefault();
      e.stopPropagation();
      const slug = href.slice(8);
      handlePillClickExternal(`<</${slug}>>`, t);
    }
  }, [t]);

  return (
    <div role="presentation"
      className={`markdown-preview prose max-w-none dark:prose-invert overflow-hidden break-words ${className}`}
      style={{ fontSize: 'inherit', textIndent: 0, wordBreak: 'break-word', overflowWrap: 'anywhere', ...style }}
      onClick={handleContainerClick}
    >
      <CheckboxContext.Provider value={{ checkboxIndexRef, isInteractive: !!(onContentChange || onCheckboxClick), handleCheckboxToggle }}>
      <MediaLinksContext.Provider value={mediaLinks}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => {
          // Allow custom protocols for invocation pills and spoilers
          if (url.startsWith('mention:') || url.startsWith('command:') || url.startsWith('spoiler:')) return url;
          // Default sanitization for all other URLs
          return url;
        }}
        components={markdownComponents}
      >
        {processedContent}
      </ReactMarkdown>
      </MediaLinksContext.Provider>
      </CheckboxContext.Provider>
    </div>
  );
}

// Memoized to avoid re-parsing markdown when a parent re-renders without
// changing relevant props. Re-parses are expensive for long messages that
// contain math, code blocks or lots of regex-eligible tokens (mentions,
// spoilers, checkboxes). Default referential comparator is correct: call
// sites must stabilize callback props (useCallback) for the memo to bite.
export const MarkdownPreview = memo(MarkdownPreviewImpl);

export default MarkdownPreview;
