/**
 * Markdown to Atoms Parser v2
 * 
 * Parses markdown content into hierarchical documentation sections
 * with H2 → H3 structure support for Document Sections table (ID: 1657)
 * 
 * @see TASK-007-DOCUMENTS-V3.md
 * @see ADR-006-DOCUMENTS-MODULE.md
 */

// === TYPE DEFINITIONS ===

export type AtomType = 'reference' | 'endpoint' | 'concept' | 'howto' | 'code' | 'column-type' | 'component' | 'hook' | 'store' | 'heading' | 'subheading';
export type HeadingLevel = 'h1' | 'h2' | 'h3';

export interface ParsedAtom {
  type: AtomType;
  key: string;
  title: string;
  content: string;
  order_index: number;
  
  // v2: Hierarchical structure
  heading_level: HeadingLevel;
  local_order: number;
  temp_id: string;
  parent_temp_id?: string;
  
  // Legacy parent support
  parent?: string | number | null;
  
  // Endpoint fields
  http_method?: string;
  http_path?: string;
  
  // Additional fields
  code?: string;
  tags?: string[];
  source_file?: string;
}

export interface FooterBlock {
  text: string;
  refs: number[];
  type?: 'atoms' | 'documents';
}

export interface LinkGroup {
  label: string;
  refs: number[];
  type?: 'atoms' | 'documents';
}

export interface SectionStructure {
  temp_id: string;
  order: number;
  children_temp_ids: string[];
  footer?: FooterBlock | null;
  collapsed?: boolean;
}

export interface DocumentStructure {
  version: 2;
  title: string;
  description?: string;
  sections: SectionStructure[];
  footer?: FooterBlock | null;
  links?: LinkGroup[];
}

export interface ParsedDocument {
  title: string;
  description: string;
  atoms: ParsedAtom[];
  structure: DocumentStructure;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

export interface ParseOptions {
  /** Split on H2/H3 (default: 3 for full hierarchy) */
  splitLevel?: 2 | 3;
  /** Default type for atoms without detected type */
  defaultType?: AtomType;
  /** Auto-detect endpoint patterns */
  detectEndpoints?: boolean;
  /** Source file path for tracking */
  sourceFile?: string;
  /** Parent key for all atoms (legacy) */
  parentKey?: string;
  /** Build hierarchical structure (default: true) */
  buildHierarchy?: boolean;
}

// === CONSTANTS ===

// HTTP method regex for endpoint detection
const HTTP_METHOD_REGEX = /^(GET|POST|PUT|PATCH|DELETE)\s+(`)?([^\s`]+)/;
const HTTP_PATH_IN_HEADER = /^(GET|POST|PUT|PATCH|DELETE)\s+/i;

// === HELPER FUNCTIONS ===

/**
 * Generate URL-friendly key from title
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim() || 'section';
}

/**
 * Generate unique temp_id
 */
function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect atom type from content
 */
function detectAtomType(title: string, content: string, headerLevel?: number): AtomType {
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();
  const trimmedContent = content.trim();

  // Empty content → heading or subheading based on level
  if (!trimmedContent || trimmedContent.length === 0) {
    if (headerLevel === 1 || headerLevel === 2) {
      return 'heading';
    }
    return 'subheading';
  }

  // Endpoint detection
  if (HTTP_PATH_IN_HEADER.test(title) || HTTP_METHOD_REGEX.test(content)) {
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

  // Howto detection
  if (titleLower.includes('how') || titleLower.includes('guide') || titleLower.includes('tutorial')) {
    return 'howto';
  }

  // Code example detection
  if (content.match(/```[\s\S]+```/) && content.split('```').length > 4) {
    return 'code';
  }

  // Column type detection
  if (titleLower.includes('column') && titleLower.includes('type')) {
    return 'column-type';
  }

  // Reference (category/section)
  if (contentLower.includes('## ') || content.length < 200) {
    return 'reference';
  }

  return 'concept';
}

/**
 * Extract HTTP method and path from content
 */
function extractEndpointInfo(title: string, content: string): { method?: string; path?: string } {
  // Check title first
  const titleMatch = title.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)/i);
  if (titleMatch) {
    return {
      method: titleMatch[1].toUpperCase(),
      path: titleMatch[2].replace(/`/g, '').trim()
    };
  }

  // Check content
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(HTTP_METHOD_REGEX);
    if (match) {
      return {
        method: match[1].toUpperCase(),
        path: match[3].replace(/`/g, '').trim()
      };
    }
  }

  return {};
}

/**
 * Extract first code block from content
 */
function extractCodeBlock(content: string): string | undefined {
  const match = content.match(/```\w*\n([\s\S]*?)```/);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract tags from content (hashtags or inline badges)
 */
function extractTags(content: string): string[] {
  const tags: string[] = [];
  
  // Find hashtags
  const hashTags = content.match(/#([a-zA-Z]\w+)/g);
  if (hashTags) {
    tags.push(...hashTags.map(t => t.slice(1)));
  }

  // Find badge-style tags [tag]
  const badgeTags = content.match(/\[([a-zA-Z]\w+)\]/g);
  if (badgeTags) {
    tags.push(...badgeTags.map(t => t.slice(1, -1)));
  }

  return [...new Set(tags)].slice(0, 10); // Unique, max 10
}

/**
 * Convert header level number to HeadingLevel type
 */
function toHeadingLevel(level: number): HeadingLevel {
  if (level === 1) return 'h1';
  if (level === 2) return 'h2';
  return 'h3';
}

// === SECTION PARSING ===

interface RawSection {
  title: string;
  content: string;
  level: number;
  lineNumber: number;
}

/**
 * Split markdown into raw sections by headers (up to H3)
 */
function splitByHeaders(markdown: string): RawSection[] {
  const sections: RawSection[] = [];
  const lines = markdown.split('\n');
  
  let currentTitle = '';
  let currentLevel = 0;
  let currentContent: string[] = [];
  let currentLineNumber = 0;
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    
    if (headerMatch) {
      const headerLevel = headerMatch[1].length;
      const headerTitle = headerMatch[2].trim();
      
      // Save previous section
      if (inSection && currentTitle) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n').trim(),
          level: currentLevel,
          lineNumber: currentLineNumber
        });
      }
      
      currentTitle = headerTitle;
      currentLevel = headerLevel;
      currentContent = [];
      currentLineNumber = i + 1;
      inSection = true;
    } else {
      currentContent.push(line);
    }
  }

  // Don't forget last section
  if (inSection && currentTitle) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n').trim(),
      level: currentLevel,
      lineNumber: currentLineNumber
    });
  }

  return sections;
}

// === MAIN PARSER ===

/**
 * Parse markdown into hierarchical document structure
 * Returns ParsedDocument with atoms and structure
 */
export function parseMarkdownToDocument(
  markdown: string,
  options: ParseOptions = {}
): ParsedDocument {
  const {
    defaultType = 'concept',
    detectEndpoints = true,
    sourceFile,
    buildHierarchy = true
  } = options;

  // Normalize line endings
  const content = markdown.replace(/\r\n/g, '\n').trim();
  
  // Extract document title from first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  const documentTitle = h1Match ? h1Match[1].trim() : (sourceFile?.replace(/\.md$/i, '') || 'Untitled Document');
  
  // Extract description (text between H1 and first H2)
  let description = '';
  const h1Index = content.indexOf('# ');
  const h2Index = content.indexOf('\n## ');
  if (h1Index !== -1 && h2Index !== -1 && h2Index > h1Index) {
    const afterH1 = content.substring(content.indexOf('\n', h1Index) + 1, h2Index);
    description = afterH1.trim().split('\n').slice(0, 3).join(' ').trim();
  }
  
  // Split by headers
  const rawSections = splitByHeaders(content);
  
  // Track H2 sections for hierarchy
  const h2Stack: { tempId: string; level: number }[] = [];
  const atoms: ParsedAtom[] = [];
  const structureSections: SectionStructure[] = [];
  
  let globalOrderIndex = 0;
  let h2Order = 0;
  const h2LocalOrders: Map<string, number> = new Map(); // H2 temp_id -> current child order

  for (const section of rawSections) {
    globalOrderIndex++;
    const tempId = generateTempId();
    const key = slugify(section.title);
    const headingLevel = toHeadingLevel(section.level);
    
    // Detect type
    let type: AtomType = defaultType;
    if (detectEndpoints) {
      type = detectAtomType(section.title, section.content, section.level);
    }
    
    // Extract endpoint info
    let httpMethod: string | undefined;
    let httpPath: string | undefined;
    if (type === 'endpoint') {
      const endpointInfo = extractEndpointInfo(section.title, section.content);
      httpMethod = endpointInfo.method;
      httpPath = endpointInfo.path;
    }
    
    // Determine parent for H3
    let parentTempId: string | undefined;
    let localOrder = 1;
    
    if (buildHierarchy) {
      if (section.level === 2) {
        // H2: top-level section
        h2Order++;
        localOrder = h2Order;
        h2Stack.push({ tempId, level: section.level });
        h2LocalOrders.set(tempId, 0);
        
        // Add to structure
        structureSections.push({
          temp_id: tempId,
          order: h2Order,
          children_temp_ids: [],
          footer: null,
          collapsed: false
        });
      } else if (section.level === 3) {
        // H3: child of last H2
        const parentH2 = h2Stack.filter(h => h.level === 2).pop();
        if (parentH2) {
          parentTempId = parentH2.tempId;
          
          // Increment local order for this parent
          const currentOrder = h2LocalOrders.get(parentH2.tempId) || 0;
          localOrder = currentOrder + 1;
          h2LocalOrders.set(parentH2.tempId, localOrder);
          
          // Add to structure children
          const structureSection = structureSections.find(s => s.temp_id === parentH2.tempId);
          if (structureSection) {
            structureSection.children_temp_ids.push(tempId);
          }
        }
      } else if (section.level === 1) {
        // H1: document title, skip or treat as description
        localOrder = 0;
      }
    }
    
    // Build atom
    const atom: ParsedAtom = {
      type,
      key,
      title: section.title,
      content: section.content,
      order_index: globalOrderIndex * 10,
      heading_level: headingLevel,
      local_order: localOrder,
      temp_id: tempId,
      tags: extractTags(section.content)
    };
    
    // Parent reference
    if (parentTempId) {
      atom.parent_temp_id = parentTempId;
    }
    
    // Endpoint fields
    if (httpMethod) atom.http_method = httpMethod;
    if (httpPath) atom.http_path = httpPath;
    
    // Code block
    const code = extractCodeBlock(section.content);
    if (code && code.length > 20) {
      atom.code = code;
    }
    
    // Source file
    if (sourceFile) {
      atom.source_file = sourceFile;
    }
    
    atoms.push(atom);
  }
  
  // Build document structure
  const structure: DocumentStructure = {
    version: 2,
    title: documentTitle,
    description: description,
    sections: structureSections,
    footer: null,
    links: []
  };
  
  // Validate
  const validation = validateAtoms(atoms);
  
  return {
    title: documentTitle,
    description,
    atoms,
    structure,
    validation
  };
}

/**
 * Legacy: Parse markdown to flat atoms array
 * For backwards compatibility
 */
export function parseMarkdownToAtoms(
  markdown: string,
  options: ParseOptions = {}
): ParsedAtom[] {
  const doc = parseMarkdownToDocument(markdown, {
    ...options,
    buildHierarchy: false
  });
  return doc.atoms;
}

/**
 * Parse markdown file and return preview structure
 */
export function parseMarkdownPreview(
  markdown: string,
  filename?: string
): {
  title: string;
  description: string;
  atomCount: number;
  h2Count: number;
  h3Count: number;
  atoms: Array<{
    type: string;
    title: string;
    heading_level: HeadingLevel;
    hasCode: boolean;
    hasChildren: boolean;
  }>;
  structure: DocumentStructure;
} {
  const doc = parseMarkdownToDocument(markdown, {
    sourceFile: filename,
    buildHierarchy: true
  });

  // Count H2/H3
  const h2Count = doc.atoms.filter(a => a.heading_level === 'h2').length;
  const h3Count = doc.atoms.filter(a => a.heading_level === 'h3').length;
  
  // Build children map
  const childrenMap = new Map<string, string[]>();
  for (const section of doc.structure.sections) {
    childrenMap.set(section.temp_id, section.children_temp_ids);
  }

  return {
    title: doc.title,
    description: doc.description,
    atomCount: doc.atoms.length,
    h2Count,
    h3Count,
    atoms: doc.atoms.map(a => ({
      type: a.type,
      title: a.title,
      heading_level: a.heading_level,
      hasCode: !!a.code,
      hasChildren: (childrenMap.get(a.temp_id)?.length || 0) > 0
    })),
    structure: doc.structure
  };
}

/**
 * Validate parsed atoms
 */
export function validateAtoms(atoms: ParsedAtom[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const keys = new Set<string>();

  atoms.forEach((atom, index) => {
    // Check required fields
    if (!atom.title) {
      errors.push(`Atom ${index + 1}: Missing title`);
    }
    
    if (!atom.key) {
      errors.push(`Atom ${index + 1}: Missing key`);
    }

    // Check for duplicate keys
    if (keys.has(atom.key)) {
      warnings.push(`Atom ${index + 1}: Duplicate key "${atom.key}" - will be auto-suffixed`);
    }
    keys.add(atom.key);

    // Check content
    if (!atom.content || atom.content.length < 10) {
      warnings.push(`Atom "${atom.title}": Very short content (${atom.content?.length || 0} chars)`);
    }

    // Validate endpoint has path
    if (atom.type === 'endpoint' && !atom.http_path) {
      warnings.push(`Endpoint "${atom.title}": Missing HTTP path`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Build tree structure from flat atoms for UI rendering
 */
export interface AtomTreeNode {
  atom: ParsedAtom;
  children: AtomTreeNode[];
  selected: boolean;
  expanded: boolean;
}

export function buildAtomTree(atoms: ParsedAtom[]): AtomTreeNode[] {
  const nodes: AtomTreeNode[] = [];
  const nodeMap = new Map<string, AtomTreeNode>();
  
  // Create nodes
  for (const atom of atoms) {
    const node: AtomTreeNode = {
      atom,
      children: [],
      selected: true,
      expanded: true
    };
    nodeMap.set(atom.temp_id, node);
  }
  
  // Build hierarchy
  for (const atom of atoms) {
    const node = nodeMap.get(atom.temp_id);
    if (!node) continue;
    
    if (atom.parent_temp_id && nodeMap.has(atom.parent_temp_id)) {
      const parentNode = nodeMap.get(atom.parent_temp_id)!;
      parentNode.children.push(node);
    } else if (atom.heading_level !== 'h3') {
      // Root level (H1, H2)
      nodes.push(node);
    }
  }
  
  // Sort children by local_order
  const sortChildren = (nodeList: AtomTreeNode[]) => {
    nodeList.sort((a, b) => (a.atom.local_order || 0) - (b.atom.local_order || 0));
    nodeList.forEach(n => sortChildren(n.children));
  };
  sortChildren(nodes);
  
  return nodes;
}

/**
 * Flatten tree back to atoms array (for import)
 * Only includes selected nodes
 */
export function flattenAtomTree(nodes: AtomTreeNode[]): ParsedAtom[] {
  const result: ParsedAtom[] = [];
  
  const traverse = (nodeList: AtomTreeNode[]) => {
    for (const node of nodeList) {
      if (node.selected) {
        result.push(node.atom);
        traverse(node.children);
      }
    }
  };
  
  traverse(nodes);
  return result;
}

/**
 * Generate unique keys for atoms with duplicates
 */
export function deduplicateKeys(atoms: ParsedAtom[]): ParsedAtom[] {
  const keyCount = new Map<string, number>();
  
  return atoms.map(atom => {
    const baseKey = atom.key;
    const count = keyCount.get(baseKey) || 0;
    keyCount.set(baseKey, count + 1);
    
    if (count > 0) {
      return { ...atom, key: `${baseKey}-${count}` };
    }
    return atom;
  });
}

// === DOCUMENTS v4: Level-based parsing ===
// Extracted to ./parseMarkdownToDocumentV4.ts — re-exported here for backwards
// compatibility with existing import paths.
export {
  parseMarkdownToDocumentV4,
  sectionsToImportFormat,
  buildSectionTreeV4,
  flattenSectionTreeV4,
} from './parseMarkdownToDocumentV4';
export type {
  ParsedSectionV4,
  ParsedDocumentV4,
  SectionTreeNodeV4,
} from './parseMarkdownToDocumentV4';
