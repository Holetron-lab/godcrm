// Documents: Legacy v3 import/export routes (backward compatibility)
import express from 'express';
import {
  dbGet, dbRun, safeJsonParse,
  generateBaseId, apiLogger,
  success, created, error, badRequest, notFound,
  requireEditorAccess, buildDocumentStructure, slugify,
} from './_helpers.js';

const router = express.Router();

/** POST /api/v3/documents/import — Batch import document with atoms (sections) */
router.post('/documents/import', async (req, res) => {
  try {
    const { document, atoms, documents_table_id, sections_table_id } = req.body;
    const userId = req.user?.id;

    if (documents_table_id) {
      const legacyDocsTable = await dbGet('SELECT project_id FROM universal_tables WHERE id = ?', [documents_table_id]);
      if (legacyDocsTable?.project_id) {
        if (!(await requireEditorAccess(req, res, legacyDocsTable.project_id))) return;
      }
    }

    if (!document?.name) return badRequest(res, 'Document name is required');
    if (!documents_table_id || !sections_table_id) return badRequest(res, 'documents_table_id and sections_table_id are required');
    if (!atoms || !Array.isArray(atoms) || atoms.length === 0) return badRequest(res, 'At least one atom is required');

    const docsTable = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [documents_table_id]);
    const sectionsTable = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [sections_table_id]);
    if (!docsTable || !sectionsTable) return notFound(res, 'Documents or sections table not found');

    // STEP 1: Create atoms (sections)
    const createdSections = [];
    const tempIdToRealId = new Map();
    const h2Sections = [];

    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      const baseId = generateBaseId();
      const atomData = {
        type: atom.type || 'reference',
        key: atom.key || slugify(atom.title || `section-${i + 1}`),
        title: atom.title || `Section ${i + 1}`,
        content: atom.content || '',
        order_index: atom.order_index ?? (i + 1) * 10,
        local_order: atom.local_order ?? (i + 1),
        h2: atom.h2 || null, h3: atom.h3 || null,
        parent: null,
        http_method: atom.http_method || null,
        http_path: atom.http_path || null,
        tags: atom.tags || [],
        source_file: atom.source_file || null
      };

      const result = await dbRun(
        `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
        [sections_table_id, baseId, JSON.stringify(atomData), userId]
      );
      const sectionId = result.lastInsertRowid;
      createdSections.push({ id: sectionId, ...atomData });
      if (atom.temp_id) tempIdToRealId.set(atom.temp_id, sectionId);
      if (atom.h2 && !atom.h3) h2Sections.push({ id: sectionId, children: [], order: atomData.local_order });
    }

    // STEP 2: Update parent references
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      const section = createdSections[i];

      if (atom.parent_temp_id && tempIdToRealId.has(atom.parent_temp_id)) {
        const parentId = tempIdToRealId.get(atom.parent_temp_id);
        const existingRow = await dbGet('SELECT data FROM table_rows WHERE id = ?', [section.id]);
        if (existingRow) {
          const data = JSON.parse(existingRow.data);
          data.parent = parentId;
          await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(data), section.id]);
        }
        const parentH2 = h2Sections.find(h2 => h2.id === parentId);
        if (parentH2) parentH2.children.push({ id: section.id, order: atom.local_order ?? i });
      } else if (atom.parent_index !== undefined && atom.parent_index >= 0) {
        const parentSection = createdSections[atom.parent_index];
        if (parentSection) {
          const existingRow = await dbGet('SELECT data FROM table_rows WHERE id = ?', [section.id]);
          if (existingRow) {
            const data = JSON.parse(existingRow.data);
            data.parent = parentSection.id;
            await dbRun('UPDATE table_rows SET data = ? WHERE id = ?', [JSON.stringify(data), section.id]);
          }
          const parentH2 = h2Sections.find(h2 => h2.id === parentSection.id);
          if (parentH2) parentH2.children.push({ id: section.id, order: atom.local_order ?? i });
        }
      }
    }

    h2Sections.forEach(h2 => { h2.children.sort((a, b) => a.order - b.order); });

    // STEP 3: Build document structure
    const structure = buildDocumentStructure(h2Sections, document.name, document.description);

    // STEP 4: Create document
    const docBaseId = generateBaseId();
    const docData = {
      name: document.name, description: document.description || '',
      category: document.category || '', icon: document.icon || '📄',
      status: document.status || 'draft',
      sections: createdSections.map(s => s.id),
      structure: JSON.stringify(structure)
    };

    const docResult = await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by) VALUES (?, ?, ?, ?)`,
      [documents_table_id, docBaseId, JSON.stringify(docData), userId]
    );
    const documentId = docResult.lastInsertRowid;

    apiLogger.info(`[Documents] Imported document "${document.name}" with ${createdSections.length} sections`);
    created(res, {
      document_id: documentId,
      section_ids: createdSections.map(s => s.id),
      section_count: createdSections.length,
      structure
    });
  } catch (err) {
    apiLogger.error({ err }, 'POST /documents/import error:', err);
    error(res, 'IMPORT_DOCUMENT_ERROR', err.message, 500);
  }
});

/** GET /api/v3/documents/:documentId/export — Export document as Markdown or JSON */
router.get('/documents/:documentId/export', async (req, res) => {
  try {
    const { documentId } = req.params;
    const { documents_table_id, sections_table_id, format = 'markdown', lang } = req.query;
    if (!documents_table_id || !sections_table_id) return badRequest(res, 'documents_table_id and sections_table_id are required');

    const docRow = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [documentId, documents_table_id]);
    if (!docRow) return notFound(res, 'Document not found');

    const docData = safeJsonParse(docRow.data, {});

    // Parse sections array
    let sectionIds = [];
    if (typeof docData.sections === 'string') { try { sectionIds = JSON.parse(docData.sections); } catch { sectionIds = []; } }
    else if (Array.isArray(docData.sections)) { sectionIds = docData.sections; }

    let structure = null;
    if (docData.structure) { try { structure = safeJsonParse(docData.structure, null); } catch { structure = null; } }

    // If no sections but structure exists, extract IDs from structure
    if (sectionIds.length === 0 && structure?.sections) {
      for (const structSection of structure.sections) {
        const h2Id = structSection.section_id || structSection.id;
        if (h2Id) sectionIds.push(h2Id);
        if (structSection.children && Array.isArray(structSection.children)) {
          for (const child of structSection.children) {
            const childId = typeof child === 'object' ? (child.section_id || child.id) : child;
            if (childId) sectionIds.push(childId);
          }
        }
      }
    }

    // Fetch all sections
    const sections = [];
    for (const sectionId of sectionIds) {
      const numId = typeof sectionId === 'string' ? parseInt(sectionId, 10) : sectionId;
      if (isNaN(numId)) continue;
      const sectionRow = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [numId, sections_table_id]);
      if (sectionRow) sections.push({ id: sectionRow.id, ...safeJsonParse(sectionRow.data, {}) });
    }
    sections.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    const getLocalizedField = (section, field) => {
      if (lang) {
        const langSuffix = lang === 'ru' ? '_rus' : `_${lang}`;
        const val = section[`${field}${langSuffix}`];
        if (val && String(val).trim()) return val;
      }
      return section[field] || '';
    };

    // JSON FORMAT
    if (format === 'json') {
      return success(res, {
        document: { id: docRow.id, name: docData.name, description: docData.description, category: docData.category, icon: docData.icon, status: docData.status, structure },
        sections: sections.map(s => ({
          id: s.id, type: s.type, key: s.key, title: s.title,
          content: getLocalizedField(s, 'content'),
          h2: s.h2, h3: s.h3, local_order: s.local_order, order_index: s.order_index,
          parent: s.parent, http_method: s.http_method, http_path: s.http_path, tags: s.tags
        }))
      });
    }

    // MARKDOWN FORMAT
    let markdown = `# ${docData.icon || '📄'} ${docData.name || 'Untitled Document'}\n\n`;
    if (docData.description) markdown += `${docData.description}\n\n`;
    markdown += '---\n\n';

    const sectionMap = new Map(sections.map(s => [s.id, s]));
    const renderedIds = new Set();

    const renderSection = (section, level = 2) => {
      if (!section || renderedIds.has(section.id)) return '';
      renderedIds.add(section.id);
      let md = '';
      const headingPrefix = '#'.repeat(level);
      const title = section.title || section.key || 'Untitled';
      if (section.type === 'endpoint' && section.http_method) {
        md += `${headingPrefix} ${section.http_method} ${section.http_path || title}\n\n`;
      } else {
        md += `${headingPrefix} ${title}\n\n`;
      }
      const content = getLocalizedField(section, 'content');
      if (content) md += `${content}\n\n`;
      if (section.http_path && section.type === 'endpoint' && !section.http_method) md += `**Path:** \`${section.http_path}\`\n\n`;
      if (section.code) md += '```\n' + section.code + '\n```\n\n';
      if (section.tags && section.tags.length > 0) md += `**Tags:** ${section.tags.join(', ')}\n\n`;
      return md;
    };

    if (structure && structure.version === 2 && structure.sections) {
      for (const h2Struct of structure.sections) {
        const h2Id = h2Struct.section_id || h2Struct.id;
        const h2Section = sectionMap.get(h2Id);
        if (h2Section) {
          markdown += renderSection(h2Section, 2);
          if (h2Struct.children && h2Struct.children.length > 0) {
            for (const child of h2Struct.children) {
              const childId = typeof child === 'object' ? (child.section_id || child.id) : child;
              const childSection = sectionMap.get(childId);
              if (childSection) markdown += renderSection(childSection, 3);
            }
          }
          if (h2Struct.footer?.text) markdown += `> ${h2Struct.footer.text}\n\n`;
        }
      }
      if (structure.footer?.text) markdown += `---\n\n**${structure.footer.text}**\n\n`;
      if (structure.links && structure.links.length > 0) {
        for (const linkGroup of structure.links) {
          markdown += `### ${linkGroup.label}\n\n`;
          markdown += `_References: ${linkGroup.refs.join(', ')}_\n\n`;
        }
      }
    } else {
      for (const section of sections) {
        markdown += renderSection(section, section.h3 ? 3 : 2);
      }
    }

    const filename = slugify(docData.name || 'document') + '.md';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(markdown);
  } catch (err) {
    apiLogger.error({ err }, 'GET /documents/:id/export error:', err);
    error(res, 'EXPORT_DOCUMENT_ERROR', err.message, 500);
  }
});

export default router;
