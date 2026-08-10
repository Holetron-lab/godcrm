import 'package:flutter/material.dart';

/// Asymmetric pixel-art vessel-heart with a pulsing gray core and soft glow.
///
/// Drawn entirely in [CustomPainter] — no PNG assets so NIKITRON can tune
/// numbers without re-exporting art.
class VesselHeart extends StatelessWidget {
  final double pulse;
  final double corePulse;
  final double pixelSize;

  const VesselHeart({
    super.key,
    required this.pulse,
    required this.corePulse,
    this.pixelSize = 8,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _VesselHeartPainter(
        pulse: pulse,
        corePulse: corePulse,
        pixelSize: pixelSize,
      ),
    );
  }
}

class _VesselHeartPainter extends CustomPainter {
  final double pulse;
  final double corePulse;
  final double pixelSize;

  _VesselHeartPainter({
    required this.pulse,
    required this.corePulse,
    required this.pixelSize,
  });

  // Asymmetric hand-drawn-feel pixel heart. Right lobe is 1 cell wider
  // than left, bottom is offset 1 cell to the right of true center, and
  // a few pixels are nicked off the contour to look "rukodely".
  // Grid is 17 cols x 14 rows.
  static const List<String> _shape = [
    '...XXX....XXXX...',
    '..XXXXX..XXXXXX..',
    '.XXXXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXXXXX',
    'XXXXXXXXXXXXXXXXX',
    '.XXXXXXXXXXXXXXXX',
    '..XXXXXXXXXXXXXX.',
    '...XXXXXXXXXXXX..',
    '....XXXXXXXXXX...',
    '.....XXXXXXXX....',
    '......XXXXXX.....',
    '.......XXXX......',
    '........XX.......',
  ];

  static const Color _shellFill = Color(0xFFF5F0F8);
  static const Color _shellOutline = Color(0xFFE0D5E8);
  static const Color _coreLow = Color(0xFF9B9B9B);
  static const Color _coreHigh = Color(0xFFD0D0D0);

  @override
  void paint(Canvas canvas, Size size) {
    final cols = _shape[0].length;
    final rows = _shape.length;

    // Fit pixelSize so the heart occupies most of the painter rect.
    final fitPx = (size.width / cols).floor().clamp(2, 64).toDouble();
    final px = fitPx;

    final w = cols * px;
    final h = rows * px;

    final scale = 1.0 + 0.04 * pulse;

    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale, scale);

    // Soft glow behind heart, breathes with the core.
    final glowPaint = Paint()
      ..color = Colors.white.withValues(alpha:0.10 + 0.10 * corePulse)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 28);
    canvas.drawCircle(Offset.zero, w * 0.55, glowPaint);

    canvas.translate(-w / 2, -h / 2);

    final fillPaint = Paint()..color = _shellFill;
    final outlinePaint = Paint()..color = _shellOutline;

    for (int r = 0; r < rows; r++) {
      for (int c = 0; c < cols; c++) {
        if (_shape[r][c] != 'X') continue;
        final rect = Rect.fromLTWH(c * px, r * px, px, px);
        canvas.drawRect(rect, fillPaint);

        // Faint outline pixels: any 'X' adjacent to a non-X gets a darker
        // tone on the outer edge. Cheap pixel-art shading.
        final isEdge = _isEdgeCell(r, c);
        if (isEdge) {
          canvas.drawRect(
            Rect.fromLTWH(c * px, r * px, px, px),
            outlinePaint..color = _shellOutline.withValues(alpha: 0.6),
          );
          canvas.drawRect(
            Rect.fromLTWH(c * px + px * 0.15, r * px + px * 0.15,
                px * 0.7, px * 0.7),
            fillPaint,
          );
        }
      }
    }

    // Core: 2x2 pixel block, near visual center of heart (slightly above
    // geometric center so it sits in the upper half).
    final coreColor = Color.lerp(_coreLow, _coreHigh, corePulse)!;
    final corePaint = Paint()..color = coreColor;
    const coreCols = 2;
    const coreRows = 2;
    final coreCx = ((cols / 2) - coreCols / 2).floor().toDouble();
    final coreCy = ((rows / 2) - coreRows / 2 - 1).floor().toDouble();
    canvas.drawRect(
      Rect.fromLTWH(coreCx * px, coreCy * px, px * coreCols, px * coreRows),
      corePaint,
    );

    // Tiny inner highlight on core, shifts with corePulse.
    final hl = Paint()
      ..color = Colors.white.withValues(alpha:0.25 + 0.45 * corePulse);
    canvas.drawRect(
      Rect.fromLTWH(coreCx * px, coreCy * px, px, px),
      hl,
    );

    canvas.restore();
  }

  bool _isEdgeCell(int r, int c) {
    bool isFilled(int rr, int cc) {
      if (rr < 0 || rr >= _shape.length) return false;
      if (cc < 0 || cc >= _shape[rr].length) return false;
      return _shape[rr][cc] == 'X';
    }

    if (!isFilled(r, c)) return false;
    return !isFilled(r - 1, c) ||
        !isFilled(r + 1, c) ||
        !isFilled(r, c - 1) ||
        !isFilled(r, c + 1);
  }

  @override
  bool shouldRepaint(covariant _VesselHeartPainter old) =>
      pulse != old.pulse ||
      corePulse != old.corePulse ||
      pixelSize != old.pixelSize;
}
