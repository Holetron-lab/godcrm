import type { DocumentRegistryItem, DocumentItem } from '../../../../../types/documents.types';

type PrintDocumentInput = {
  document: DocumentRegistryItem;
  items: DocumentItem[];
  contentScale: number;
};

const escapeHtml = (str: string) => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const mdToHtml = (md: string) => {
  let html = md;

  // Code blocks (```...```)
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre class="code-block"><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered lists - match consecutive list items and wrap in ul
  html = html.replace(/(^- .+$(\n|$))+/gm, (match) => {
    const items = match.trim().split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => `<li>${line.substring(2)}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  });

  // Ordered lists - match consecutive numbered items and wrap in ol
  html = html.replace(/(^\d+\. .+$(\n|$))+/gm, (match) => {
    const items = match.trim().split('\n')
      .filter(line => /^\d+\. /.test(line))
      .map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `<ol>${items}</ol>`;
  });

  // Tables - proper parsing with <table> wrapper
  const lines = html.split('\n');
  const resultLines: string[] = [];
  let inTable = false;
  let isFirstRow = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if line is a table row (starts and ends with |, or has | inside)
    const isTableRow = /^\|.*\|$/.test(line);
    // Check if line is separator row (only dashes, colons, pipes, spaces)
    const isSeparatorRow = /^\|[\s\-:|]+\|$/.test(line) && line.includes('-');

    if (isTableRow) {
      if (!inTable) {
        // Start new table
        inTable = true;
        isFirstRow = true;
        resultLines.push('<table>');
      }

      if (isSeparatorRow) {
        // Skip separator row but note we've passed header
        isFirstRow = false;
        continue;
      }

      // Parse cells
      const cells = line.split('|').slice(1, -1); // Remove first/last empty items from split
      const cellTag = isFirstRow ? 'th' : 'td';
      const rowHtml = '<tr>' + cells.map(c => `<${cellTag}>${c.trim()}</${cellTag}>`).join('') + '</tr>';

      if (isFirstRow) {
        resultLines.push('<thead>' + rowHtml + '</thead>');
        resultLines.push('<tbody>');
      } else {
        resultLines.push(rowHtml);
      }
    } else {
      if (inTable) {
        // End table
        resultLines.push('</tbody></table>');
        inTable = false;
        isFirstRow = true;
      }
      resultLines.push(line);
    }
  }

  // Close table if still open
  if (inTable) {
    resultLines.push('</tbody></table>');
  }

  html = resultLines.join('\n');

  // Split by double newlines to create paragraphs, but don't wrap tables
  const blocks = html.split(/\n\n+/);
  html = blocks.map(block => {
    const trimmed = block.trim();
    // Don't wrap tables, lists, or code blocks in <p>
    if (trimmed.startsWith('<table') || trimmed.startsWith('<ul') ||
        trimmed.startsWith('<ol') || trimmed.startsWith('<pre')) {
      return trimmed;
    }
    // Wrap text content in <p>, convert single newlines to <br>
    if (trimmed) {
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }
    return '';
  }).filter(Boolean).join('\n');

  return html;
};

export function printDocument({ document: doc, items, contentScale }: PrintDocumentInput) {
  if (!doc || items.length === 0) return;

  let contentHtml = '';
  items.forEach(item => {
    if (item.is_hidden) return;

    if (item.level === 'h1') {
      contentHtml += `<h1 class="section-header">${escapeHtml(item.content || '')}</h1>`;
    } else if (item.level === 'h2') {
      contentHtml += `<h2 class="section-header">${escapeHtml(item.content || '')}</h2>`;
    } else if (item.level === 'h3') {
      contentHtml += `<h3 class="section-header">${escapeHtml(item.content || '')}</h3>`;
    } else if (item.level === 'divider') {
      contentHtml += '<hr class="divider">';
    } else if (item.level === 'image') {
      // Render image - extract URL from content (markdown or plain URL)
      const content = item.content || '';
      const urlMatch = content.match(/!\[.*?\]\((.+?)\)/) || content.match(/(https?:\/\/[^\s]+)/i);
      const imageUrl = urlMatch ? urlMatch[1] : content;
      if (imageUrl && imageUrl.startsWith('http')) {
        contentHtml += `<div class="image-block"><img src="${escapeHtml(imageUrl)}" alt="Image" class="print-image" /></div>`;
      } else {
        contentHtml += `<div class="text-block">${mdToHtml(content)}</div>`;
      }
    } else {
      contentHtml += `<div class="text-block">${mdToHtml(item.content || '')}</div>`;
    }
  });

  const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(doc.name)}</title>
  <style>
    /* A4 Page Setup */
    @page {
      size: A4 portrait;
      margin: 20mm 18mm 25mm 18mm;
    }

    /* Reset */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Body - font size affected by contentScale */
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif;
      font-size: ${11 * (contentScale / 100)}pt;
      line-height: 1.6;
      color: #1a1a1a;
      background: white;
    }

    /* Document Header */
    .document-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #333;
    }
    .document-icon {
      font-size: 32pt;
      line-height: 1;
    }
    .document-title {
      font-size: 20pt;
      font-weight: 700;
      margin: 0 0 4px 0;
      color: #111;
    }
    .document-desc {
      font-size: 10pt;
      color: #555;
      margin: 0;
    }
    .document-meta {
      font-size: 8pt;
      color: #888;
      margin-top: 8px;
    }

    /* Section Headers - avoid page break after */
    .section-header {
      page-break-after: avoid;
      break-after: avoid;
    }

    h1.section-header {
      font-size: ${16 * (contentScale / 100)}pt;
      font-weight: 700;
      margin: 28px 0 14px 0;
      color: #111;
      border-bottom: 1px solid #ddd;
      padding-bottom: 6px;
    }
    h2.section-header {
      font-size: ${13 * (contentScale / 100)}pt;
      font-weight: 600;
      margin: 22px 0 10px 0;
      color: #222;
    }
    h3.section-header {
      font-size: ${11 * (contentScale / 100)}pt;
      font-weight: 600;
      margin: 16px 0 8px 0;
      color: #333;
    }

    /* Text blocks - avoid breaking inside */
    .text-block {
      margin: 10px 0;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .text-block p {
      margin: 0 0 8px 0;
    }

    /* Dividers */
    .divider {
      border: none;
      border-top: 1px dashed #aaa;
      margin: 20px 0;
    }

    /* Code */
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 9pt;
      color: #333;
      border: 1px solid #ddd;
    }

    .code-block {
      background: #f8f8f8;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 12px 14px;
      margin: 12px 0;
      overflow-x: auto;
      page-break-inside: avoid;
    }
    .code-block code {
      background: none;
      padding: 0;
      color: #333;
      border: none;
      display: block;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-size: 9pt;
      line-height: 1.5;
    }

    /* Images */
    .image-block {
      margin: 16px 0;
      page-break-inside: avoid;
      text-align: center;
    }
    .print-image {
      max-width: 100%;
      height: auto;
      max-height: 400px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }

    /* Lists */
    ul, ol {
      margin: 8px 0;
      padding-left: 24px;
    }
    li {
      margin: 4px 0;
    }

    /* Tables */
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 12px 0;
      font-size: 10pt;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background: #f5f5f5;
      font-weight: 600;
    }

    /* Strong/Bold */
    strong {
      font-weight: 600;
    }

    /* Print-specific */
    @media print {
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      .section-header {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }

      .text-block, .code-block {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }

      /* Orphan/widow control */
      p {
        orphans: 3;
        widows: 3;
      }
    }
  </style>
</head>
<body>
  <div class="document-header">
    <span class="document-icon">${doc.icon || '📄'}</span>
    <div>
      <h1 class="document-title">${escapeHtml(doc.name)}</h1>
      ${doc.description ? `<p class="document-desc">${escapeHtml(doc.description)}</p>` : ''}
      <p class="document-meta">Print date: ${new Date().toLocaleDateString('en-US')} | Elements: ${items.filter(i => !i.is_hidden).length}</p>
    </div>
  </div>
  <div class="document-content">
    ${contentHtml}
  </div>
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
    // Wait for fonts and styles to load
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
}
