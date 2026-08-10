/**
 * ADR-028: Color Column Type - Utility Tests
 * TDD: These tests define expected behavior BEFORE implementation
 */

import {
  cmykToHex,
  hexToCmyk,
  hexToRgb,
  rgbToHex,
  isValidHex,
  isValidEmoji,
  sanitizeColor,
  colorDistance,
  findClosestRal,
  findClosestPantone,
  DEFAULT_20_COLORS,
  DEFAULT_EMOJI_PALETTE,
  RAL_CLASSIC_COLORS,
  PANTONE_SOLID_COATED,
  type CMYK,
  type ColorListItem,
  type ColorValue,
  type ColorValueObject,
} from '../color-utils';

describe('Color Utilities (ADR-028)', () => {
  // ═══════════════════════════════════════════════════════════
  // CMYK ↔ HEX Conversion
  // ═══════════════════════════════════════════════════════════
  describe('cmykToHex', () => {
    it('should convert pure cyan to blue-ish hex', () => {
      // C: 100, M: 0, Y: 0, K: 0 → cyan
      const hex = cmykToHex(100, 0, 0, 0);
      expect(hex).toBe('#00ffff');
    });

    it('should convert pure magenta to pink-ish hex', () => {
      // C: 0, M: 100, Y: 0, K: 0 → magenta
      const hex = cmykToHex(0, 100, 0, 0);
      expect(hex).toBe('#ff00ff');
    });

    it('should convert pure yellow to yellow hex', () => {
      // C: 0, M: 0, Y: 100, K: 0 → yellow
      const hex = cmykToHex(0, 0, 100, 0);
      expect(hex).toBe('#ffff00');
    });

    it('should convert pure black (K: 100)', () => {
      const hex = cmykToHex(0, 0, 0, 100);
      expect(hex).toBe('#000000');
    });

    it('should convert pure white (all 0)', () => {
      const hex = cmykToHex(0, 0, 0, 0);
      expect(hex).toBe('#ffffff');
    });

    it('should convert mixed CMYK to hex', () => {
      // Red-ish color: C: 0, M: 82, Y: 70, K: 6 → #ef4444 (approx)
      const hex = cmykToHex(0, 82, 70, 6);
      // Should be close to #ef4444
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('hexToCmyk', () => {
    it('should convert white to all zeros', () => {
      const cmyk = hexToCmyk('#ffffff');
      expect(cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    });

    it('should convert black to K: 100', () => {
      const cmyk = hexToCmyk('#000000');
      expect(cmyk).toEqual({ c: 0, m: 0, y: 0, k: 100 });
    });

    it('should convert cyan to C: 100', () => {
      const cmyk = hexToCmyk('#00ffff');
      expect(cmyk).toEqual({ c: 100, m: 0, y: 0, k: 0 });
    });

    it('should handle 3-digit hex', () => {
      const cmyk = hexToCmyk('#fff');
      expect(cmyk).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // RGB ↔ HEX Conversion
  // ═══════════════════════════════════════════════════════════
  describe('hexToRgb', () => {
    it('should convert hex to RGB object', () => {
      expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should handle 3-digit hex', () => {
      expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should return null for invalid hex', () => {
      expect(hexToRgb('invalid')).toBeNull();
      expect(hexToRgb('#gggggg')).toBeNull();
    });
  });

  describe('rgbToHex', () => {
    it('should convert RGB to hex', () => {
      expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
      expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
      expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Validation
  // ═══════════════════════════════════════════════════════════
  describe('isValidHex', () => {
    it('should validate 6-digit hex', () => {
      expect(isValidHex('#ff0000')).toBe(true);
      expect(isValidHex('#FF0000')).toBe(true);
      expect(isValidHex('#123abc')).toBe(true);
    });

    it('should validate 3-digit hex', () => {
      expect(isValidHex('#f00')).toBe(true);
      expect(isValidHex('#ABC')).toBe(true);
    });

    it('should reject invalid hex', () => {
      expect(isValidHex('ff0000')).toBe(false);  // no #
      expect(isValidHex('#gggggg')).toBe(false); // invalid chars
      expect(isValidHex('#12345')).toBe(false);  // wrong length
      expect(isValidHex('')).toBe(false);
    });
  });

  describe('isValidEmoji', () => {
    it('should validate emoji characters', () => {
      expect(isValidEmoji('🔴')).toBe(true);
      expect(isValidEmoji('🟢')).toBe(true);
      expect(isValidEmoji('❤️')).toBe(true);
      expect(isValidEmoji('👍')).toBe(true);
    });

    it('should reject non-emoji', () => {
      expect(isValidEmoji('a')).toBe(false);
      expect(isValidEmoji('123')).toBe(false);
      expect(isValidEmoji('#ff0000')).toBe(false);
    });
  });

  describe('sanitizeColor', () => {
    it('should return valid hex as-is', () => {
      expect(sanitizeColor('#ff0000')).toBe('#ff0000');
    });

    it('should return valid emoji as-is', () => {
      expect(sanitizeColor('🔴')).toBe('🔴');
    });

    it('should return empty for invalid values', () => {
      expect(sanitizeColor('invalid')).toBe('');
      expect(sanitizeColor('')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Color Distance
  // ═══════════════════════════════════════════════════════════
  describe('colorDistance', () => {
    it('should return 0 for same colors', () => {
      expect(colorDistance('#ff0000', '#ff0000')).toBe(0);
    });

    it('should return max distance for black and white', () => {
      const distance = colorDistance('#000000', '#ffffff');
      expect(distance).toBeGreaterThan(400); // sqrt(255^2 * 3) ≈ 441
    });

    it('should return smaller distance for similar colors', () => {
      const distanceSimilar = colorDistance('#ff0000', '#ff0033');
      const distanceDifferent = colorDistance('#ff0000', '#0000ff');
      expect(distanceSimilar).toBeLessThan(distanceDifferent);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Find Closest RAL
  // ═══════════════════════════════════════════════════════════
  describe('findClosestRal', () => {
    it('should find closest RAL for red', () => {
      const result = findClosestRal('#c9192d');
      expect(result).not.toBeNull();
      expect(result?.ral).toBe('RAL 3020'); // Traffic red
    });

    it('should find closest RAL for white', () => {
      const result = findClosestRal('#ffffff');
      expect(result).not.toBeNull();
      expect(result?.ral).toBe('RAL 9010'); // Pure white
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Find Closest Pantone
  // ═══════════════════════════════════════════════════════════
  describe('findClosestPantone', () => {
    it('should find closest Pantone for red', () => {
      const result = findClosestPantone('#da291c');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('485 C'); // Coca-Cola red
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Default Color Palettes
  // ═══════════════════════════════════════════════════════════
  describe('DEFAULT_20_COLORS', () => {
    it('should have exactly 20 colors', () => {
      expect(DEFAULT_20_COLORS).toHaveLength(20);
    });

    it('should have required properties for each color', () => {
      DEFAULT_20_COLORS.forEach((color) => {
        expect(color).toHaveProperty('id');
        expect(color).toHaveProperty('name');
        expect(color).toHaveProperty('nameEn');
        expect(color).toHaveProperty('hex');
        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should include common colors', () => {
      const ids = DEFAULT_20_COLORS.map(c => c.id);
      expect(ids).toContain('red');
      expect(ids).toContain('green');
      expect(ids).toContain('blue');
      expect(ids).toContain('black');
      expect(ids).toContain('white');
    });
  });

  describe('DEFAULT_EMOJI_PALETTE', () => {
    it('should have color emoji', () => {
      expect(DEFAULT_EMOJI_PALETTE).toContain('🔴');
      expect(DEFAULT_EMOJI_PALETTE).toContain('🟢');
      expect(DEFAULT_EMOJI_PALETTE).toContain('🔵');
    });

    it('should have at least 8 emoji', () => {
      expect(DEFAULT_EMOJI_PALETTE.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('RAL_CLASSIC_COLORS', () => {
    it('should have RAL colors with proper format', () => {
      RAL_CLASSIC_COLORS.forEach((color) => {
        expect(color).toHaveProperty('id');
        expect(color).toHaveProperty('ral');
        expect(color.ral).toMatch(/^RAL \d{4}$/);
        expect(color).toHaveProperty('hex');
      });
    });
  });

  describe('PANTONE_SOLID_COATED', () => {
    it('should have Pantone colors with proper format', () => {
      PANTONE_SOLID_COATED.forEach((color) => {
        expect(color).toHaveProperty('id');
        expect(color).toHaveProperty('code');
        expect(color).toHaveProperty('hex');
        expect(color).toHaveProperty('system');
        expect(color.system).toBe('solid-coated');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Type Guards for ColorValue
  // ═══════════════════════════════════════════════════════════
  describe('ColorValue Type', () => {
    it('should accept string hex', () => {
      const value: ColorValue = '#22c55e';
      expect(typeof value).toBe('string');
    });

    it('should accept string emoji', () => {
      const value: ColorValue = '🟢';
      expect(typeof value).toBe('string');
    });

    it('should accept ColorValueObject', () => {
      const value: ColorValue = {
        type: 'hex',
        value: '#22c55e',
      };
      expect(typeof value).toBe('object');
      expect((value as ColorValueObject).type).toBe('hex');
    });

    it('should accept CMYK ColorValueObject', () => {
      const value: ColorValue = {
        type: 'cmyk',
        value: '#c9192d',
        original: { cmyk: { c: 0, m: 87, y: 74, k: 6 } },
        name: 'Signal Red',
      };
      expect((value as ColorValueObject).original?.cmyk?.m).toBe(87);
    });
  });
});
