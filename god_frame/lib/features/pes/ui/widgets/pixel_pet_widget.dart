import 'dart:math';
import 'package:flutter/material.dart';
import '../../data/pes_models.dart';

/// Pixel art pet renderer — generates unique pixel animal from seed + traits.
/// Neo-tamagotchi style: dark background, glowing pixels, retro feel.
class PixelPetWidget extends StatefulWidget {
  final PesStatus status;
  final double size;

  const PixelPetWidget({
    super.key,
    required this.status,
    this.size = 200,
  });

  @override
  State<PixelPetWidget> createState() => _PixelPetWidgetState();
}

class _PixelPetWidgetState extends State<PixelPetWidget>
    with SingleTickerProviderStateMixin {
  late AnimationController _breathController;
  late Animation<double> _breathAnimation;

  @override
  void initState() {
    super.initState();
    // Breathing animation — pet gently pulses
    _breathController = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: _breathSpeed),
    )..repeat(reverse: true);
    _breathAnimation = Tween<double>(begin: 0.97, end: 1.03).animate(
      CurvedAnimation(parent: _breathController, curve: Curves.easeInOut),
    );
  }

  int get _breathSpeed {
    final energy = widget.status.emotions.energy;
    // High energy = faster breathing, low energy = slower
    return (2500 - (energy * 1000)).clamp(1500, 3500).toInt();
  }

  @override
  void didUpdateWidget(PixelPetWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.status.emotions.energy != widget.status.emotions.energy) {
      _breathController.duration = Duration(milliseconds: _breathSpeed);
    }
  }

  @override
  void dispose() {
    _breathController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _breathAnimation,
      builder: (context, child) {
        return Transform.scale(
          scale: _breathAnimation.value,
          child: child,
        );
      },
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: RepaintBoundary(
          child: CustomPaint(
            painter: _PixelPetPainter(
              seed: widget.status.identity.seed,
              mood: widget.status.emotions.mood,
              energy: widget.status.emotions.energy,
              emotionState: widget.status.emotions.state,
              level: widget.status.level,
            ),
          ),
        ),
      ),
    );
  }
}

class _PixelPetPainter extends CustomPainter {
  final double seed;
  final double mood;
  final double energy;
  final String emotionState;
  final double level;

  _PixelPetPainter({
    required this.seed,
    required this.mood,
    required this.energy,
    required this.emotionState,
    required this.level,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final rng = Random((seed * 100000).toInt());
    final pixelSize = size.width / 16;

    // Generate base color from seed
    final hue = (seed * 360) % 360;
    final baseColor = HSLColor.fromAHSL(1.0, hue, 0.7, 0.5).toColor();
    final darkColor = HSLColor.fromAHSL(1.0, hue, 0.6, 0.3).toColor();
    final lightColor = HSLColor.fromAHSL(1.0, hue, 0.8, 0.7).toColor();

    // Eye color based on mood
    final eyeHue = mood > 0.6 ? 120.0 : (mood > 0.3 ? 60.0 : 0.0);
    final eyeColor = HSLColor.fromAHSL(1.0, eyeHue, 0.9, 0.6).toColor();

    // Glow effect for the pet
    final glowPaint = Paint()
      ..color = baseColor.withOpacity(0.15)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12);
    canvas.drawCircle(
      Offset(size.width / 2, size.height / 2),
      size.width * 0.35,
      glowPaint,
    );

    // Body shape — symmetric pixel pattern (8x16 grid, mirrored)
    final body = _generateBody(rng);
    for (int y = 0; y < 16; y++) {
      for (int x = 0; x < 8; x++) {
        if (body[y][x] == 0) continue;

        Color color;
        switch (body[y][x]) {
          case 1:
            color = baseColor;
            break;
          case 2:
            color = darkColor;
            break;
          case 3:
            color = lightColor;
            break;
          case 4:
            color = eyeColor;
            break;
          case 5: // Mouth
            color = mood > 0.5
                ? const Color(0xFFFF6B9D) // Happy pink
                : const Color(0xFF94A3B8); // Neutral gray
            break;
          default:
            color = baseColor;
        }

        final paint = Paint()..color = color;

        // Draw left side
        canvas.drawRect(
          Rect.fromLTWH(x * pixelSize, y * pixelSize, pixelSize, pixelSize),
          paint,
        );
        // Mirror right side
        final mirrorX = 15 - x;
        canvas.drawRect(
          Rect.fromLTWH(
              mirrorX * pixelSize, y * pixelSize, pixelSize, pixelSize),
          paint,
        );
      }
    }

    // Level indicator — small dots at bottom
    final levelDotPaint = Paint()..color = lightColor;
    final dots = level.clamp(1, 10).toInt();
    for (int i = 0; i < dots; i++) {
      final dotX = size.width / 2 + (i - dots / 2) * (pixelSize * 0.8);
      canvas.drawCircle(
        Offset(dotX, size.height - pixelSize * 0.3),
        pixelSize * 0.15,
        levelDotPaint,
      );
    }
  }

  List<List<int>> _generateBody(Random rng) {
    // 16 rows, 8 cols (left half, mirrored)
    // 0=empty, 1=base, 2=dark, 3=light, 4=eye, 5=mouth
    final grid = List.generate(16, (_) => List.filled(8, 0));

    // Head (rows 2-6)
    for (int y = 2; y <= 6; y++) {
      final width = y <= 3 ? 3 + rng.nextInt(2) : 4 + rng.nextInt(2);
      for (int x = 0; x < width.clamp(0, 8); x++) {
        grid[y][x] = (y == 2 || x == width - 1) ? 2 : 1;
      }
    }

    // Ears (rows 0-2) — random ear style
    final earStyle = rng.nextInt(3);
    if (earStyle == 0) {
      // Pointy ears
      grid[0][2] = 3;
      grid[1][2] = 1;
      grid[1][3] = 1;
    } else if (earStyle == 1) {
      // Round ears
      grid[1][3] = 1;
      grid[1][4] = 1;
      grid[0][3] = 3;
    } else {
      // Floppy ears
      grid[1][4] = 1;
      grid[2][5] = 2;
      grid[3][5] = 2;
    }

    // Eyes (row 4)
    grid[4][2] = 4;
    if (rng.nextBool()) grid[4][1] = 4; // Bigger eyes

    // Nose/mouth (row 5-6)
    grid[5][1] = 5;
    if (mood > 0.5) grid[6][1] = 5; // Smile line

    // Body (rows 7-12)
    for (int y = 7; y <= 12; y++) {
      final bodyWidth = 3 + rng.nextInt(3);
      for (int x = 0; x < bodyWidth.clamp(0, 8); x++) {
        final isEdge = x == bodyWidth - 1 || y == 7;
        grid[y][x] = isEdge ? 2 : 1;
      }
    }

    // Belly detail (rows 9-11)
    if (rng.nextBool()) {
      grid[9][1] = 3;
      grid[10][1] = 3;
      grid[10][2] = 3;
    }

    // Legs (rows 13-15)
    for (int y = 13; y <= 15; y++) {
      grid[y][1] = 2;
      grid[y][2 + rng.nextInt(2)] = 2;
    }

    // Tail (rows 8-10, far right)
    final tailLen = 1 + rng.nextInt(3);
    for (int i = 0; i < tailLen; i++) {
      final ty = 8 + i;
      if (ty < 16) grid[ty][6 + rng.nextInt(2).clamp(0, 1)] = 3;
    }

    return grid;
  }

  @override
  bool shouldRepaint(covariant _PixelPetPainter old) {
    return old.mood != mood ||
        old.energy != energy ||
        old.emotionState != emotionState;
  }
}
