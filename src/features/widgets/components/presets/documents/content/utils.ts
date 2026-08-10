import type { DocumentLevel } from '../../../../types/documents.types';

// A4 aspect ratio: 210mm x 297mm = 1:1.4142
export const A4_ASPECT_RATIO = 297 / 210; // 1.4142857

// Types for element levels (including h1).
// ADR-0003 widget-embed: 'widget' added — ConvertToTicketModal lives on text
// items as a right-side button, not as a level, so 'ticket' stays for legacy
// display but isn't a new-item entry in the "+" menu.
export const addLevelTypes: DocumentLevel[] = ['h1', 'h2', 'h3', 'text', 'atom', 'widget', 'image', 'divider', 'page_break'];

// Badge colors for each level type
export const getLevelBadgeClass = (level: DocumentLevel): string => {
  switch (level) {
    case 'h1': return 'bg-red-500/20 text-red-400';
    case 'h2': return 'bg-blue-500/20 text-blue-400';
    case 'h3': return 'bg-green-500/20 text-green-400';
    case 'text': return 'bg-gray-500/20 text-gray-400';
    case 'atom': return 'bg-purple-500/20 text-purple-400';
    case 'ticket': return 'bg-blue-500/20 text-blue-400';
    case 'image': return 'bg-pink-500/20 text-pink-400';
    case 'divider': return 'bg-gray-500/20 text-gray-400';
    case 'page_break': return 'bg-orange-500/20 text-orange-400';
    case 'widget': return 'bg-cyan-500/20 text-cyan-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
};
