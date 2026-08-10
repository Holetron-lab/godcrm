import type { SectionTreeNodeV4, ParsedSectionV4 } from '../../../../utils/parseMarkdownToAtoms';

export function flattenSectionTree(nodes: SectionTreeNodeV4[]): ParsedSectionV4[] {
  const result: ParsedSectionV4[] = [];
  function traverse(node: SectionTreeNodeV4) {
    result.push(node.section);
    node.children?.forEach(traverse);
  }
  nodes.forEach(traverse);
  return result;
}

export function transliterate(text: string): string {
  const map: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss',
    'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'à': 'a', 'â': 'a', 'ù': 'u', 'û': 'u',
    'ô': 'o', 'î': 'i', 'ï': 'i', 'ç': 'c', 'ñ': 'n', 'á': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u',
  };

  return text
    .toLowerCase()
    .split('')
    .map(char => map[char] || char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
