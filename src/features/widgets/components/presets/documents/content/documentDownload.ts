/**
 * documentDownload — shared download-as-markdown helper.
 * Used by DocumentTile (grid) and DocumentRowAtom (chat) so both surfaces
 * produce identical .md output.
 */

import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

interface DownloadableDoc {
  name: string;
  description?: string;
  table_id?: number;
  content_table_id?: number;
}

export async function downloadDocumentAsMarkdown(
  doc: DownloadableDoc,
  language: string,
): Promise<void> {
  const tableId = doc.content_table_id || doc.table_id;
  if (!tableId) return;

  try {
    const response = await apiClient.get<{ data?: { rows?: Array<{ data?: Record<string, unknown> }> } }>(
      `/tables/${tableId}/rows?limit=5000`,
    );
    const rows = response.data?.rows || [];

    const sortedRows = [...rows].sort((a, b) => {
      const ao = (a.data as Record<string, unknown> | undefined)?.order;
      const bo = (b.data as Record<string, unknown> | undefined)?.order;
      return ((typeof ao === 'number' ? ao : 0)) - ((typeof bo === 'number' ? bo : 0));
    });

    const lines: string[] = [];
    lines.push(`# ${doc.name}`);
    if (doc.description) {
      lines.push('', doc.description);
    }
    lines.push('');

    sortedRows.forEach((row) => {
      const item = (row.data || {}) as Record<string, unknown>;
      const content = (
        item[`content_${language}`] ||
        item.content_en ||
        item.content_ru ||
        item.content ||
        ''
      ) as string;
      const level = item.level as string;

      if (level === 'h1') lines.push(`# ${content}`, '');
      else if (level === 'h2') lines.push(`## ${content}`, '');
      else if (level === 'h3') lines.push(`### ${content}`, '');
      else if (level === 'divider') lines.push('---', '');
      else if (content) lines.push(content, '');
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.name.replace(/[^a-zA-Z0-9а-яА-Я]/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    logger.error('Failed to export document:', error);
  }
}
