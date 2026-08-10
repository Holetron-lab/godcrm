import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../providers/app_lock_provider.dart';

/// Screen for setting a new PIN code.
class SetPinScreen extends ConsumerStatefulWidget {
  const SetPinScreen({super.key});

  @override
  ConsumerState<SetPinScreen> createState() => _SetPinScreenState();
}

class _SetPinScreenState extends ConsumerState<SetPinScreen> {
  String _pin = '';
  String? _firstPin;
  String _title = 'Введите новый PIN';
  String _error = '';

  void _onDigit(String digit) {
    if (_pin.length >= 4) return;
    HapticFeedback.lightImpact();
    setState(() {
      _pin += digit;
      _error = '';
    });
    if (_pin.length == 4) {
      _onPinComplete();
    }
  }

  void _onDelete() {
    if (_pin.isEmpty) return;
    HapticFeedback.lightImpact();
    setState(() {
      _pin = _pin.substring(0, _pin.length - 1);
    });
  }

  void _onPinComplete() {
    if (_firstPin == null) {
      // First entry
      setState(() {
        _firstPin = _pin;
        _pin = '';
        _title = 'Повторите PIN';
      });
    } else {
      // Confirm
      if (_pin == _firstPin) {
        ref.read(appLockProvider.notifier).enablePin(_pin);
        Navigator.pop(context, true);
      } else {
        HapticFeedback.heavyImpact();
        setState(() {
          _error = 'PIN не совпадает';
          _pin = '';
          _firstPin = null;
          _title = 'Введите новый PIN';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GodTheme.background,
      appBar: AppBar(
        title: const Text('Установить PIN'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 1),
            Text(
              _title,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: GodTheme.textPrimary,
              ),
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
