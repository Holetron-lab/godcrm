function toDocumentLevel(n) {
  return n === 1 ? 'h1' : n === 2 ? 'h2' : n === 3 ? 'h3' : 'text';
}

function detectType(title, content) {
  const tl = (title || '').toLowerCase();
  const cl = (content || '').toLowerCase();
  if (/^(GET|POST|PUT|PATCH|DELETE)\s+/i.test(title || '')) return 'endpoint';
  if (tl.includes('component') || /<[A-Z][a-zA-Z]+/.test(content)) return 'component';
  if (tl.startsWith('use') || /use[A-Z]\w+/.test(content)) return 'hook';
  if (tl.includes('store') || cl.includes('zustand')) return 'store';
  if (tl.includes('how') || tl.includes('guide') || tl.includes('tutorial')) return 'howto';
  if (content.match(/```[\s\S]+```/) && content.split('```').length > 4) return 'code';
  if (content.length > 500) return 'concept';
  return 'reference';
}

export function parseMarkdownV4(markdown) {
  const content = (markdown || '').replace(/\r\n/g, '\n').trim();
  const lines = content.split('\n');

  const h1Match = content.match(/^#\s+(.+)$/m);
  const documentTitle = h1Match ? h1Match[1].trim() : 'Untitled';

  let description = '';
  const h1Idx = content.indexOf('# ');
  const h2Idx = content.indexOf('\n## ');
  if (h1Idx !== -1 && h2Idx !== -1 && h2Idx > h1Idx) {
    description = content.substring(content.indexOf('\n', h1Idx) + 1, h2Idx)
      .trim().split('\n').slice(0, 3).join(' ').trim();
  }

  const sections = [];
  let currentTitle = '';
  let currentLevel = 'text';
  let currentContent = [];
  let inSection = false;
  let orderIndex = 0;
  let skippedFirstH1 = false;

  const finalize = () => {
    if (!inSection) return;
    const trimmed = currentContent.join('\n').trim();

    if (currentLevel === 'h1' && !skippedFirstH1) {
      skippedFirstH1 = true;
      currentTitle = ''; currentContent = []; inSection = false;
      return;
    }

    if (currentLevel === 'h2' || currentLevel === 'h3') {
      if (currentTitle) {
        orderIndex += 10;
        sections.push({
          order: orderIndex,
          level: currentLevel,
          content: currentTitle,
          type: detectType(currentTitle, trimmed),
        });
      }
      if (trimmed) {
        orderIndex += 10;
        sections.push({ order: orderIndex, level: 'text', content: trimmed, type: 'reference' });
      }
    } else if (currentTitle || trimmed) {
      orderIndex += 10;
      sections.push({
        order: orderIndex,
        level: currentLevel,
        content: currentTitle || trimmed,
        type: detectType(currentTitle, trimmed),
      });
    }

    currentTitle = ''; currentContent = []; inSection = false;
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      finalize();
      currentLevel = toDocumentLevel(headerMatch[1].length);
      currentTitle = headerMatch[2].trim();
      inSection = true;
    } else if (line.startsWith('---') && line.replace(/-/g, '').trim() === '') {
      if (inSection) finalize();
      orderIndex += 10;
      sections.push({ order: orderIndex, level: 'divider', content: '' });
    } else {
      if (!inSection && line.trim()) {
        inSection = true; currentLevel = 'text'; currentTitle = '';
      }
      if (inSection) currentContent.push(line);
    }
  }
  finalize();

  return { title: documentTitle, description, sections };
}
