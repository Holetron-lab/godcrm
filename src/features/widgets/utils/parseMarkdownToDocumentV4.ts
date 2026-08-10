/**
 * Markdown to Documents v4 Parser
 *
 * Level-based parsing for Documents v4 (h1/h2/h3/text/divider).
 * Extracted from parseMarkdownToAtoms.ts to keep files under the 800-line guard.
 */

import type { DocumentLevel, DocumentItemType, DocumentImportSection } from '../types/documents-v4.types';

// === TYPES ===

/**
 * Parsed section for v4 document structure
 */
export interface ParsedSectionV4 {
  order: number;
  level: DocumentLevel;
  title: string;
  content: string;
  type?: DocumentItemType;
  http_method?: string;
  http_path?: string;
  selected?: boolean;  // For import UI (default: true)
}

/**
 * Parse result for v4 documents
 */
export interface ParsedDocumentV4 {
  title: string;
  description: string;
  sections: ParsedSectionV4[];
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

// === HELPERS ===

/**
 * Convert heading level number to DocumentLevel
 */
function toDocumentLevel(level: number): DocumentLevel {
  switch (level) {
    case 1: return 'h1';
    case 2: return 'h2';
    case 3: return 'h3';
    default: return 'text';
  }
}

/**
 * Detect section type from title and content for v4
 */
function detectSectionTypeV4(title: string, content: string, _level: DocumentLevel): DocumentItemType {
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  // Endpoint detection (HTTP method in title)
  if (/^(GET|POST|PUT|PATCH|DELETE)\s+/i.test(title)) {
    return 'endpoint';
  }

  // Component detection
  if (titleLower.includes('component') || /<[A-Z][a-zA-Z]+/.test(content)) {
    return 'component';
  }

  // Hook detection
  if (titleLower.startsWith('use') || /use[A-Z]\w+/.test(content)) {
    return 'hook';
  }

  // Store detection
  if (titleLower.includes('store') || contentLower.includes('zustand')) {
    return 'store';
  }

  // Howto/guide detection
  if (titleLower.includes('how') || titleLower.includes('guide') || titleLower.includes('tutorial')) {
    return 'howto';
  }

  // Code example detection (multiple code blocks)
  if (content.match(/```[\s\S]+```/) && content.split('```').length > 4) {
    return 'code';
  }

  // Concept for longer content
  if (content.length > 500) {
    return 'concept';
  }

  return 'reference';
}

/**
 * Extract HTTP method and path from title for v4
 */
function extractHttpInfoV4(title: string): { method?: string; path?: string } {
  const match = title.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)/i);
  if (match) {
    return {
      method: match[1].toUpperCase(),
      path: match[2].replace(/`/g, '').trim()
    };
  }
  return {};
}

// === MAIN PARSER ===

/**
 * Parse markdown into v4 document sections
 * Uses level-based structure (h1, h2, h3, text, divider)
 *
 * @param markdown - Markdown content
 * @param options - Parse options
 * @returns ParsedDocumentV4
 */
export function parseMarkdownToDocumentV4(
  markdown: string,
  options: { sourceFile?: string } = {}
): ParsedDocumentV4 {
  const content = markdown.replace(/\r\n/g, '\n').trim();
  const lines = content.split('\n');

  // Extract document title from first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  const documentTitle = h1Match
    ? h1Match[1].trim()
    : (options.sourceFile?.replace(/\.md$/i, '') || 'Untitled Document');

  // Extract description (text between H1 and first H2, or first paragraph)
  let description = '';
  const h1Index = content.indexOf('# ');
  const h2Index = content.indexOf('\n## ');
  if (h1Index !== -1 && h2Index !== -1 && h2Index > h1Index) {
    const afterH1 = content.substring(content.indexOf('\n', h1Index) + 1, h2Index);
    description = afterH1.trim().split('\n').slice(0, 3).join(' ').trim();
  } else if (h1Index === -1) {
    // No H1 - use first non-empty line as description
    const firstParagraph = lines.find(l => l.trim() && !l.startsWith('#'));
    if (firstParagraph) {
      description = firstParagraph.slice(0, 200);
    }
  }

  const sections: ParsedSectionV4[] = [];
  let currentTitle = '';
  let currentLevel: DocumentLevel = 'text';
  let currentContent: string[] = [];
  let orderIndex = 0;
  let inSection = false;
  let hasAnyHeader = false;

  const finalizeSection = () => {
    if (!inSection) return;

    const trimmedContent = currentContent.join('\n').trim();

    // Skip H1 as it's the document title (but only if it's the first H1)
    if (currentLevel === 'h1' && sections.length === 0) {
      // First H1 is document title, skip it
      currentTitle = '';
      currentContent = [];
      inSection = false;
      return;
    }

    // For headers (h2, h3), create header element + separate text element for content
    if (currentLevel === 'h2' || currentLevel === 'h3') {
      // Add the header itself - header text goes in content field
      if (currentTitle) {
        orderIndex += 10;
        const type = detectSectionTypeV4(currentTitle, trimmedContent, currentLevel);
        const httpInfo = type === 'endpoint' ? extractHttpInfoV4(currentTitle) : {};

        sections.push({
          order: orderIndex,
          level: currentLevel,
          title: '', // Deprecated - we use content for all levels
          content: currentTitle, // Header text goes in content
          type,
          selected: true,
          ...(httpInfo.method && { http_method: httpInfo.method }),
          ...(httpInfo.path && { http_path: httpInfo.path }),
        });
      }

      // Add content as separate text element if present
      if (trimmedContent) {
        orderIndex += 10;
        sections.push({
          order: orderIndex,
          level: 'text',
          title: '',
          content: trimmedContent,
          type: 'section',
          selected: true,
        });
      }
    } else {
      // For text level, just add as is
      if (currentTitle || trimmedContent) {
        orderIndex += 10;

        const type = detectSectionTypeV4(currentTitle, trimmedContent, currentLevel);
        const httpInfo = type === 'endpoint' ? extractHttpInfoV4(currentTitle) : {};

        sections.push({
          order: orderIndex,
          level: currentLevel,
          title: '', // Deprecated
          content: currentTitle || trimmedContent, // Use content for everything
          type,
          ...(httpInfo.method && { http_method: httpInfo.method }),
          ...(httpInfo.path && { http_path: httpInfo.path }),
        });
      }
    }

    currentTitle = '';
    currentContent = [];
    inSection = false;
  };

  for (const line of lines) {
    // Check for headers (up to H3)
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headerMatch) {
      finalizeSection();
      hasAnyHeader = true;

      currentLevel = toDocumentLevel(headerMatch[1].length);
      currentTitle = headerMatch[2].trim();
      inSection = true;
    } else if (line.startsWith('---') && line.replace(/-/g, '').trim() === '') {
      // Horizontal rule as divider
      if (inSection) {
        finalizeSection();
      }
      orderIndex += 10;
      sections.push({
        order: orderIndex,
        level: 'divider',
        title: '— Разделитель —',
        content: '',
        selected: true,
      });
    } else {
      // If no section started yet and we have content, start a text section
      if (!inSection && line.trim()) {
        inSection = true;
        currentLevel = 'text';
        currentTitle = '';
      }
      if (inSection) {
        currentContent.push(line);
      }
    }
  }

  // Don't forget last section
  finalizeSection();

  // If no headers found, treat entire content as one text section
  if (!hasAnyHeader && sections.length === 0 && content.trim()) {
    sections.push({
      order: 10,
      level: 'text',
      title: documentTitle,
      content: content,
      type: 'section',
      selected: true,
    });
  }

  // Validation
  const errors: string[] = [];
  const warnings: string[] = [];

  const h2Count = sections.filter(s => s.level === 'h2').length;
  const h3Count = sections.filter(s => s.level === 'h3').length;

  if (h2Count === 0 && h3Count === 0) {
    warnings.push('No H2 or H3 headings found - document structure may be flat');
  }

  sections.forEach((section, i) => {
    if (section.level !== 'divider' && !section.title) {
      warnings.push(`Section ${i + 1}: Missing title`);
    }
    // Note: short content is fine, don't warn about it
  });

  return {
    title: documentTitle,
    description,
    sections,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

/**
 * Convert v4 sections to import format
 */
export function sectionsToImportFormat(sections: ParsedSectionV4[]): DocumentImportSection[] {
  return sections.map(section => ({
    order: section.order,
    level: section.level,
    title: section.title,
    content: section.content,
    type: section.type,
    http_method: section.http_method,
    http_path: section.http_path,
  }));
}

/**
 * Build preview tree from v4 sections
 * Useful for import UI
 */
export interface SectionTreeNodeV4 {
  section: ParsedSectionV4;
  children: SectionTreeNodeV4[];
  selected: boolean;
  expanded: boolean;
}

export function buildSectionTreeV4(sections: ParsedSectionV4[]): SectionTreeNodeV4[] {
  const nodes: SectionTreeNodeV4[] = [];
  let currentH1: SectionTreeNodeV4 | null = null;
  let currentH2: SectionTreeNodeV4 | null = null;

  for (const section of sections) {
    const node: SectionTreeNodeV4 = {
      section,
      children: [],
      selected: true,
      expanded: true,
    };

    switch (section.level) {
      case 'h1':
        nodes.push(node);
        currentH1 = node;
        currentH2 = null;
        break;
      case 'h2':
        if (currentH1) {
          currentH1.children.push(node);
        } else {
          nodes.push(node);
        }
        currentH2 = node;
        break;
      case 'h3':
      case 'text':
        if (currentH2) {
          currentH2.children.push(node);
        } else if (currentH1) {
          currentH1.children.push(node);
        } else {
          nodes.push(node);
        }
        break;
      case 'divider':
        // Dividers go at current level
        if (currentH2) {
          currentH2.children.push(node);
        } else if (currentH1) {
          currentH1.children.push(node);
        } else {
          nodes.push(node);
        }
        break;
      default:
        nodes.push(node);
    }
  }

  return nodes;
}

/**
 * Flatten selected nodes from tree
 */
export function flattenSectionTreeV4(nodes: SectionTreeNodeV4[]): ParsedSectionV4[] {
  const result: ParsedSectionV4[] = [];

  const traverse = (nodeList: SectionTreeNodeV4[]) => {
    for (const node of nodeList) {
      if (node.selected) {
        result.push(node.section);
        traverse(node.children);
      }
    }
  };

  traverse(nodes);

  // Re-calculate order indices
  let order = 0;
  return result.map(section => ({
    ...section,
    order: (order += 10),
  }));
}
