/**
 * Internationalization utilities for text processing
 * 
 * Provides:
 * - Multi-language transliteration and slug generation
 * - Multi-language boolean value parsing
 */

import { slugify as transliterationSlugify } from 'transliteration';

// ============================================================================
// TRANSLITERATION & SLUG GENERATION
// ============================================================================

/**
 * Convert any Unicode text to a URL/key-safe slug
 * Supports 100+ languages including CJK (Chinese, Japanese, Korean)
 * 
 * @example
 * toSlug('Привет мир')     // 'privet_mir'
 * toSlug('你好世界')        // 'ni_hao_shi_jie'
 * toSlug('Größe')          // 'grosse'
 * toSlug('Héllo Wörld!')   // 'hello_world'
 */
export const toSlug = (text: string): string => {
  return transliterationSlugify(text, { 
    lowercase: true, 
    separator: '_',
    allowedChars: 'a-zA-Z0-9_'
  });
};

/**
 * Convert text to a hyphenated slug (for URLs)
 * 
 * @example
 * toUrlSlug('Привет мир')  // 'privet-mir'
 */
export const toUrlSlug = (text: string): string => {
  return transliterationSlugify(text, { 
    lowercase: true, 
    separator: '-',
    allowedChars: 'a-zA-Z0-9-'
  });
};

/**
 * Transliterate text without converting to slug (preserves spaces)
 * 
 * @example
 * transliterate('Привет мир')  // 'Privet mir'
 */
export { transliterate } from 'transliteration';

// ============================================================================
// BOOLEAN VALUE PARSING
// ============================================================================

/**
 * Values that represent TRUE in various languages
 */
export const BOOL_TRUE_VALUES = [
  // English
  'true', '1', 'yes', 'on', 'y', 't',
  // Russian
  'да', 'истина', 'д',
  // German
  'ja', 'wahr', 'j',
  // French
  'oui', 'vrai', 'o',
  // Spanish
  'sí', 'si', 'verdadero', 's',
  // Portuguese
  'sim', 'verdadeiro',
  // Italian
  'vero', 'sì',
  // Polish
  'tak', 'prawda',
  // Dutch
  'ja', 'waar',
  // Swedish/Norwegian/Danish
  'ja', 'sant', 'sann',
  // Czech
  'ano', 'pravda',
  // Turkish
  'evet', 'doğru',
  // Chinese
  '是', '对', '真', '有',
  // Japanese
  'はい', '真',
  // Korean
  '예', '네',
  // Arabic
  'نعم',
  // Hebrew
  'כן',
] as const;

/**
 * Values that represent FALSE in various languages
 */
export const BOOL_FALSE_VALUES = [
  // English
  'false', '0', 'no', 'off', 'n', 'f',
  // Russian
  'нет', 'ложь', 'н',
  // German
  'nein', 'falsch',
  // French
  'non', 'faux',
  // Spanish
  'no', 'falso',
  // Portuguese
  'não', 'nao', 'falso',
  // Italian
  'falso', 'no',
  // Polish
  'nie', 'fałsz',
  // Dutch
  'nee', 'vals',
  // Swedish/Norwegian/Danish
  'nej', 'nei', 'falskt',
  // Czech
  'ne', 'nepravda',
  // Turkish
  'hayır', 'yanlış',
  // Chinese
  '否', '假', '不', '无',
  // Japanese
  'いいえ', '偽',
  // Korean
  '아니요', '아니',
  // Arabic
  'لا',
  // Hebrew
  'לא',
] as const;

/**
 * All boolean values (both true and false)
 */
export const BOOL_VALUES = [...BOOL_TRUE_VALUES, ...BOOL_FALSE_VALUES];

/**
 * Parse a string value as boolean, supporting multiple languages
 * 
 * @param value - The string to parse
 * @returns true, false, or null if not recognized as boolean
 * 
 * @example
 * parseBoolean('yes')   // true
 * parseBoolean('да')    // true
 * parseBoolean('nein')  // false
 * parseBoolean('maybe') // null
 */
export const parseBoolean = (value: string): boolean | null => {
  const lower = value.toLowerCase().trim();
  if (BOOL_TRUE_VALUES.includes(lower as typeof BOOL_TRUE_VALUES[number])) return true;
  if (BOOL_FALSE_VALUES.includes(lower as typeof BOOL_FALSE_VALUES[number])) return false;
  return null;
};

/**
 * Check if a value looks like a boolean (in any supported language)
 * 
 * @example
 * isBooleanValue('yes')   // true
 * isBooleanValue('да')    // true
 * isBooleanValue('hello') // false
 */
export const isBooleanValue = (value: string): boolean => {
  return parseBoolean(value) !== null;
};

/**
 * Check if an array of values all look like booleans
 * Useful for CSV column type detection
 */
export const allAreBooleans = (values: string[]): boolean => {
  const nonEmpty = values.filter(v => v && v.trim());
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every(v => isBooleanValue(v));
};
