import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import '../data/frame_repository.dart';
import '../../../core/config.dart';
import '../../../shared/services/foreground_service.dart';
import '../../../shared/services/ble_debug_logger.dart';
import '../../../shared/utils/api_client.dart';

/// Frame connection state for UI.
class FrameState {
  final FrameConnectionState connectionState;
  final FrameDevice? device;
  final String? error;

  const FrameState({
    this.connectionState = FrameConnectionState.disconnected,
    this.device,
    this.error,
  });

  bool get isConnected => connectionState == FrameConnectionState.connected;
  bool get isScanning => connectionState == FrameConnectionState.scanning;
  bool get isConnecting => connectionState == FrameConnectionState.connecting;

  FrameState copyWith({
    FrameConnectionState? connectionState,
    FrameDevice? device,
    String? error,
  }) {
    return FrameState(
      connectionState: connectionState ?? this.connectionState,
      device: device ?? this.device,
      error: error,
    );
  }
}

/// Frame repository provider (singleton).
final frameRepositoryProvider = Provider<FrameRepository>((ref) {
  final repo = FrameRepository();
  ref.onDispose(() => repo.dispose());
  return repo;
});

/// Frame connection state provider.
final frameConnectionProvider =
    StateNotifierProvider<FrameConnectionNotifier, FrameState>((ref) {
  final repo = ref.watch(frameRepositoryProvider);
  final dio = ref.watch(apiClientProvider);
  return FrameConnectionNotifier(repo, dio);
});

class FrameConnectionNotifier extends StateNotifier<FrameState> {
  final FrameRepository _repo;
  final _log = BleDebugLogger.instance;
  StreamSubscription? _stateSub;

  // Auto-reconnect state — "Never give up" pattern (NOA)
  // Key insight from Brilliant Labs NOA: NEVER stop trying to reconnect.
  // Their app uses timeout=365 days and infinite retries.
  bool _intentionalDisconnect = false;
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 999; // effectively infinite
  static const Duration _reconnectDelay = Duration(seconds: 1); // instant (was 5s)
  static const Duration _backoffMax = Duration(seconds: 30); // max backoff
  Timer? _reconnectTimer;

  // BLE keepalive timer — prevents Frame from sleeping during idle periods.
  // Frame disconnects after ~10-15s of no BLE activity.
  // We send a hold command every 5s while connected.
  Timer? _keepaliveTimer;

  FrameConnectionNotifier(this._repo, Dio dio) : super(const FrameState()) {
    // Set API client on BleDebugLogger early so remote upload works
    // even before Debug Panel is opened
    _log.setApiClient(dio);
    _log.info('PROVIDER', 'FrameConnectionNotifier created (remote logging ready)');

    _stateSub = _repo.stateStream.listen((connState) {
      if (!mounted) return;
      state = state.copyWith(connectionState: connState);

      if (connState == FrameConnectionState.disconnected ||
          connState == FrameConnectionState.error) {
        // Both disconnected AND error states should trigger reconnect.
        // BUG FIX: Previously, reconnect() emitted FrameConnectionState.error
        // on failure, but only .disconnected was handled here — breaking the
        // "never give up" loop after the first failed attempt.
        if (_intentionalDisconnect) {
          // User-initiated disconnect — stop foreground service, no reconnect
          _log.info('PROVIDER', 'Intentional disconnect — no reconnect');
          ForegroundServiceManager.stop();
          _log.logForegroundService(false);
          _reconnectAttempts = 0;
          _stopKeepalive();
        } else if (_repo.hasStoredDevice) {
          // Unexpected disconnect — ALWAYS attempt reconnect (NOA "never give up" pattern)
          _log.warning('PROVIDER', 'Unexpected disconnect/error — scheduling reconnect (attempt ${_reconnectAttempts + 1}, never give up)');
          _stopKeepalive();
          _scheduleReconnect();
        } else {
          // No stored device — try persisted UUID
          _log.warning('PROVIDER', 'No stored device in memory, trying persisted UUID...');
          _stopKeepalive();
          _tryReconnectFromPersisted();
        }
      } else if (connState == FrameConnectionState.connected) {
        // Successfully connected/reconnected — reset counters + start keepalive
        _log.info('PROVIDER', 'Connected — reset reconnect counters, starting keepalive');
        _reconnectAttempts = 0;
        _intentionalDisconnect = false;
        _startKeepalive();
      }
    });

    // Auto-connect to persisted device on launch (NOA pattern)
    // Deferred to avoid triggering permission dialogs during widget build,
    // which crashes the app when Android recreates the Activity.
    // Check for persisted device FIRST (sync) before scheduling async work.
    Future.delayed(const Duration(seconds: 5), () async {
      if (!mounted) return;
      // Pre-check: only auto-connect if there's a stored device.
      // This prevents permission dialogs on first launch or after clearing data.
      try {
        final deviceId = await FrameRepository.getPersistedDeviceId();
        if (deviceId == null || deviceId.isEmpty) return;
        if (!mounted) return;
        _tryAutoConnect();
      } catch (_) {
        // Ignore — no stored device or storage error
      }
    });
  }

  /// Try to auto-connect to the last connected device on app launch.
  /// Uses persisted device UUID — no scanning needed.
  /// IMPORTANT: Caller must verify persisted device exists before calling.
  Future<void> _tryAutoConnect() async {
    try {
      final deviceId = await FrameRepository.getPersistedDeviceId();
      if (deviceId == null || deviceId.isEmpty) {
        print('[Frame] No persisted device — skipping auto-connect');
        return;
      }

      final deviceName = await FrameRepository.getPersistedDeviceName() ?? 'Frame';
      print('[Frame] Found persisted device: $deviceId ($deviceName). Auto-connecting...');

      // Check permissions (non-interactive — only checks status, never shows dialogs).
      // This prevents the crash where permission dialog triggers Activity recreation.
      // Permissions are requested interactively only when user taps "Connect" (scan()).
      String? permError;
      try {
        permError = await _checkPermissions();
      } catch (e) {
        print('[Frame] Permission check crashed: $e');
        return;
      }
      if (!mounted) return;
      if (permError != null) {
        print('[Frame] Auto-connect skipped — permissions not granted');
        return;
      }

      // Check Bluetooth adapter
      final btError = await _checkBluetoothAdapter();
      if (!mounted) return;
      if (btError != null) {
        print('[Frame] Auto-connect skipped — Bluetooth off');
        return;
      }

      _intentionalDisconnect = false;
      _reconnectAttempts = 0;

      // Start foreground service before connecting (NOA pattern)
      // Skip requestNotificationPermission() — it shows a system dialog that
      // can crash the app during auto-connect. Only request in user-initiated connect().
      try {
        await ForegroundServiceManager.start(
          title: 'GOD Frame',
          text: 'Auto-connecting to $deviceName...',
        );
      } catch (e) {
        print('[Frame] Foreground service failed: $e');
        // Continue without foreground service
      }

      if (!mounted) return;
      final success = await _repo.connectByStoredId();

      if (success && mounted) {
        print('[Frame] Auto-connect succeeded to $deviceName');
        _log.info('AUTO', 'Auto-connect succeeded to $deviceName');
        state = state.copyWith(
          connectionState: FrameConnectionState.connected,
          error: null,
        );
        await ForegroundServiceManager.updateNotification(
          title: 'GOD Frame',
          text: 'Connected to $deviceName',
        );
        await ForegroundServiceManager.requestBatteryOptimization();

        // Start remote BLE log upload — sends logs to CRM every 30s
        // so we can debug BLE issues remotely without ADB access
        _log.startAutoUpload();

        // Start keepalive to prevent Frame sleep during idle
        _startKeepalive();
      } else if (mounted) {
        print('[Frame] Auto-connect failed — will schedule reconnect');
        _log.warning('AUTO', 'Auto-connect failed — scheduling reconnect');
        // Don't stop foreground service — keep trying (NOA pattern)
        _scheduleReconnect();
      }
    } catch (e, st) {
      print('[Frame] Auto-connect crashed: $e\n$st');
      _log.error('AUTO', 'Auto-connect crashed: $e');
      // Don't rethrow — auto-connect failure should never crash the app
    }
  }

  /// Start periodic BLE keepalive — sends hold every 5s to prevent Frame sleep.
  /// Frame glasses disconnect after ~10-15s of no BLE activity.
  /// This runs at the CONNECTION level (not just during voice mode).
  void _startKeepalive() {
    _keepaliveTimer?.cancel();
    _log.info('KEEPALIVE', 'Starting connection-level keepalive (every ${AppConfig.bleKeepaliveInterval.inSeconds}s)');
    _keepaliveTimer = Timer.periodic(AppConfig.bleKeepaliveInterval, (_) {
      if (_repo.isConnected && !_intentionalDisconnect) {
        _repo.sendHold().catchError((e) {
          _log.warning('KEEPALIVE', 'Hold failed: $e');
        });
      }
    });
  }

  /// Stop keepalive timer.
  void _stopKeepalive() {
    _keepaliveTimer?.cancel();
    _keepaliveTimer = null;
  }

  @override
  void dispose() {
    _reconnectTimer?.cancel();
    _keepaliveTimer?.cancel();
    _stateSub?.cancel();
    super.dispose();
  }

  /// Try to reconnect using persisted device UUID when no in-memory device.
  Future<void> _tryReconnectFromPersisted() async {
    final deviceId = await FrameRepository.getPersistedDeviceId();
    if (deviceId != null && deviceId.isNotEmpty) {
      _log.info('PROVIDER', 'Found persisted UUID: $deviceId — attempting reconnect');
      _reconnectAttempts = 0;
      final success = await _repo.connectByStoredId();
      if (success && mounted) {
        state = state.copyWith(
          connectionState: FrameConnectionState.connected,
          error: null,
        );
      }
    } else {
      _log.info('PROVIDER', 'No persisted device — stopping foreground service');
      ForegroundServiceManager.stop();
      _log.logForegroundService(false);
    }
  }

  /// Schedule an auto-reconnect attempt with exponential backoff.
  /// NOA pattern: never stop trying. Backoff: 1s, 2s, 4s, 8s, 16s, 30s max.
  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectAttempts++;
    final attempt = _reconnectAttempts;
    final deviceName = _repo.storedDeviceName ?? 'Frame';

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s...
    final backoffMs = (_reconnectDelay.inMilliseconds * (1 << (attempt - 1).clamp(0, 5)))
        .clamp(1000, _backoffMax.inMilliseconds);
    final delay = Duration(milliseconds: backoffMs);

    _log.logReconnect(attempt, reason: 'backoff ${delay.inSeconds}s (never give up)');

    // Update foreground service notification to show reconnecting status
    if (ForegroundServiceManager.isRunning) {
      ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: 'Reconnecting to $deviceName (attempt $attempt)...',
      );
    } else {
      // Ensure foreground service is running during reconnect attempts
      ForegroundServiceManager.start(
        title: 'GOD Frame',
        text: 'Reconnecting to $deviceName (attempt $attempt)...',
      );
    }

    _reconnectTimer = Timer(delay, () async {
      if (!mounted) return;
      if (_intentionalDisconnect) return; // User disconnected while waiting

      state = state.copyWith(
        connectionState: FrameConnectionState.connecting,
        error: null,
      );

      final success = await _repo.reconnect();

      if (success && mounted) {
        _log.info('RECONNECT', 'Auto-reconnect succeeded on attempt $attempt');
        _reconnectAttempts = 0; // Reset on success
        // Start auto-upload of BLE logs on successful connect
        final logger = BleDebugLogger.instance;
        if (!logger.autoUploadEnabled && logger.entryCount > 0) {
          logger.startAutoUpload();
        }
        // Update foreground service notification
        if (ForegroundServiceManager.isRunning) {
          ForegroundServiceManager.updateNotification(
            title: 'GOD Frame',
            text: 'Connected to $deviceName',
          );
        }
      } else if (mounted) {
        _log.error('RECONNECT', 'Auto-reconnect failed on attempt $attempt');
        // BUG FIX: Explicitly schedule next attempt instead of relying on
        // stateStream. The state listener ALSO handles this (for .error and
        // .disconnected), but as a safety net we schedule here too.
        // _scheduleReconnect() cancels any existing timer first, so no dupes.
        if (!_intentionalDisconnect) {
          _log.info('RECONNECT', 'Scheduling next attempt (never give up)...');
          _scheduleReconnect();
        }
      }
    });
  }

  /// Check if BLE permissions are already granted (non-interactive).
  /// Returns null if all granted, or error string if not.
  /// Does NOT show any system dialogs — safe to call during widget build.
  Future<String?> _checkPermissions() async {
    if (Platform.isAndroid) {
      final scan = await Permission.bluetoothScan.status;
      final connect = await Permission.bluetoothConnect.status;
      final location = await Permission.location.status;

      if (!scan.isGranted) return 'Bluetooth Scan permission not granted';
      if (!connect.isGranted) return 'Bluetooth Connect permission not granted';
      if (!location.isGranted) return 'Location permission not granted';
    }
    return null;
  }

  /// Request all required BLE permissions at runtime (interactive — shows system dialogs).
  /// Only call this from user-initiated actions (scan, connect), NOT from auto-connect.
  /// Returns null if all permissions granted, or error message string.
  Future<String?> _requestPermissions() async {
    if (Platform.isAndroid) {
      final permissions = <Permission>[
        Permission.bluetoothScan,
        Permission.bluetoothConnect,
        Permission.location,
      ];

      final statuses = await permissions.request();

      if (statuses[Permission.bluetoothScan] != null &&
          statuses[Permission.bluetoothScan]!.isDenied) {
        return 'Bluetooth Scan permission is required to find Frame glasses. '
            'Please grant it in Settings -> Apps -> GOD Frame -> Permissions.';
      }
      if (statuses[Permission.bluetoothScan] != null &&
          statuses[Permission.bluetoothScan]!.isPermanentlyDenied) {
        return 'Bluetooth Scan permission was permanently denied. '
            'Go to Settings -> Apps -> GOD Frame -> Permissions -> Nearby devices -> Allow.';
      }

      if (statuses[Permission.bluetoothConnect] != null &&
          statuses[Permission.bluetoothConnect]!.isDenied) {
        return 'Bluetooth Connect permission is required. '
            'Please grant it in Settings -> Apps -> GOD Frame -> Permissions.';
      }

      if (statuses[Permission.location] != null &&
          statuses[Permission.location]!.isDenied) {
        return 'Location permission is required for Bluetooth scanning on this Android version. '
            'Please grant it in Settings -> Apps -> GOD Frame -> Permissions.';
      }
    }
    return null;
  }

  /// Check if Bluetooth adapter is turned on.
  Future<String?> _checkBluetoothAdapter() async {
    final adapterState = await FlutterBluePlus.adapterState.first;
    if (adapterState != BluetoothAdapterState.on) {
      // Try to turn on Bluetooth (Android only)
      if (Platform.isAndroid) {
        try {
          await FlutterBluePlus.turnOn();
          // Wait a bit for adapter to turn on
          await Future.delayed(const Duration(seconds: 2));
          final newState = await FlutterBluePlus.adapterState.first;
          if (newState != BluetoothAdapterState.on) {
            return 'Bluetooth is turned off. Please enable Bluetooth in your phone settings.';
          }
        } catch (_) {
          return 'Bluetooth is turned off. Please enable Bluetooth in your phone settings.';
        }
      } else {
        return 'Bluetooth is turned off. Please enable Bluetooth in your phone settings.';
      }
    }
    return null; // Bluetooth is on
  }

  /// Scan for Frame glasses.
  Future<void> scan() async {
    state = state.copyWith(error: null);

    // Step 1: Request runtime permissions
    final permError = await _requestPermissions();
    if (permError != null) {
      state = state.copyWith(error: permError);
      return;
    }

    // Step 2: Check Bluetooth is on
    final btError = await _checkBluetoothAdapter();
    if (btError != null) {
      state = state.copyWith(error: btError);
      return;
    }

    // Step 3: Scan with service UUID filter first
    var device = await _repo.scan();

    // Step 4: If not found — fallback: scan without UUID filter, match by name
    if (device == null) {
      device = await _repo.scanByName();
    }

    if (device != null) {
      state = state.copyWith(device: device);
    } else {
      state = state.copyWith(
        error: 'No Frame glasses found.\n\n'
            '- Make sure Frame is powered on (open the hinge)\n'
            '- Keep Frame close to your phone\n'
            '- Check that Frame is not connected to another device\n'
            '- Try closing and reopening the Frame hinge to reset BLE',
      );
    }
  }

  /// Connect to found device.
  /// Key fix: Start foreground service BEFORE initiating BLE connect,
  /// so the app process stays alive during the connection handshake.
  Future<bool> connect() async {
    final device = state.device;
    if (device == null) return false;

    _intentionalDisconnect = false;
    _reconnectAttempts = 0;
    state = state.copyWith(error: null);

    // Start foreground service BEFORE BLE connect (NOA pattern).
    // This ensures the app process is not killed during BLE handshake
    // when the user switches away from the app.
    await ForegroundServiceManager.requestNotificationPermission();
    await ForegroundServiceManager.start(
      title: 'GOD Frame',
      text: 'Connecting to ${device.name}...',
    );
    _log.logForegroundService(true);

    _log.info('PROVIDER', 'Starting connect to ${device.name}...');
    final connected = await _repo.connect(device);
    if (!connected) {
      _log.error('PROVIDER', 'Connect failed for ${device.name}');
      state = state.copyWith(error: 'Failed to connect to Frame glasses. Try again.');
      await ForegroundServiceManager.stop();
      _log.logForegroundService(false);
    } else {
      _log.info('PROVIDER', 'Connect succeeded for ${device.name}');
      // Update foreground service notification to show connected status
      await ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: 'Connected to ${device.name}',
      );
      // Request battery optimization exemption
      await ForegroundServiceManager.requestBatteryOptimization();
      // Start remote BLE log auto-upload
      _log.startAutoUpload();
      // Start keepalive to prevent Frame sleep during idle
      _startKeepalive();
    }
    return connected;
  }

  /// Scan and connect in one step.
  Future<bool> scanAndConnect() async {
    await scan();
    if (state.device != null) {
      return await connect();
    }
    return false;
  }

  /// Disconnect (intentional — user-initiated).
  /// Does NOT clear persisted device — will auto-connect on next launch.
  Future<void> disconnect() async {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _keepaliveTimer?.cancel();
    _reconnectAttempts = 0;
    await _repo.disconnect();
    await ForegroundServiceManager.stop();
  }

  /// Forget device — disconnect AND clear persisted UUID.
  /// After this, app will NOT auto-connect on next launch.
  Future<void> forgetDevice() async {
    _intentionalDisconnect = true;
    _reconnectTimer?.cancel();
    _keepaliveTimer?.cancel();
    _reconnectAttempts = 0;
    await _repo.clearPersistedDevice();
    await _repo.disconnect();
    await ForegroundServiceManager.stop();
    state = const FrameState(); // Reset to initial state
  }
}

/// Stream of tap events from Frame.
final frameTapStreamProvider = StreamProvider<void>((ref) {
  final repo = ref.watch(frameRepositoryProvider);
  return repo.tapStream;
});

/// Stream of completed audio from Frame.
final frameAudioStreamProvider = StreamProvider<Uint8List>((ref) {
  final repo = ref.watch(frameRepositoryProvider);
  return repo.audioStream;
});

/// Stream of completed photo from Frame.
final framePhotoStreamProvider = StreamProvider<Uint8List>((ref) {
  final repo = ref.watch(frameRepositoryProvider);
  return repo.photoStream;
});
