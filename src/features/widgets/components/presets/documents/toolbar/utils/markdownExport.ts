import type { DocumentRegistryItem, DocumentItem } from '../../../../../types/documents.types';

function buildMarkdown(doc: DocumentRegistryItem, items: DocumentItem[]): string {
  const lines: string[] = [];
  lines.push(`# ${doc.name}`);
  if (doc.description) {
    lines.push('', doc.description);
  }
  lines.push('');

  items.forEach(item => {
    if (item.level === 'h1') lines.push(`# ${item.content || ''}`, '');
    else if (item.level === 'h2') lines.push(`## ${item.content || ''}`, '');
    else if (item.level === 'h3') lines.push(`### ${item.content || ''}`, '');
    else if (item.level === 'divider') lines.push('---', '');
    else lines.push(item.content || '', '');
  });

  return lines.join('\n');
}

export async function copyDocumentAsMarkdown(
  doc: DocumentRegistryItem,
  items: DocumentItem[],
  setCopied: (copied: boolean) => void,
) {
  if (!doc || items.length === 0) return;

  const md = buildMarkdown(doc, items);
  await navigator.clipboard.writeText(md);
  setCopied(true);
  setTimeout(() => setCopied(false), 2000);
}

export function exportDocumentAsMarkdown(doc: DocumentRegistryItem, items: DocumentItem[]) {
  if (!doc || items.length === 0) return;

  const md = buildMarkdown(doc, items);
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name.replace(/[^a-zA-Z0-9а-яА-Я]/g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
