import 'package:flutter/material.dart';

enum BitMode { bit8, bit16 }

/// Small `8bit / 16bit` toggle, monospace, top-right corner.
/// Active mode is bold + white; inactive is dimmed.
/// At spec stage 1 the visual does not change with mode — only state.
class BitToggle extends StatelessWidget {
  final BitMode mode;
  final ValueChanged<BitMode> onChanged;

  const BitToggle({super.key, required this.mode, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _modeText(
          label: '8bit',
          active: mode == BitMode.bit8,
          onTap: () => onChanged(BitMode.bit8),
        ),
        const Text(
          ' / ',
          style: TextStyle(
            color: Colors.white70,
            fontSize: 12,
            fontFamily: 'monospace',
          ),
        ),
        _modeText(
          label: '16bit',
          active: mode == BitMode.bit16,
          onTap: () => onChanged(BitMode.bit16),
        ),
      ],
    );
  }

  Widget _modeText({
    required String label,
    required bool active,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Text(
          label,
          style: TextStyle(
            color: active ? Colors.white : Colors.white60,
            fontSize: 12,
            fontWeight: active ? FontWeight.w700 : FontWeight.w400,
            fontFamily: 'monospace',
          ),
        ),
      ),
    );
  }
}
