import 'dart:math';
import 'package:flutter/material.dart';
import '../../../../core/theme.dart';

/// Radar chart showing pet traits (White Fang system).
class TraitsRadar extends StatelessWidget {
  final Map<String, double> traits;
  final double size;

  const TraitsRadar({
    super.key,
    required this.traits,
    this.size = 180,
  });

  @override
  Widget build(BuildContext context) {
    if (traits.isEmpty) {
      return SizedBox(
        height: size,
        child: const Center(
          child: Text('No traits yet', style: TextStyle(color: GodTheme.textMuted)),
        ),
      );
    }

    return SizedBox(
      width: size,
      height: size,
      child: RepaintBoundary(
        child: CustomPaint(
          painter: _RadarPainter(traits: traits),
        ),
      ),
    );
  }
}

class _RadarPainter extends CustomPainter {
  final Map<String, double> traits;

  _RadarPainter({required this.traits});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width * 0.38;
    final entries = traits.entries.toList();
    final count = entries.length;
    if (count < 3) return;

    final angleStep = 2 * pi / count;

    // Draw grid rings
    final gridPaint = Paint()
      ..color = GodTheme.border.withOpacity(0.3)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.5;

    for (int ring = 1; ring <= 3; ring++) {
      final r = radius * ring / 3;
      final path = Path();
      for (int i = 0; i <= count; i++) {
        final angle = -pi / 2 + angleStep * (i % count);
        final point = Offset(
          center.dx + r * cos(angle),
          center.dy + r * sin(angle),
        );
        if (i == 0) {
          path.moveTo(point.dx, point.dy);
        } else {
          path.lineTo(point.dx, point.dy);
        }
      }
      canvas.drawPath(path, gridPaint);
    }

    // Draw axes
    for (int i = 0; i < count; i++) {
      final angle = -pi / 2 + angleStep * i;
      final end = Offset(
        center.dx + radius * cos(angle),
        center.dy + radius * sin(angle),
      );
      canvas.drawLine(center, end, gridPaint);
    }

    // Draw data polygon
    final dataPath = Path();
    final dataPaint = Paint()
      ..color = GodTheme.primary.withOpacity(0.3)
      ..style = PaintingStyle.fill;
    final dataStrokePaint = Paint()
      ..color = GodTheme.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    for (int i = 0; i <= count; i++) {
      final idx = i % count;
      final value = entries[idx].value.clamp(0, 1);
      final angle = -pi / 2 + angleStep * idx;
      final r = radius * value;
      final point = Offset(
        center.dx + r * cos(angle),
        center.dy + r * sin(angle),
      );
      if (i == 0) {
        dataPath.moveTo(point.dx, point.dy);
      } else {
        dataPath.lineTo(point.dx, point.dy);
      }
    }

    canvas.drawPath(dataPath, dataPaint);
    canvas.drawPath(dataPath, dataStrokePaint);

    // Draw dots and labels
    final dotPaint = Paint()..color = GodTheme.primaryLight;
    final textStyle = TextStyle(
      color: GodTheme.textMuted,
      fontSize: 9,
      fontWeight: FontWeight.w500,
    );

    for (int i = 0; i < count; i++) {
      final value = entries[i].value.clamp(0.0, 1.0);
      final angle = -pi / 2 + angleStep * i;
      final r = radius * value;
      final point = Offset(
        center.dx + r * cos(angle),
        center.dy + r * sin(angle),
      );
      canvas.drawCircle(point, 3, dotPaint);

      // Label
      final labelOffset = Offset(
        center.dx + (radius + 14) * cos(angle),
        center.dy + (radius + 14) * sin(angle),
      );
      final tp = TextPainter(
        text: TextSpan(text: entries[i].key, style: textStyle),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(
        canvas,
        Offset(labelOffset.dx - tp.width / 2, labelOffset.dy - tp.height / 2),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RadarPainter old) => true;
}
