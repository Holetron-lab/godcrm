import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'widgets/welcome/bit_toggle.dart';
import 'widgets/welcome/vessel_heart.dart';
import 'widgets/welcome/wire_bundle.dart';

/// PES onboarding stage 1 (NIKITRON spec, 2026-05-06).
///
/// Pastel-violet background, asymmetric pixel vessel-heart in the centre
/// with 7 segmented blue wires radiating outward. White N23 droplets
/// (creator's particle, project lore) flow along each wire from the heart
/// to the screen edge. Tiny `8bit / 16bit` toggle in the top-right —
/// state only at this stage; visual difference comes in stage 1.5.
///
/// All visuals are CustomPainter so NIKITRON can tune by numbers.
class PesWelcomeScreen extends StatefulWidget {
  const PesWelcomeScreen({super.key});

  @override
  State<PesWelcomeScreen> createState() => _PesWelcomeScreenState();
}

class _PesWelcomeScreenState extends State<PesWelcomeScreen>
    with SingleTickerProviderStateMixin {
  static const _kBitModeKey = 'pes.welcome.bit_mode';

  static const Color _bg = Color(0xFFD4C5F9);

  static const double _heartPulsePeriod = 1.5;
  static const double _corePulsePeriod = 1.2;
  static const double _n23FlowPeriod = 0.8;

  late final Ticker _ticker;
  double _t = 0;
  BitMode _mode = BitMode.bit16;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((elapsed) {
      setState(() {
        _t = elapsed.inMicroseconds / 1e6;
      });
    })
      ..start();
    _loadMode();
  }

  Future<void> _loadMode() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_kBitModeKey);
    if (!mounted) return;
    setState(() {
      _mode = stored == 'bit8' ? BitMode.bit8 : BitMode.bit16;
    });
  }

  Future<void> _setMode(BitMode m) async {
    setState(() => _mode = m);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _kBitModeKey,
      m == BitMode.bit8 ? 'bit8' : 'bit16',
    );
  }

  double _osc(double period) =>
      (math.sin(_t * 2 * math.pi / period) + 1) / 2;

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context).size;
    final screenMin = math.min(mq.width, mq.height);

    final heartSize = mq.width * 0.5;
    final pixelSize = (screenMin / 90).clamp(4.0, 12.0);
    final wireStartRadius = heartSize * 0.42;

    final pulse = _osc(_heartPulsePeriod);
    final corePulse = _osc(_corePulsePeriod);
    final flow = (_t / _n23FlowPeriod) % 1.0;

    return Scaffold(
      backgroundColor: _bg,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: WireBundle(
                progress: flow,
                wireCount: 7,
                pixelSize: pixelSize,
                startRadius: wireStartRadius,
              ),
            ),
            Center(
              child: SizedBox(
                width: heartSize,
                height: heartSize,
                child: VesselHeart(
                  pulse: pulse,
                  corePulse: corePulse,
                  pixelSize: pixelSize,
                ),
              ),
            ),
            Positioned(
              top: 12,
              right: 16,
              child: BitToggle(mode: _mode, onChanged: _setMode),
            ),
          ],
        ),
      ),
    );
  }
}
