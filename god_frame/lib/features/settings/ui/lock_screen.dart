import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../providers/app_lock_provider.dart';

/// Full-screen lock overlay — PIN or biometric.
class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key});

  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  String _pin = '';
  String _error = '';
  bool _biometricAttempted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _tryBiometric();
    });
  }

  Future<void> _tryBiometric() async {
    final lockState = ref.read(appLockProvider);
    if (lockState.type == AppLockType.biometric && !_biometricAttempted) {
      _biometricAttempted = true;
      final success = await ref.read(appLockProvider.notifier).unlockWithBiometric();
      if (!success && mounted) {
        setState(() => _error = 'Биометрия не распознана');
      }
    }
  }

  void _onDigit(String digit) {
    if (_pin.length >= 6) return;
    HapticFeedback.lightImpact();
    setState(() {
      _pin += digit;
      _error = '';
    });
    if (_pin.length == 4 || _pin.length == 6) {
      _tryUnlock();
    }
  }

  void _onDelete() {
    if (_pin.isEmpty) return;
    HapticFeedback.lightImpact();
    setState(() {
      _pin = _pin.substring(0, _pin.length - 1);
      _error = '';
    });
  }

  Future<void> _tryUnlock() async {
    final success = await ref.read(appLockProvider.notifier).unlockWithPin(_pin);
    if (!success && mounted) {
      HapticFeedback.heavyImpact();
      setState(() {
        _error = 'Неверный PIN';
        _pin = '';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final lockState = ref.watch(appLockProvider);

    return Scaffold(
      backgroundColor: GodTheme.background,
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            // Icon
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [GodTheme.primary, GodTheme.accent],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.lock_outline, color: Colors.white, size: 40),
            ),
            const SizedBox(height: 24),
            const Text(
              'GOD заблокирован',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: GodTheme.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              lockState.type == AppLockType.biometric
                  ? 'Используйте отпечаток или введите PIN'
                  : 'Введите PIN-код',
              style: const TextStyle(color: GodTheme.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 32),

            // PIN dots
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(4, (i) {
                final filled = i < _pin.length;
                return Container(
                  margin: const EdgeInsets.symmetric(horizontal: 8),
                  width: 16,
                  height: 16,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: filled ? GodTheme.primary : Colors.transparent,
                    border: Border.all(
                      color: filled ? GodTheme.primary : GodTheme.textMuted,
                      width: 2,
                    ),
                  ),
                );
              }),
            ),

            if (_error.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(_error, style: const TextStyle(color: GodTheme.error, fontSize: 13)),
            ],

            const Spacer(flex: 1),

            // Numpad
            _buildNumpad(),

            // Biometric button
            if (lockState.type == AppLockType.biometric)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: IconButton(
                  onPressed: () {
                    _biometricAttempted = false;
                    _tryBiometric();
                  },
                  icon: const Icon(Icons.fingerprint, size: 48, color: GodTheme.primary),
                ),
              ),

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildNumpad() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 48),
      child: Column(
        children: [
          _numRow(['1', '2', '3']),
          _numRow(['4', '5', '6']),
          _numRow(['7', '8', '9']),
          _numRow(['', '0', 'del']),
        ],
      ),
    );
  }

  Widget _numRow(List<String> keys) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: keys.map((key) {
          if (key.isEmpty) return const SizedBox(width: 72, height: 72);
          if (key == 'del') {
            return SizedBox(
              width: 72,
              height: 72,
              child: IconButton(
                onPressed: _onDelete,
                icon: const Icon(Icons.backspace_outlined, color: GodTheme.textSecondary),
              ),
            );
          }
          return SizedBox(
            width: 72,
            height: 72,
            child: Material(
              color: GodTheme.surfaceLight,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: () => _onDigit(key),
                child: Center(
                  child: Text(
                    key,
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w500,
                      color: GodTheme.textPrimary,
                    ),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
