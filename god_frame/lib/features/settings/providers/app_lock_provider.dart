import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Lock type options.
enum AppLockType { none, pin, biometric }

/// App lock state.
class AppLockState {
  final bool enabled;
  final AppLockType type;
  final bool isLocked;
  final bool isAuthenticating;

  const AppLockState({
    this.enabled = false,
    this.type = AppLockType.none,
    this.isLocked = false,
    this.isAuthenticating = false,
  });

  AppLockState copyWith({bool? enabled, AppLockType? type, bool? isLocked, bool? isAuthenticating}) {
    return AppLockState(
      enabled: enabled ?? this.enabled,
      type: type ?? this.type,
      isLocked: isLocked ?? this.isLocked,
      isAuthenticating: isAuthenticating ?? this.isAuthenticating,
    );
  }
}

/// App lock notifier — manages lock settings and state.
class AppLockNotifier extends StateNotifier<AppLockState> {
  final LocalAuthentication _localAuth = LocalAuthentication();

  static const _enabledKey = 'app_lock_enabled';
  static const _typeKey = 'app_lock_type';
  static const _pinKey = 'app_lock_pin_v2';

  AppLockNotifier() : super(const AppLockState()) {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final enabled = prefs.getBool(_enabledKey) ?? false;
    final typeStr = prefs.getString(_typeKey) ?? 'none';
    final type = AppLockType.values.firstWhere(
      (t) => t.name == typeStr,
      orElse: () => AppLockType.none,
    );
    state = AppLockState(enabled: enabled, type: type, isLocked: false);
  }

  /// Check if device supports biometrics.
  Future<bool> canUseBiometrics() async {
    try {
      final canAuth = await _localAuth.canCheckBiometrics;
      final isSupported = await _localAuth.isDeviceSupported();
      return canAuth && isSupported;
    } catch (_) {
      return false;
    }
  }

  /// Get available biometric types.
  Future<List<BiometricType>> getAvailableBiometrics() async {
    try {
      return await _localAuth.getAvailableBiometrics();
    } catch (_) {
      return [];
    }
  }

  /// Enable PIN lock — stores PIN in SharedPreferences (reliable across restarts).
  Future<void> enablePin(String pin) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_pinKey, pin);
    await prefs.setBool(_enabledKey, true);
    await prefs.setString(_typeKey, AppLockType.pin.name);
    state = state.copyWith(enabled: true, type: AppLockType.pin);
  }

  /// Enable biometric lock with backup PIN.
  Future<void> enableBiometric({String? backupPin}) async {
    final prefs = await SharedPreferences.getInstance();
    if (backupPin != null) {
      await prefs.setString(_pinKey, backupPin);
    }
    await prefs.setBool(_enabledKey, true);
    await prefs.setString(_typeKey, AppLockType.biometric.name);
    state = state.copyWith(enabled: true, type: AppLockType.biometric);
  }

  /// Disable lock.
  Future<void> disable() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_pinKey);
    await prefs.setBool(_enabledKey, false);
    await prefs.setString(_typeKey, AppLockType.none.name);
    state = state.copyWith(enabled: false, type: AppLockType.none, isLocked: false);
  }

  /// Lock the app (called when app goes to background).
  void lock() {
    // Don't lock while biometric dialog is showing
    if (state.enabled && !state.isAuthenticating) {
      state = state.copyWith(isLocked: true);
    }
  }

  /// Unlock with PIN.
  Future<bool> unlockWithPin(String pin) async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_pinKey);
    if (stored != null && stored == pin) {
      state = state.copyWith(isLocked: false);
      return true;
    }
    return false;
  }

  /// Unlock with biometrics.
  Future<bool> unlockWithBiometric() async {
    try {
      state = state.copyWith(isAuthenticating: true);
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Разблокировать GOD',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: false,
        ),
      );
      state = state.copyWith(
        isLocked: authenticated ? false : state.isLocked,
        isAuthenticating: false,
      );
      return authenticated;
    } catch (_) {
      state = state.copyWith(isAuthenticating: false);
      return false;
    }
  }

  /// Change PIN.
  Future<void> changePin(String newPin) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_pinKey, newPin);
  }
}

/// Provider for app lock state.
final appLockProvider = StateNotifierProvider<AppLockNotifier, AppLockState>((ref) {
  return AppLockNotifier();
});
