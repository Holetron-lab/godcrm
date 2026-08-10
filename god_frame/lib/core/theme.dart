import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// GOD CRM brand theme for the Frame app.
class GodTheme {
  GodTheme._();

  // ── Brand Colors ─────────────────────────────────────────────
  static const Color primary = Color(0xFF6366F1);       // Indigo-500
  static const Color primaryLight = Color(0xFF818CF8);   // Indigo-400
  static const Color primaryDark = Color(0xFF4F46E5);    // Indigo-600
  static const Color accent = Color(0xFF22D3EE);         // Cyan-400
  static const Color surface = Color(0xFF12121A);        // Dark surface
  static const Color surfaceLight = Color(0xFF1E1E2E);   // Lighter surface
  static const Color card = Color(0xFF16162A);           // Card background
  static const Color background = Color(0xFF0A0A0F);    // Deep dark bg
  static const Color textPrimary = Color(0xFFF8FAFC);   // Slate-50
  static const Color textSecondary = Color(0xFF94A3B8);  // Slate-400
  static const Color textMuted = Color(0xFF64748B);      // Slate-500
  static const Color border = Color(0xFF2D2D44);         // Border color
  static const Color success = Color(0xFF22C55E);        // Green-500
  static const Color warning = Color(0xFFF59E0B);        // Amber-500
  static const Color error = Color(0xFFEF4444);          // Red-500
  static const Color info = Color(0xFF3B82F6);           // Blue-500

  // ── Frame-specific colors ───────────────────────────────────
  static const Color frameBle = Color(0xFF06B6D4);       // Cyan-500 (BLE connected)
  static const Color frameDisconnected = Color(0xFFEF4444);

  // ── Text Styles ──────────────────────────────────────────────
  static TextTheme get _textTheme => GoogleFonts.interTextTheme(
    const TextTheme(
      displayLarge: TextStyle(fontSize: 32, fontWeight: FontWeight.w700, color: textPrimary),
      displayMedium: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: textPrimary),
      displaySmall: TextStyle(fontSize: 24, fontWeight: FontWeight.w600, color: textPrimary),
      headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: textPrimary),
      headlineSmall: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: textPrimary),
      titleLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: textPrimary),
      titleMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: textPrimary),
      titleSmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: textSecondary),
      bodyLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w400, color: textPrimary),
      bodyMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w400, color: textPrimary),
      bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w400, color: textSecondary),
      labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: textPrimary),
      labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w500, color: textMuted),
    ),
  );

  // ── Dark Theme ───────────────────────────────────────────────
  static ThemeData get darkTheme => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: const ColorScheme.dark(
      primary: primary,
      secondary: accent,
      surface: surface,
      error: error,
      onPrimary: Colors.white,
      onSecondary: Colors.black,
      onSurface: textPrimary,
      onError: Colors.white,
    ),
    scaffoldBackgroundColor: background,
    textTheme: _textTheme,
    appBarTheme: const AppBarTheme(
      backgroundColor: surface,
      foregroundColor: textPrimary,
      elevation: 0,
      centerTitle: false,
      scrolledUnderElevation: 1,
    ),
    cardTheme: CardThemeData(
      color: card,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: border, width: 1),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surfaceLight,
      hintStyle: const TextStyle(color: textMuted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: primary, width: 2),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: error),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: textPrimary,
        side: const BorderSide(color: border),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: primary,
      ),
    ),
    iconTheme: const IconThemeData(color: textSecondary, size: 24),
    dividerTheme: const DividerThemeData(color: border, thickness: 1),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: surface,
      selectedItemColor: primary,
      unselectedItemColor: textMuted,
      type: BottomNavigationBarType.fixed,
      elevation: 8,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: surfaceLight,
      contentTextStyle: const TextStyle(color: textPrimary),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      behavior: SnackBarBehavior.floating,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: primary,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: surfaceLight,
      selectedColor: primary.withOpacity(0.2),
      labelStyle: const TextStyle(color: textPrimary, fontSize: 12),
      side: const BorderSide(color: border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
  );
}
