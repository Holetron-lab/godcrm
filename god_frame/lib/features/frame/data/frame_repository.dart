import 'dart:async';
import 'dart:typed_data';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/config.dart';
import '../../../shared/services/ble_debug_logger.dart';

/// BLE connection states.
enum FrameConnectionState {
  disconnected,
  scanning,
  found,
  connecting,
  connected,
  error,
}

/// Brilliant Frame device info.
class FrameDevice {
  final BluetoothDevice device;
  final String name;
  final int rssi;

  const FrameDevice({required this.device, required this.name, required this.rssi});
}

/// Frame BLE message flags (from Noa protocol).
class FrameFlags {
  static const int tapFlag = 0x10;
  static const int startListeningFlag = 0x11;
  static const int stopListeningFlag = 0x12;
  static const int stopTapFlag = 0x13;
  static const int loopAheadFlag = 0x14;
  static const int checkFwVersionFlag = 0x16;
  static const int checkScriptVersionFlag = 0x17;
  static const int messageResponseFlag = 0x20;
  static const int imageResponseFlag = 0x21;
  static const int singleDataFlag = 0x22;
  static const int holdResponseFlag = 0x23;
  static const int audioNonFinal = 0x05;
  static const int audioFinal = 0x06;
  static const int photoNonFinal = 0x07;
  static const int photoFinal = 0x08;
  static const int tapEvent = 0x09;
}

/// Repository for BLE communication with Brilliant Frame glasses.
class FrameRepository {
  BluetoothDevice? _device;
  BluetoothCharacteristic? _txChar;
  BluetoothCharacteristic? _rxChar;
  StreamSubscription? _rxSubscription;
  StreamSubscription? _connectionSubscription;

  final _stateController = StreamController<FrameConnectionState>.broadcast();
  final _dataController = StreamController<Uint8List>.broadcast();
  final _tapController = StreamController<void>.broadcast();

  // Audio accumulator
  final List<int> _audioBuffer = [];
  final _audioCompleter = StreamController<Uint8List>.broadcast();

  // Photo accumulator
  final List<int> _photoBuffer = [];
  final _photoCompleter = StreamController<Uint8List>.broadcast();

  // Tap debounce
  DateTime? _lastTapTime;

  // Persisted device UUID keys
  static const String _prefKeyDeviceId = 'frame_device_remote_id';
  static const String _prefKeyDeviceName = 'frame_device_name';

  /// Stream of connection state changes.
  Stream<FrameConnectionState> get stateStream => _stateController.stream;

  /// Stream of raw data received from Frame.
  Stream<Uint8List> get dataStream => _dataController.stream;

  /// Stream of tap events from Frame.
  Stream<void> get tapStream => _tapController.stream;

  /// Stream of completed audio captures.
  Stream<Uint8List> get audioStream => _audioCompleter.stream;

  /// Stream of completed photo captures.
  Stream<Uint8List> get photoStream => _photoCompleter.stream;

  /// Whether currently connected.
  bool get isConnected => _device != null && _txChar != null && _rxChar != null;

  final _log = BleDebugLogger.instance;

  /// Scan for Brilliant Frame devices using service UUID filter.
  Future<FrameDevice?> scan({Duration timeout = const Duration(seconds: 15)}) async {
    _stateController.add(FrameConnectionState.scanning);
    _log.logScan('UUID-filtered', result: 'started (${timeout.inSeconds}s timeout)');

    try {
      // Stop any previous scan
      if (FlutterBluePlus.isScanningNow) {
        await FlutterBluePlus.stopScan();
        await Future.delayed(const Duration(milliseconds: 500));
      }

      FrameDevice? bestDevice;

      // Start scan with service UUID filter
      await FlutterBluePlus.startScan(
        timeout: timeout,
        withServices: [Guid(AppConfig.frameServiceUuid)],
        androidUsesFineLocation: true,
      );

      // Listen for results with timeout
      final completer = Completer<FrameDevice?>();
      StreamSubscription? sub;
      Timer? timer;

      timer = Timer(timeout, () {
        sub?.cancel();
        if (!completer.isCompleted) completer.complete(bestDevice);
      });

      sub = FlutterBluePlus.scanResults.listen((results) {
        for (final result in results) {
          final name = result.device.advName.isNotEmpty
              ? result.device.advName
              : result.device.platformName;
          if (name.isNotEmpty) {
            if (bestDevice == null || result.rssi > bestDevice!.rssi) {
              bestDevice = FrameDevice(
                device: result.device,
                name: name,
                rssi: result.rssi,
              );
            }
          }
        }
        // Found at least one device — wait 2 more seconds for better RSSI
        if (bestDevice != null) {
          timer?.cancel();
          timer = Timer(const Duration(seconds: 2), () {
            sub?.cancel();
            if (!completer.isCompleted) completer.complete(bestDevice);
          });
        }
      });

      final device = await completer.future;
      await FlutterBluePlus.stopScan();

      if (device != null) {
        _log.logScan('UUID-filtered', result: 'FOUND ${device.name} (${device.rssi} dBm)');
        _stateController.add(FrameConnectionState.found);
        return device;
      }

      _log.logScan('UUID-filtered', result: 'NOT FOUND');
      _stateController.add(FrameConnectionState.disconnected);
      return null;
    } catch (e) {
      _log.error('SCAN', 'UUID scan failed: $e');
      _stateController.add(FrameConnectionState.error);
      try { await FlutterBluePlus.stopScan(); } catch (_) {}
      return null;
    }
  }

  /// Fallback scan: no service UUID filter, match by device name.
  /// Some Frame firmware versions may not advertise the service UUID
  /// in their BLE advertisement packets.
  Future<FrameDevice?> scanByName({Duration timeout = const Duration(seconds: 10)}) async {
    _stateController.add(FrameConnectionState.scanning);
    _log.logScan('Name-based', result: 'started (${timeout.inSeconds}s timeout)');

    try {
      if (FlutterBluePlus.isScanningNow) {
        await FlutterBluePlus.stopScan();
        await Future.delayed(const Duration(milliseconds: 500));
      }

      FrameDevice? bestDevice;

      // Scan WITHOUT service UUID filter — find ALL BLE devices
      await FlutterBluePlus.startScan(
        timeout: timeout,
        androidUsesFineLocation: true,
      );

      final completer = Completer<FrameDevice?>();
      StreamSubscription? sub;
      Timer? timer;

      timer = Timer(timeout, () {
        sub?.cancel();
        if (!completer.isCompleted) completer.complete(bestDevice);
      });

      sub = FlutterBluePlus.scanResults.listen((results) {
        for (final result in results) {
          final advName = result.device.advName.isNotEmpty
              ? result.device.advName
              : result.device.platformName;
          final nameLower = advName.toLowerCase();

          // Match known Frame device names
          if (nameLower.contains('frame') ||
              nameLower.contains('brilliant') ||
              nameLower.contains('monocle') ||
              nameLower.startsWith('fr')) {
            if (bestDevice == null || result.rssi > bestDevice!.rssi) {
              bestDevice = FrameDevice(
                device: result.device,
                name: advName,
                rssi: result.rssi,
              );
            }
          }
        }
        if (bestDevice != null) {
          timer?.cancel();
          timer = Timer(const Duration(seconds: 2), () {
            sub?.cancel();
            if (!completer.isCompleted) completer.complete(bestDevice);
          });
        }
      });

      final device = await completer.future;
      await FlutterBluePlus.stopScan();

      if (device != null) {
        _log.logScan('Name-based', result: 'FOUND ${device.name} (${device.rssi} dBm)');
        _stateController.add(FrameConnectionState.found);
        return device;
      }

      _log.logScan('Name-based', result: 'NOT FOUND');
      _stateController.add(FrameConnectionState.disconnected);
      return null;
    } catch (e) {
      _log.error('SCAN', 'Name scan failed: $e');
      _stateController.add(FrameConnectionState.error);
      try { await FlutterBluePlus.stopScan(); } catch (_) {}
      return null;
    }
  }

  /// Connect to a Brilliant Frame device.
  Future<bool> connect(FrameDevice frameDevice) async {
    _stateController.add(FrameConnectionState.connecting);
    _log.logConnectionStateChange('connecting');
    _log.logDevice(frameDevice.name, frameDevice.device.remoteId.str, frameDevice.rssi);

    try {
      _device = frameDevice.device;

      // Connect
      _log.info('BLE', 'Connecting (timeout=${AppConfig.bleTimeout.inSeconds}s)...');
      await _device!.connect(timeout: AppConfig.bleTimeout);
      _log.info('BLE', 'BLE connect() completed');

      // Request higher MTU on Android
      await _device!.requestMtu(512);
      final mtu = await _device!.mtu.first;
      _log.logMtu(mtu);

      // Discover services
      _log.info('SERVICES', 'Discovering services...');
      final services = await _device!.discoverServices();

      // Find Frame service
      for (final service in services) {
        if (service.uuid.toString().toLowerCase() == AppConfig.frameServiceUuid) {
          for (final char in service.characteristics) {
            final uuid = char.uuid.toString().toLowerCase();
            if (uuid == AppConfig.frameTxUuid) {
              _txChar = char;
            }
            if (uuid == AppConfig.frameRxUuid) {
              _rxChar = char;
            }
          }
        }
      }

      _log.logServiceDiscovery(services.length, _txChar != null, _rxChar != null);

      if (_txChar == null || _rxChar == null) {
        _log.error('SERVICES', 'TX or RX characteristic not found!');
        await disconnect();
        _stateController.add(FrameConnectionState.error);
        return false;
      }

      // Enable notifications on RX
      await _rxChar!.setNotifyValue(true);
      _log.info('BLE', 'RX notifications enabled');
      _rxSubscription = _rxChar!.onValueReceived.listen(_handleRxData);

      // Monitor connection state
      _connectionSubscription = _device!.connectionState.listen((state) {
        if (state == BluetoothConnectionState.disconnected) {
          _log.logConnectionStateChange('disconnected', reason: 'BLE state change');
          _stateController.add(FrameConnectionState.disconnected);
          _cleanup();
        }
      });

      _stateController.add(FrameConnectionState.connected);
      _log.logConnectionStateChange('connected');

      // Persist device ID for auto-reconnect on next app launch
      await _persistDeviceId(_device!, frameDevice.name);

      return true;
    } catch (e) {
      _log.error('BLE', 'Connect failed: $e');
      await disconnect();
      _stateController.add(FrameConnectionState.error);
      return false;
    }
  }

  /// Reconnect to the last known device.
  /// Uses stored _device reference to reconnect without scanning.
  Future<bool> reconnect() async {
    if (_device == null) {
      _log.warning('RECONNECT', 'No stored device for reconnect');
      return false;
    }

    // Clean up existing subscriptions before reconnecting
    await _cleanup();

    _stateController.add(FrameConnectionState.connecting);
    _log.logConnectionStateChange('connecting', reason: 'reconnect');

    try {
      _log.info('RECONNECT', 'Attempting reconnect to ${_device!.remoteId.str}...');
      await _device!.connect(timeout: AppConfig.bleTimeout);
      _log.info('RECONNECT', 'BLE connect() completed');

      await _device!.requestMtu(512);
      final mtu = await _device!.mtu.first;
      _log.logMtu(mtu);

      final services = await _device!.discoverServices();

      _txChar = null;
      _rxChar = null;

      for (final service in services) {
        if (service.uuid.toString().toLowerCase() == AppConfig.frameServiceUuid) {
          for (final char in service.characteristics) {
            final uuid = char.uuid.toString().toLowerCase();
            if (uuid == AppConfig.frameTxUuid) {
              _txChar = char;
            }
            if (uuid == AppConfig.frameRxUuid) {
              _rxChar = char;
            }
          }
        }
      }

      _log.logServiceDiscovery(services.length, _txChar != null, _rxChar != null);

      if (_txChar == null || _rxChar == null) {
        _log.error('RECONNECT', 'TX or RX characteristic not found after reconnect');
        _stateController.add(FrameConnectionState.error);
        return false;
      }

      await _rxChar!.setNotifyValue(true);
      _log.info('RECONNECT', 'RX notifications re-enabled');
      _rxSubscription = _rxChar!.onValueReceived.listen(_handleRxData);

      _connectionSubscription = _device!.connectionState.listen((state) {
        if (state == BluetoothConnectionState.disconnected) {
          _log.logConnectionStateChange('disconnected', reason: 'BLE state change after reconnect');
          _stateController.add(FrameConnectionState.disconnected);
          _cleanup();
        }
      });

      _stateController.add(FrameConnectionState.connected);
      _log.logConnectionStateChange('connected', reason: 'reconnect successful');
      return true;
    } catch (e) {
      _log.error('RECONNECT', 'Reconnect failed: $e');
      _stateController.add(FrameConnectionState.error);
      return false;
    }
  }

  /// Whether there is a stored device reference for reconnection.
  bool get hasStoredDevice => _device != null;

  /// Get the stored device name (for logging/notification).
  String? get storedDeviceName {
    if (_device == null) return null;
    final name = _device!.advName.isNotEmpty ? _device!.advName : _device!.platformName;
    return name.isNotEmpty ? name : null;
  }

  // ─── Persisted Device UUID ───────────────────────────────────

  /// Save the connected device's remoteId to SharedPreferences.
  /// This allows auto-reconnect on next app launch without scanning.
  Future<void> _persistDeviceId(BluetoothDevice device, String name) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKeyDeviceId, device.remoteId.str);
      await prefs.setString(_prefKeyDeviceName, name);
      print('[Frame BLE] Persisted device: ${device.remoteId.str} ($name)');
    } catch (e) {
      print('[Frame BLE] Failed to persist device ID: $e');
    }
  }

  /// Load persisted device ID from SharedPreferences.
  static Future<String?> getPersistedDeviceId() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_prefKeyDeviceId);
    } catch (_) {
      return null;
    }
  }

  /// Load persisted device name from SharedPreferences.
  static Future<String?> getPersistedDeviceName() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_prefKeyDeviceName);
    } catch (_) {
      return null;
    }
  }

  /// Clear persisted device (used on intentional disconnect / forget).
  Future<void> clearPersistedDevice() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_prefKeyDeviceId);
      await prefs.remove(_prefKeyDeviceName);
      print('[Frame BLE] Cleared persisted device');
    } catch (_) {}
  }

  /// Connect directly to a device by its persisted remoteId (no scanning needed).
  /// This is the NOA pattern: on app launch, immediately try to connect
  /// to the previously paired device using its stored BLE address/UUID.
  Future<bool> connectByStoredId() async {
    final remoteId = await getPersistedDeviceId();
    if (remoteId == null || remoteId.isEmpty) {
      _log.info('AUTO', 'No persisted device ID found');
      return false;
    }

    final deviceName = await getPersistedDeviceName() ?? 'Frame';
    _log.info('AUTO', 'Auto-connecting to persisted device: $remoteId ($deviceName)');

    _stateController.add(FrameConnectionState.connecting);
    _log.logConnectionStateChange('connecting', reason: 'auto-connect by stored ID');

    try {
      // Create BluetoothDevice from stored remoteId — no scanning required
      _device = BluetoothDevice.fromId(remoteId);
      _log.debug('AUTO', 'Created BluetoothDevice from stored ID');

      // NOA pattern: autoConnect=false on Android + explicit long timeout.
      // autoConnect=true is unreliable on many Android devices — NOA specifically
      // uses autoConnect=false with a 365-day timeout for reliable connection.
      _log.info('AUTO', 'Connecting with 60s timeout, autoConnect=false (NOA pattern)...');
      await _device!.connect(
        timeout: const Duration(seconds: 60),
        autoConnect: false, // NOA pattern: explicit connect, not Android auto
      );
      _log.info('AUTO', 'BLE connect() completed');

      // Request higher MTU
      await _device!.requestMtu(512);
      final mtu = await _device!.mtu.first;
      _log.logMtu(mtu);

      // Discover services
      _log.info('SERVICES', 'Discovering services (auto-connect)...');
      final services = await _device!.discoverServices();

      _txChar = null;
      _rxChar = null;

      for (final service in services) {
        if (service.uuid.toString().toLowerCase() == AppConfig.frameServiceUuid) {
          for (final char in service.characteristics) {
            final uuid = char.uuid.toString().toLowerCase();
            if (uuid == AppConfig.frameTxUuid) {
              _txChar = char;
            }
            if (uuid == AppConfig.frameRxUuid) {
              _rxChar = char;
            }
          }
        }
      }

      _log.logServiceDiscovery(services.length, _txChar != null, _rxChar != null);

      if (_txChar == null || _rxChar == null) {
        _log.error('AUTO', 'Service/chars not found after auto-connect');
        _stateController.add(FrameConnectionState.error);
        return false;
      }

      await _rxChar!.setNotifyValue(true);
      _log.info('AUTO', 'RX notifications enabled');
      _rxSubscription = _rxChar!.onValueReceived.listen(_handleRxData);

      _connectionSubscription = _device!.connectionState.listen((state) {
        if (state == BluetoothConnectionState.disconnected) {
          _log.logConnectionStateChange('disconnected', reason: 'BLE state change after auto-connect');
          _stateController.add(FrameConnectionState.disconnected);
          _cleanup();
        }
      });

      _stateController.add(FrameConnectionState.connected);
      _log.logConnectionStateChange('connected', reason: 'auto-connect to $deviceName');
      _log.logDevice(deviceName, remoteId, 0);
      return true;
    } catch (e) {
      _log.error('AUTO', 'Auto-connect failed: $e');
      _device = null;
      _stateController.add(FrameConnectionState.disconnected);
      return false;
    }
  }

  /// Disconnect from Frame.
  Future<void> disconnect() async {
    _log.info('BLE', 'Disconnect requested');
    await _cleanup();
    try {
      await _device?.disconnect();
    } catch (_) {}
    _device = null;
    _stateController.add(FrameConnectionState.disconnected);
    _log.logConnectionStateChange('disconnected', reason: 'user/system disconnect');
  }

  /// Send a Lua string command to Frame.
  Future<void> sendLua(String luaCode) async {
    if (_txChar == null) return;
    final bytes = Uint8List.fromList(luaCode.codeUnits);
    await _txChar!.write(bytes, withoutResponse: true);
  }

  /// Send raw data to Frame with message flag.
  Future<void> sendData(int flag, Uint8List data) async {
    if (_txChar == null) {
      _log.warning('TX', 'Cannot send — TX characteristic is null');
      return;
    }
    _log.logTx(flag, data.length);

    // Prepend 0x01 + flag + length + data
    final payload = Uint8List(4 + data.length);
    payload[0] = 0x01;
    payload[1] = flag;
    payload[2] = (data.length >> 8) & 0xFF;
    payload[3] = data.length & 0xFF;
    payload.setAll(4, data);

    // Chunk if needed (MTU - 3 for overhead)
    final mtu = await _device?.mtu.first ?? 23;
    final chunkSize = mtu - 4;

    if (payload.length <= chunkSize + 3) {
      await _txChar!.write(payload, withoutResponse: true);
    } else {
      // Send in chunks
      for (var i = 0; i < payload.length; i += chunkSize) {
        final end = (i + chunkSize) > payload.length ? payload.length : i + chunkSize;
        await _txChar!.write(payload.sublist(i, end), withoutResponse: true);
        await Future.delayed(const Duration(milliseconds: 10));
      }
    }
  }

  /// Send a single-byte command via singleDataFlag.
  Future<void> sendSingleCommand(int command) async {
    await sendData(FrameFlags.singleDataFlag, Uint8List.fromList([command]));
  }

  /// Start audio + photo capture on Frame (triggered by tap).
  Future<void> startCapture() async {
    _audioBuffer.clear();
    _photoBuffer.clear();
    await sendData(FrameFlags.startListeningFlag, Uint8List(0));
  }

  /// Stop capture on Frame.
  Future<void> stopCapture() async {
    await sendData(FrameFlags.stopListeningFlag, Uint8List(0));
  }

  /// Send text response to display on Frame.
  Future<void> displayText(String text) async {
    // Encode text as TxRichText format
    final textBytes = Uint8List.fromList(text.codeUnits);
    await sendData(FrameFlags.messageResponseFlag, textBytes);
  }

  /// Send hold/keepalive to prevent Frame sleep.
  Future<void> sendHold() async {
    await sendData(FrameFlags.holdResponseFlag, Uint8List(0));
  }

  /// Send calendar events to display on Frame idle screen.
  /// Format: up to 3 lines of "HH:MM EventTitle" separated by newlines.
  /// Uses singleDataFlag (0x22) with cmd byte 0x03 for events display.
  Future<void> displayEvents(String eventsText) async {
    final payload = Uint8List.fromList([0x03, ...eventsText.codeUnits]);
    await sendData(FrameFlags.singleDataFlag, payload);
  }

  /// Handle incoming RX data from Frame.
  void _handleRxData(List<int> data) {
    if (data.isEmpty) return;

    final bytes = Uint8List.fromList(data);
    _dataController.add(bytes);

    final firstByte = bytes[0];
    _log.logRx(firstByte, bytes.length);

    // Handle raw unframed tap event from Lua script.
    // Frame Lua sends: frame.bluetooth.send(string.char(0x10))
    // which arrives as a single byte [0x10] WITHOUT 0x01 prefix.
    // NOTE: stopTapFlag (0x13) is a tap RELEASE — NOT a new tap!
    if (firstByte == FrameFlags.stopTapFlag) {
      _log.info('TAP', 'Tap release (0x13) ignored — not a new tap');
      return;
    }
    if (firstByte == FrameFlags.tapFlag ||
        firstByte == FrameFlags.tapEvent) {
      // Debounce: ignore taps within 500ms of each other
      final now = DateTime.now();
      if (_lastTapTime != null &&
          now.difference(_lastTapTime!).inMilliseconds < 500) {
        _log.info('TAP', 'Debounced tap ignored (${now.difference(_lastTapTime!).inMilliseconds}ms)');
        return;
      }
      _lastTapTime = now;
      _log.logTap();
      _tapController.add(null);
      return;
    }

    // Handle framed data (starts with 0x01) — audio, photo, and other payloads.
    // Format: [0x01, flag, len_hi, len_lo, ...data]
    if (bytes.length >= 2 && firstByte == 0x01) {
      final flag = bytes[1];

      switch (flag) {
        case FrameFlags.tapEvent:
        case FrameFlags.tapFlag:
          print('[Frame BLE] Tap event received (framed, flag: 0x${flag.toRadixString(16)})');
          _tapController.add(null);
          break;

        case FrameFlags.audioNonFinal:
          if (bytes.length > 4) {
            _audioBuffer.addAll(bytes.sublist(4));
          } else if (bytes.length > 2) {
            _audioBuffer.addAll(bytes.sublist(2));
          }
          _log.logAudioChunk(bytes.length);
          break;

        case FrameFlags.audioFinal:
          if (bytes.length > 4) {
            _audioBuffer.addAll(bytes.sublist(4));
          } else if (bytes.length > 2) {
            _audioBuffer.addAll(bytes.sublist(2));
          }
          _log.logAudioChunk(_audioBuffer.length, isFinal: true);
          _audioCompleter.add(Uint8List.fromList(_audioBuffer));
          _audioBuffer.clear();
          break;

        case FrameFlags.photoNonFinal:
          if (bytes.length > 4) {
            _photoBuffer.addAll(bytes.sublist(4));
          } else if (bytes.length > 2) {
            _photoBuffer.addAll(bytes.sublist(2));
          }
          _log.logPhotoChunk(bytes.length);
          break;

        case FrameFlags.photoFinal:
          if (bytes.length > 4) {
            _photoBuffer.addAll(bytes.sublist(4));
          } else if (bytes.length > 2) {
            _photoBuffer.addAll(bytes.sublist(2));
          }
          _log.logPhotoChunk(_photoBuffer.length, isFinal: true);
          _photoCompleter.add(Uint8List.fromList(_photoBuffer));
          _photoBuffer.clear();
          break;

        default:
          _log.warning('RX', 'Unknown framed flag: 0x${flag.toRadixString(16)}, len=${bytes.length}');
      }
    }
  }

  Future<void> _cleanup() async {
    await _rxSubscription?.cancel();
    await _connectionSubscription?.cancel();
    _rxSubscription = null;
    _connectionSubscription = null;
    _txChar = null;
    _rxChar = null;
  }

  /// Dispose all streams.
  void dispose() {
    _cleanup();
    _stateController.close();
    _dataController.close();
    _tapController.close();
    _audioCompleter.close();
    _photoCompleter.close();
  }
}
