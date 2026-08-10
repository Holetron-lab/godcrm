import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Radial bundle of segmented pixel wires emerging from screen center.
/// Inside each wire flows N23 — the white liquid that is "the creator's
/// particle" (project lore). White dots travel from center outward and
/// loop, with per-wire phase offset so the flow doesn't look synchronous.
class WireBundle extends StatelessWidget {
  final double progress;
  final int wireCount;
  final double pixelSize;
  final double startRadius;

  const WireBundle({
    super.key,
    required this.progress,
    this.wireCount = 7,
    this.pixelSize = 8,
    required this.startRadius,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _WireBundlePainter(
        progress: progress,
        wireCount: wireCount,
        pixelSize: pixelSize,
        startRadius: startRadius,
      ),
    );
  }
}

class _WireBundlePainter extends CustomPainter {
  final double progress;
  final int wireCount;
  final double pixelSize;
  final double startRadius;

  _WireBundlePainter({
    required this.progress,
    required this.wireCount,
    required this.pixelSize,
    required this.startRadius,
  });

  static const Color _wireLight = Color(0xFF4A6FE3);
  static const Color _wireDark = Color(0xFF2E4FB8);
  static const Color _wireSeam = Color(0xFF1F3B95);

  // Slight angular jitter so wires don't look mechanically equal.
  // Indexed 0..6; values in radians, kept stable across frames.
  static const List<double> _angleJitter = [
    0.05, -0.03, 0.07, -0.06, 0.02, -0.08, 0.04,
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    // Diagonal length so wires comfortably cross any edge of the screen.
    final maxR = math.sqrt(
            size.width * size.width + size.height * size.height) /
        2 +
        pixelSize * 4;

    final segLen = pixelSize * 2.0;
    final wireWidth = pixelSize * 1.6;

    const baseAngle = -math.pi / 2; // first wire points up
    final step = 2 * math.pi / wireCount;

    final lightPaint = Paint()
      ..color = _wireLight
      ..strokeWidth = wireWidth
      ..strokeCap = StrokeCap.butt
      ..isAntiAlias = false;
    final darkPaint = Paint()
      ..color = _wireDark
      ..strokeWidth = wireWidth
      ..strokeCap = StrokeCap.butt
      ..isAntiAlias = false;
    final seamPaint = Paint()
      ..color = _wireSeam
      ..strokeWidth = 1.2
      ..isAntiAlias = false;

    final n23Paint = Paint()
      ..color = Colors.white
      ..isAntiAlias = false;

    for (int i = 0; i < wireCount; i++) {
      final jitter = _angleJitter[i % _angleJitter.length];
      final angle = baseAngle + i * step + jitter;
      final dir = Offset(math.cos(angle), math.sin(angle));

      // Walk outward in alternating segments for the "Giger sectioned tube"
      // look: light, dark, light, dark...
      double r = startRadius;
      bool light = true;
      while (r < maxR) {
        final r2 = math.min(r + segLen, maxR);
        final p1 = center + dir * r;
        final p2 = center + dir * r2;
        canvas.drawLine(p1, p2, light ? lightPaint : darkPaint);
        // Seam line between segments.
        canvas.drawLine(
          center + dir * r2 + Offset(-dir.dy, dir.dx) * (wireWidth / 2),
          center + dir * r2 - Offset(-dir.dy, dir.dx) * (wireWidth / 2),
          seamPaint,
        );
        r += segLen;
        light = !light;
      }

      // N23 flow — white pixel head + 3-pixel fading tail.
      final phase = (progress + i * (1.0 / wireCount)) % 1.0;
      final headR = startRadius + phase * (maxR - startRadius);
      _drawN23Pixel(canvas, center, dir, headR, pixelSize, 1.0, n23Paint);
      for (int t = 1; t <= 3; t++) {
        final trailR = headR - t * pixelSize * 1.0;
        if (trailR <= startRadius) continue;
        _drawN23Pixel(
          canvas,
          center,
          dir,
          trailR,
          pixelSize,
          0.7 - t * 0.18,
          n23Paint,
        );
      }
    }
  }

  void _drawN23Pixel(
    Canvas canvas,
    Offset center,
    Offset dir,
    double r,
    double px,
    double opacity,
    Paint paint,
  ) {
    paint.color = Colors.white.withValues(alpha: opacity.clamp(0.0, 1.0));
    final p = center + dir * r;
    final size = px * 0.9;
    canvas.drawRect(
      Rect.fromCenter(center: p, width: size, height: size),
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _WireBundlePainter old) =>
      progress != old.progress ||
      wireCount != old.wireCount ||
      pixelSize != old.pixelSize ||
      startRadius != old.startRadius;
}
