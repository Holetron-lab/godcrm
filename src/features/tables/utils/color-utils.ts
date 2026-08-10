/**
 * ADR-028: Color Column Type - Utilities
 * 
 * Функции конвертации цветов, валидации, палитры
 */

// ═══════════════════════════════════════════════════════════
// INTERFACES
// ═══════════════════════════════════════════════════════════

/**
 * CMYK color format (for print)
 */
export interface CMYK {
  c: number;  // 0-100
  m: number;  // 0-100
  y: number;  // 0-100
  k: number;  // 0-100
}

/**
 * RGB color format
 */
export interface RGB {
  r: number;  // 0-255
  g: number;  // 0-255
  b: number;  // 0-255
}

/**
 * Color list item with full metadata
 */
export interface ColorListItem {
  id: string;
  name: string;
  nameEn?: string;
  hex: string;
  cmyk?: CMYK;
  ral?: string;
}

/**
 * Pantone color definition
 */
export interface PantoneColor {
  id: string;
  code: string;
  name: string;
  hex: string;
  system: 'solid-coated' | 'solid-uncoated' | 'cmyk' | 'pastel' | 'neon' | 'metallics';
}

/**
 * ColorValue - universal storage format
 */
export type ColorValue = string | ColorValueObject;

/**
 * Full color value object with metadata
 */
export interface ColorValueObject {
  type: 'hex' | 'emoji' | 'cmyk' | 'ral' | 'pantone' | 'list';
  value: string;
  original?: {
    cmyk?: CMYK;
    ral?: string;
    pantone?: string;
    listId?: string;
  };
  name?: string;
}

/**
 * Color column configuration
 */
export type ColorMode = 'emoji' | 'palette' | 'list' | 'cmyk' | 'ral' | 'pantone' | 'all';
export type ColorType = 'hex' | 'cmyk' | 'ral' | 'pantone' | 'emoji';
export type DisplayMode = 'swatch-code' | 'full-cell' | 'swatch-only';
export type CodeFormat = 'auto' | 'hex' | 'rgb' | 'cmyk' | 'name';
export type RowColorMode = 'background' | 'border-left' | 'gradient';

export interface ColorColumnConfig {
  // ═══════════════════════════════════════════════════════════
  // Color Type (Select in UI) - NEW
  // ═══════════════════════════════════════════════════════════
  colorType?: ColorType;  // 'hex' | 'cmyk' | 'ral' | 'pantone' | 'emoji'
  
  // Legacy mode (for backward compatibility)
  mode?: ColorMode;
  
  // ═══════════════════════════════════════════════════════════
  // Display Settings - NEW
  // ═══════════════════════════════════════════════════════════
  displayMode?: DisplayMode;  // 'swatch-code' | 'full-cell' | 'swatch-only'
  showCode?: boolean;         // Show color code next to swatch
  codeFormat?: CodeFormat;    // 'auto' | 'hex' | 'rgb' | 'cmyk' | 'name'
  
  // ═══════════════════════════════════════════════════════════
  // HEX/Palette Mode Settings
  // ═══════════════════════════════════════════════════════════
  presetColors?: string[];
  allowCustomColor?: boolean;  // Allow manual HEX input
  
  // List Mode (strict list)
  colorList?: ColorListItem[];
  
  // CMYK Mode
  cmykEnabled?: boolean;
  
  // RAL Mode
  ralEnabled?: boolean;
  ralCategories?: ('classic' | 'design' | 'effect' | 'all')[];
  
  // Pantone Mode
  pantoneEnabled?: boolean;
  pantoneSystems?: ('solid-coated' | 'solid-uncoated' | 'cmyk' | 'pastel' | 'neon' | 'metallics' | 'all')[];
  
  // Emoji Mode
  emojiCategories?: ('smileys' | 'objects' | 'symbols' | 'flags' | 'all')[];
  presetEmojis?: string[];
  
  // ═══════════════════════════════════════════════════════════
  // Row Coloring
  // ═══════════════════════════════════════════════════════════
  applyToRow?: boolean;
  rowColorMode?: RowColorMode;
  rowColorOpacity?: number;  // 0.0 - 1.0 (default: 0.15)
}

// ═══════════════════════════════════════════════════════════
// DEFAULT PALETTES
// ═══════════════════════════════════════════════════════════

/**
 * 20 standard colors with names, HEX, CMYK and RAL
 */
export const DEFAULT_20_COLORS: ColorListItem[] = [
  // Primary colors
  { id: 'red',      name: 'Красный',     nameEn: 'Red',        hex: '#ef4444', cmyk: { c: 0, m: 82, y: 70, k: 6 },  ral: 'RAL 3020' },
  { id: 'orange',   name: 'Оранжевый',   nameEn: 'Orange',     hex: '#f97316', cmyk: { c: 0, m: 60, y: 90, k: 2 },  ral: 'RAL 2004' },
  { id: 'yellow',   name: 'Жёлтый',      nameEn: 'Yellow',     hex: '#eab308', cmyk: { c: 0, m: 20, y: 95, k: 8 },  ral: 'RAL 1021' },
  { id: 'lime',     name: 'Лаймовый',    nameEn: 'Lime',       hex: '#84cc16', cmyk: { c: 35, m: 0, y: 90, k: 20 }, ral: 'RAL 6018' },
  { id: 'green',    name: 'Зелёный',     nameEn: 'Green',      hex: '#22c55e', cmyk: { c: 70, m: 0, y: 70, k: 23 }, ral: 'RAL 6024' },
  { id: 'teal',     name: 'Бирюзовый',   nameEn: 'Teal',       hex: '#14b8a6', cmyk: { c: 80, m: 0, y: 30, k: 28 }, ral: 'RAL 6027' },
  { id: 'cyan',     name: 'Голубой',     nameEn: 'Cyan',       hex: '#06b6d4', cmyk: { c: 80, m: 10, y: 0, k: 17 }, ral: 'RAL 5012' },
  { id: 'blue',     name: 'Синий',       nameEn: 'Blue',       hex: '#3b82f6', cmyk: { c: 75, m: 45, y: 0, k: 4 },  ral: 'RAL 5015' },
  { id: 'indigo',   name: 'Индиго',      nameEn: 'Indigo',     hex: '#6366f1', cmyk: { c: 60, m: 55, y: 0, k: 5 },  ral: 'RAL 5002' },
  { id: 'purple',   name: 'Фиолетовый',  nameEn: 'Purple',     hex: '#8b5cf6', cmyk: { c: 45, m: 60, y: 0, k: 4 },  ral: 'RAL 4005' },
  { id: 'pink',     name: 'Розовый',     nameEn: 'Pink',       hex: '#ec4899', cmyk: { c: 0, m: 75, y: 25, k: 7 },  ral: 'RAL 4003' },
  { id: 'rose',     name: 'Малиновый',   nameEn: 'Rose',       hex: '#f43f5e', cmyk: { c: 0, m: 80, y: 55, k: 4 },  ral: 'RAL 3018' },
  
  // Neutral colors
  { id: 'white',    name: 'Белый',       nameEn: 'White',      hex: '#ffffff', cmyk: { c: 0, m: 0, y: 0, k: 0 },    ral: 'RAL 9010' },
  { id: 'gray-100', name: 'Светло-серый',nameEn: 'Light Gray', hex: '#f3f4f6', cmyk: { c: 2, m: 1, y: 1, k: 4 },   ral: 'RAL 9002' },
  { id: 'gray-300', name: 'Серый',       nameEn: 'Gray',       hex: '#d1d5db', cmyk: { c: 5, m: 3, y: 2, k: 14 },  ral: 'RAL 7035' },
  { id: 'gray-500', name: 'Тёмно-серый', nameEn: 'Dark Gray',  hex: '#6b7280', cmyk: { c: 15, m: 10, y: 5, k: 50 },ral: 'RAL 7037' },
  { id: 'gray-800', name: 'Графит',      nameEn: 'Charcoal',   hex: '#1f2937', cmyk: { c: 40, m: 30, y: 20, k: 78 },ral: 'RAL 7016' },
  { id: 'black',    name: 'Чёрный',      nameEn: 'Black',      hex: '#000000', cmyk: { c: 0, m: 0, y: 0, k: 100 }, ral: 'RAL 9005' },
  
  // Special colors
  { id: 'brown',    name: 'Коричневый',  nameEn: 'Brown',      hex: '#92400e', cmyk: { c: 0, m: 55, y: 90, k: 43 },ral: 'RAL 8003' },
  { id: 'gold',     name: 'Золотой',     nameEn: 'Gold',       hex: '#ca8a04', cmyk: { c: 0, m: 30, y: 98, k: 21 },ral: 'RAL 1036' },
];

/**
 * Default emoji palette for color selection
 */
export const DEFAULT_EMOJI_PALETTE = [
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
];

/**
 * RAL Classic colors (partial list for UI)
 */
export const RAL_CLASSIC_COLORS: ColorListItem[] = [
  { id: 'ral-1000', name: 'Зелёно-бежевый',       nameEn: 'Green beige',       hex: '#bebd7f', ral: 'RAL 1000' },
  { id: 'ral-1003', name: 'Сигнальный жёлтый',    nameEn: 'Signal yellow',     hex: '#f5a600', ral: 'RAL 1003' },
  { id: 'ral-1021', name: 'Рапсово-жёлтый',       nameEn: 'Rape yellow',       hex: '#f3b700', ral: 'RAL 1021' },
  { id: 'ral-2004', name: 'Чистый оранжевый',     nameEn: 'Pure orange',       hex: '#f44611', ral: 'RAL 2004' },
  { id: 'ral-3000', name: 'Огненно-красный',      nameEn: 'Flame red',         hex: '#af2b1e', ral: 'RAL 3000' },
  { id: 'ral-3020', name: 'Транспортный красный', nameEn: 'Traffic red',       hex: '#c9192d', ral: 'RAL 3020' },
  { id: 'ral-4005', name: 'Сине-сиреневый',       nameEn: 'Blue lilac',        hex: '#6c4675', ral: 'RAL 4005' },
  { id: 'ral-5002', name: 'Ультрамарин',          nameEn: 'Ultramarine blue',  hex: '#20214f', ral: 'RAL 5002' },
  { id: 'ral-5012', name: 'Голубой',              nameEn: 'Light blue',        hex: '#3b83bd', ral: 'RAL 5012' },
  { id: 'ral-5015', name: 'Небесно-синий',        nameEn: 'Sky blue',          hex: '#2271b3', ral: 'RAL 5015' },
  { id: 'ral-6018', name: 'Желто-зелёный',        nameEn: 'Yellow green',      hex: '#57a639', ral: 'RAL 6018' },
  { id: 'ral-6024', name: 'Транспортный зелёный', nameEn: 'Traffic green',     hex: '#308446', ral: 'RAL 6024' },
  { id: 'ral-7016', name: 'Антрацит',             nameEn: 'Anthracite grey',   hex: '#293133', ral: 'RAL 7016' },
  { id: 'ral-7035', name: 'Светло-серый',         nameEn: 'Light grey',        hex: '#d7d7d7', ral: 'RAL 7035' },
  { id: 'ral-9005', name: 'Чёрный янтарь',        nameEn: 'Jet black',         hex: '#0a0a0a', ral: 'RAL 9005' },
  { id: 'ral-9010', name: 'Белый',                nameEn: 'Pure white',        hex: '#f5f5f5', ral: 'RAL 9010' },
];

/**
 * Pantone Solid Coated colors (partial list for UI)
 */
export const PANTONE_SOLID_COATED: PantoneColor[] = [
  // Reds / Oranges
  { id: 'pantone-485-c',   code: '485 C',   name: 'Pantone 485 C',   hex: '#da291c', system: 'solid-coated' },
  { id: 'pantone-186-c',   code: '186 C',   name: 'Pantone 186 C',   hex: '#c8102e', system: 'solid-coated' },
  { id: 'pantone-032-c',   code: '032 C',   name: 'Pantone 032 C',   hex: '#ef3340', system: 'solid-coated' },
  { id: 'pantone-021-c',   code: '021 C',   name: 'Pantone 021 C',   hex: '#fe5000', system: 'solid-coated' },
  { id: 'pantone-1505-c',  code: '1505 C',  name: 'Pantone 1505 C',  hex: '#ff6900', system: 'solid-coated' },
  
  // Yellows
  { id: 'pantone-yellow-c', code: 'Yellow C', name: 'Pantone Yellow C', hex: '#fedd00', system: 'solid-coated' },
  { id: 'pantone-116-c',   code: '116 C',   name: 'Pantone 116 C',   hex: '#ffcd00', system: 'solid-coated' },
  { id: 'pantone-109-c',   code: '109 C',   name: 'Pantone 109 C',   hex: '#ffd100', system: 'solid-coated' },
  
  // Greens
  { id: 'pantone-347-c',   code: '347 C',   name: 'Pantone 347 C',   hex: '#009639', system: 'solid-coated' },
  { id: 'pantone-355-c',   code: '355 C',   name: 'Pantone 355 C',   hex: '#009a44', system: 'solid-coated' },
  { id: 'pantone-3415-c',  code: '3415 C',  name: 'Pantone 3415 C',  hex: '#007a53', system: 'solid-coated' },
  { id: 'pantone-3268-c',  code: '3268 C',  name: 'Pantone 3268 C',  hex: '#00ab84', system: 'solid-coated' },
  
  // Blues
  { id: 'pantone-286-c',   code: '286 C',   name: 'Pantone 286 C',   hex: '#0033a0', system: 'solid-coated' },
  { id: 'pantone-300-c',   code: '300 C',   name: 'Pantone 300 C',   hex: '#005eb8', system: 'solid-coated' },
  { id: 'pantone-process-blue-c', code: 'Process Blue C', name: 'Pantone Process Blue C', hex: '#0085ca', system: 'solid-coated' },
  { id: 'pantone-299-c',   code: '299 C',   name: 'Pantone 299 C',   hex: '#00a3e0', system: 'solid-coated' },
  { id: 'pantone-072-c',   code: '072 C',   name: 'Pantone 072 C',   hex: '#10069f', system: 'solid-coated' },
  
  // Purples / Pinks
  { id: 'pantone-violet-c', code: 'Violet C', name: 'Pantone Violet C', hex: '#440099', system: 'solid-coated' },
  { id: 'pantone-2685-c',  code: '2685 C',  name: 'Pantone 2685 C',  hex: '#56368a', system: 'solid-coated' },
  { id: 'pantone-rhodamine-red-c', code: 'Rhodamine Red C', name: 'Pantone Rhodamine Red C', hex: '#e10098', system: 'solid-coated' },
  { id: 'pantone-rubine-red-c', code: 'Rubine Red C', name: 'Pantone Rubine Red C', hex: '#ce0058', system: 'solid-coated' },
  
  // Neutrals
  { id: 'pantone-black-c', code: 'Black C', name: 'Pantone Black C', hex: '#2d2926', system: 'solid-coated' },
  { id: 'pantone-cool-gray-11-c', code: 'Cool Gray 11 C', name: 'Pantone Cool Gray 11 C', hex: '#53565a', system: 'solid-coated' },
  { id: 'pantone-cool-gray-5-c',  code: 'Cool Gray 5 C',  name: 'Pantone Cool Gray 5 C',  hex: '#b1b3b3', system: 'solid-coated' },
  { id: 'pantone-warm-gray-11-c', code: 'Warm Gray 11 C', name: 'Pantone Warm Gray 11 C', hex: '#5b5856', system: 'solid-coated' },
];

// ═══════════════════════════════════════════════════════════
// CONVERSION FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * CMYK → RGB → HEX
 * Note: Web cannot display CMYK exactly, this is an approximation
 */
export function cmykToHex(c: number, m: number, y: number, k: number): string {
  // Normalize to 0-1
  const cNorm = c / 100;
  const mNorm = m / 100;
  const yNorm = y / 100;
  const kNorm = k / 100;
  
  // CMYK to RGB
  const r = Math.round(255 * (1 - cNorm) * (1 - kNorm));
  const g = Math.round(255 * (1 - mNorm) * (1 - kNorm));
  const b = Math.round(255 * (1 - yNorm) * (1 - kNorm));
  
  return rgbToHex(r, g, b);
}

/**
 * HEX → RGB → CMYK
 */
export function hexToCmyk(hex: string): CMYK {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return { c: 0, m: 0, y: 0, k: 100 }; // fallback to black
  }
  
  const { r, g, b } = rgb;
  
  // Normalize to 0-1
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  
  // Calculate K (black)
  const k = 1 - Math.max(rNorm, gNorm, bNorm);
  
  // Avoid division by zero
  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }
  
  // Calculate CMY
  const c = Math.round(((1 - rNorm - k) / (1 - k)) * 100);
  const m = Math.round(((1 - gNorm - k) / (1 - k)) * 100);
  const y = Math.round(((1 - bNorm - k) / (1 - k)) * 100);
  const kPercent = Math.round(k * 100);
  
  return { c, m, y, k: kPercent };
}

/**
 * HEX → RGB
 */
export function hexToRgb(hex: string): RGB | null {
  // Remove # if present
  const cleanHex = hex.replace(/^#/, '');
  
  // Handle 3-digit hex
  let fullHex = cleanHex;
  if (cleanHex.length === 3) {
    fullHex = cleanHex.split('').map(c => c + c).join('');
  }
  
  // Validate
  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    return null;
  }
  
  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);
  
  return { r, g, b };
}

/**
 * RGB → HEX
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, n)).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ═══════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Validate HEX color format
 */
export function isValidHex(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}){1,2}$/.test(color);
}

/**
 * Validate emoji (basic check)
 */
export function isValidEmoji(emoji: string): boolean {
  // Check for emoji using Unicode property escapes
  const emojiRegex = /\p{Extended_Pictographic}/u;
  return emojiRegex.test(emoji) && emoji.length <= 10; // Allow emoji sequences
}

/**
 * Sanitize color value before storing
 */
export function sanitizeColor(value: string): string {
  if (!value) return '';
  
  // Check if valid HEX
  if (isValidHex(value)) {
    return value.toLowerCase();
  }
  
  // Check if valid emoji
  if (isValidEmoji(value)) {
    return value;
  }
  
  return ''; // Invalid - return empty
}

// ═══════════════════════════════════════════════════════════
// COLOR DISTANCE & MATCHING
// ═══════════════════════════════════════════════════════════

/**
 * Euclidean distance between colors in RGB space
 */
export function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  
  if (!rgb1 || !rgb2) return Infinity;
  
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
}

/**
 * Find closest RAL color by HEX
 */
export function findClosestRal(hex: string): ColorListItem | null {
  let closest: ColorListItem | null = null;
  let minDistance = Infinity;
  
  for (const ral of RAL_CLASSIC_COLORS) {
    const distance = colorDistance(hex, ral.hex);
    if (distance < minDistance) {
      minDistance = distance;
      closest = ral;
    }
  }
  
  return closest;
}

/**
 * Find closest Pantone color by HEX
 */
export function findClosestPantone(hex: string): PantoneColor | null {
  let closest: PantoneColor | null = null;
  let minDistance = Infinity;
  
  for (const pantone of PANTONE_SOLID_COATED) {
    const distance = colorDistance(hex, pantone.hex);
    if (distance < minDistance) {
      minDistance = distance;
      closest = pantone;
    }
  }
  
  return closest;
}

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Get display hex from ColorValue
 */
export function getDisplayHex(value: ColorValue): string | null {
  if (typeof value === 'string') {
    if (isValidHex(value)) return value;
    return null;
  }
  return value.value;
}

/**
 * Get display value (hex or emoji) from ColorValue
 */
export function getDisplayValue(value: ColorValue): string {
  if (typeof value === 'string') {
    return value;
  }
  return value.value;
}

/**
 * Check if value is emoji type
 */
export function isEmojiValue(value: ColorValue): boolean {
  if (typeof value === 'string') {
    return isValidEmoji(value);
  }
  return value.type === 'emoji';
}

/**
 * Create ColorValueObject from simple hex
 */
export function createColorValue(hex: string, name?: string): ColorValueObject {
  return {
    type: 'hex',
    value: hex,
    name,
  };
}

/**
 * Create CMYK ColorValueObject
 */
export function createCmykColorValue(cmyk: CMYK, name?: string): ColorValueObject {
  return {
    type: 'cmyk',
    value: cmykToHex(cmyk.c, cmyk.m, cmyk.y, cmyk.k),
    original: { cmyk },
    name,
  };
}

/**
 * Get default ColorColumnConfig
 */
export function getDefaultColorColumnConfig(): ColorColumnConfig {
  return {
    mode: 'palette',
    presetColors: DEFAULT_20_COLORS.map(c => c.hex),
    allowCustomColor: true,
    applyToRow: false,
    rowColorMode: 'background',
    rowColorOpacity: 0.15,
    presetEmojis: DEFAULT_EMOJI_PALETTE,
  };
}
