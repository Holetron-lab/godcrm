import 'dart:async';
import 'dart:collection';
import 'package:dio/dio.dart';

/// Log severity levels for BLE debug events.
enum BleLogLevel {
  debug,
  info,
  warning,
  error,
}

/// A single BLE debug log entry.
class BleLogEntry {
  final DateTime timestamp;
  final BleLogLevel level;
  final String category;
  final String message;
  final Map<String, dynamic>? data;

  const BleLogEntry({
    required this.timestamp,
    required this.level,
    required this.category,
    required this.message,
    this.data,
  });

  String get levelIcon {
    switch (level) {
      case BleLogLevel.debug:
        return '🔍';
      case BleLogLevel.info:
        return 'ℹ️';
      case BleLogLevel.warning:
        return '⚠️';
      case BleLogLevel.error:
        return '❌';
    }
  }

  String get levelName {
    switch (level) {
      case BleLogLevel.debug:
        return 'DBG';
      case BleLogLevel.info:
        return 'INF';
      case BleLogLevel.warning:
        return 'WRN';
      case BleLogLevel.error:
        return 'ERR';
    }
  }

  String get timeStr {
    final h = timestamp.hour.toString().padLeft(2, '0');
    final m = timestamp.minute.toString().padLeft(2, '0');
    final s = timestamp.second.toString().padLeft(2, '0');
    final ms = timestamp.millisecond.toString().padLeft(3, '0');
    return '$h:$m:$s.$ms';
  }

  String get formattedLine => '[$timeStr] $levelName [$category] $message';

  Map<String, dynamic> toJson() => {
        'timestamp': timestamp.toIso8601String(),
        'level': level.name,
        'category': category,
        'message': message,
        if (data != null) 'data': data,
      };
}

/// BLE connection statistics tracked by the debug logger.
class BleStats {
  int messagesSent = 0;
  int messagesReceived = 0;
  int bytesSent = 0;
  int bytesReceived = 0;
  int audioChunks = 0;
  int photoChunks = 0;
  int tapEvents = 0;
  int reconnectAttempts = 0;
  int errors = 0;
  int holdsSent = 0;
  DateTime? lastTxTime;
  DateTime? lastRxTime;
  DateTime? connectedSince;
  String connectionState = 'disconnected';
  String? deviceName;
  String? deviceId;
  int? rssi;
  int? mtu;
  bool foregroundServiceRunning = false;

  Map<String, dynamic> toJson() => {
        'messages_sent': messagesSent,
        'messages_received': messagesReceived,
        'bytes_sent': bytesSent,
        'bytes_received': bytesReceived,
        'audio_chunks': audioChunks,
        'photo_chunks': photoChunks,
        'tap_events': tapEvents,
        'reconnect_attempts': reconnectAttempts,
        'errors': errors,
        'holds_sent': holdsSent,
        'last_tx': lastTxTime?.toIso8601String(),
        'last_rx': lastRxTime?.toIso8601String(),
        'connected_since': connectedSince?.toIso8601String(),
        'connection_state': connectionState,
        'device_name': deviceName,
        'device_id': deviceId,
        'rssi': rssi,
        'mtu': mtu,
        'foreground_service': foregroundServiceRunning,
      };

  void reset() {
    messagesSent = 0;
    messagesReceived = 0;
    bytesSent = 0;
    bytesReceived = 0;
    audioChunks = 0;
    photoChunks = 0;
    tapEvents = 0;
    reconnectAttempts = 0;
    errors = 0;
    holdsSent = 0;
    lastTxTime = null;
    lastRxTime = null;
    connectedSince = null;
    connectionState = 'disconnected';
    deviceName = null;
    deviceId = null;
    rssi = null;
    mtu = null;
    foregroundServiceRunning = false;
  }
}

/// Singleton BLE debug logger that captures all BLE events with timestamps.
/// Provides an in-memory rolling buffer, live stream for UI, and
/// remote upload capability.
class BleDebugLogger {
  BleDebugLogger._();
  static final BleDebugLogger instance = BleDebugLogger._();

  /// Maximum entries to keep in memory (rolling buffer).
  static const int maxEntries = 500;

  /// Auto-upload interval.
  static const Duration uploadInterval = Duration(seconds: 30);

  final _entries = Queue<BleLogEntry>();
  final _controller = StreamController<BleLogEntry>.broadcast();
  final stats = BleStats();

  /// Whether remote auto-upload is enabled.
  bool autoUploadEnabled = false;

  /// Dio client for remote uploads (set from outside via setApiClient).
  Dio? _dio;

  Timer? _uploadTimer;

  /// Entries uploaded in last batch (for UI feedback).
  int lastUploadCount = 0;
  DateTime? lastUploadTime;
  String? lastUploadError;

  /// All current log entries (read-only).
  List<BleLogEntry> get entries => List.unmodifiable(_entries);

  /// Live stream of new log entries for UI updates.
  Stream<BleLogEntry> get stream => _controller.stream;

  /// Number of entries in buffer.
  int get entryCount => _entries.length;

  /// Set the Dio API client for remote uploads.
  void setApiClient(Dio dio) {
    _dio = dio;
  }

  /// Start auto-uploading logs to backend every [uploadInterval].
  void startAutoUpload() {
    autoUploadEnabled = true;
    _uploadTimer?.cancel();
    _uploadTimer = Timer.periodic(uploadInterval, (_) => uploadLogs());
    log(BleLogLevel.info, 'SYSTEM', 'Auto-upload enabled (every ${uploadInterval.inSeconds}s)');
  }

  /// Stop auto-uploading.
  void stopAutoUpload() {
    autoUploadEnabled = false;
    _uploadTimer?.cancel();
    _uploadTimer = null;
    log(BleLogLevel.info, 'SYSTEM', 'Auto-upload disabled');
  }

  /// Log a BLE debug event.
  void log(BleLogLevel level, String category, String message, [Map<String, dynamic>? data]) {
    final entry = BleLogEntry(
      timestamp: DateTime.now(),
      level: level,
      category: category,
      message: message,
      data: data,
    );

    _entries.addLast(entry);
    while (_entries.length > maxEntries) {
      _entries.removeFirst();
    }

    if (level == BleLogLevel.error) {
      stats.errors++;
    }

    if (!_controller.isClosed) {
      _controller.add(entry);
    }

    // Also print to console for ADB debugging
    print('[BLE_DEBUG] ${entry.formattedLine}');
  }

  // ─── Convenience methods ───────────────────────────────────

  void debug(String category, String message, [Map<String, dynamic>? data]) =>
      log(BleLogLevel.debug, category, message, data);

  void info(String category, String message, [Map<String, dynamic>? data]) =>
      log(BleLogLevel.info, category, message, data);

  void warning(String category, String message, [Map<String, dynamic>? data]) =>
      log(BleLogLevel.warning, category, message, data);

  void error(String category, String message, [Map<String, dynamic>? data]) =>
      log(BleLogLevel.error, category, message, data);

  // ─── BLE-specific logging ─────────────────────────────────

  void logConnectionStateChange(String newState, {String? reason}) {
    stats.connectionState = newState;
    if (newState == 'connected') {
      stats.connectedSince = DateTime.now();
    }
    info('BLE', 'State → $newState${reason != null ? ' ($reason)' : ''}');
  }

  void logTx(int flag, int bytes) {
    stats.messagesSent++;
    stats.bytesSent += bytes;
    stats.lastTxTime = DateTime.now();
    if (flag == 0x23) stats.holdsSent++;
    debug('TX', 'Flag=0x${flag.toRadixString(16)} Size=$bytes bytes');
  }

  void logRx(int flag, int bytes) {
    stats.messagesReceived++;
    stats.bytesReceived += bytes;
    stats.lastRxTime = DateTime.now();
    debug('RX', 'Flag=0x${flag.toRadixString(16)} Size=$bytes bytes');
  }

  void logTap() {
    stats.tapEvents++;
    info('TAP', 'Tap event received (#${stats.tapEvents})');
  }

  void logAudioChunk(int bytes, {bool isFinal = false}) {
    stats.audioChunks++;
    debug('AUDIO', '${isFinal ? "Final" : "Chunk"} $bytes bytes (total chunks: ${stats.audioChunks})');
  }

  void logPhotoChunk(int bytes, {bool isFinal = false}) {
    stats.photoChunks++;
    debug('PHOTO', '${isFinal ? "Final" : "Chunk"} $bytes bytes (total chunks: ${stats.photoChunks})');
  }

  void logReconnect(int attempt, {int? maxAttempts, String? reason}) {
    stats.reconnectAttempts++;
    final maxStr = maxAttempts != null ? '/$maxAttempts' : '';
    warning('RECONNECT', 'Attempt $attempt$maxStr${reason != null ? ' — $reason' : ''}');
  }

  void logScan(String type, {String? result}) {
    info('SCAN', '$type scan${result != null ? ': $result' : ''}');
  }

  void logServiceDiscovery(int servicesFound, bool txFound, bool rxFound) {
    info('SERVICES', 'Found $servicesFound services, TX=${txFound ? "OK" : "MISSING"}, RX=${rxFound ? "OK" : "MISSING"}');
  }

  void logMtu(int mtu) {
    stats.mtu = mtu;
    info('MTU', 'MTU negotiated: $mtu bytes');
  }

  void logDevice(String name, String id, int rssi) {
    stats.deviceName = name;
    stats.deviceId = id;
    stats.rssi = rssi;
    info('DEVICE', '$name ($id) RSSI=$rssi dBm');
  }

  void logForegroundService(bool running) {
    stats.foregroundServiceRunning = running;
    info('FG_SVC', 'Foreground service: ${running ? "RUNNING" : "STOPPED"}');
  }

  // ─── Remote upload ────────────────────────────────────────

  /// Upload all current logs to backend.
  /// Returns true if upload succeeded.
  Future<bool> uploadLogs() async {
    if (_dio == null) {
      lastUploadError = 'No API client configured';
      return false;
    }

    if (_entries.isEmpty) {
      lastUploadCount = 0;
      lastUploadTime = DateTime.now();
      return true;
    }

    try {
      final payload = {
        'device': 'frame',
        'stats': stats.toJson(),
        'entries': _entries.map((e) => e.toJson()).toList(),
        'uploaded_at': DateTime.now().toIso8601String(),
      };

      await _dio!.post('/device-logs', data: payload);

      lastUploadCount = _entries.length;
      lastUploadTime = DateTime.now();
      lastUploadError = null;

      log(BleLogLevel.info, 'UPLOAD', 'Uploaded $lastUploadCount log entries');
      return true;
    } catch (e) {
      lastUploadError = e.toString();
      log(BleLogLevel.error, 'UPLOAD', 'Upload failed: $e');
      return false;
    }
  }

  /// Clear all logs and reset stats.
  void clear() {
    _entries.clear();
    stats.reset();
    lastUploadCount = 0;
    lastUploadTime = null;
    lastUploadError = null;
    log(BleLogLevel.info, 'SYSTEM', 'Logs cleared');
  }

  /// Export all logs as a single string (for sharing/copying).
  String exportAsText() {
    final buffer = StringBuffer();
    buffer.writeln('=== GOD Frame BLE Debug Log ===');
    buffer.writeln('Exported: ${DateTime.now().toIso8601String()}');
    buffer.writeln('Device: ${stats.deviceName ?? "N/A"} (${stats.deviceId ?? "N/A"})');
    buffer.writeln('State: ${stats.connectionState}');
    buffer.writeln('MTU: ${stats.mtu ?? "N/A"}');
    buffer.writeln('RSSI: ${stats.rssi ?? "N/A"} dBm');
    buffer.writeln('Messages TX/RX: ${stats.messagesSent}/${stats.messagesReceived}');
    buffer.writeln('Bytes TX/RX: ${stats.bytesSent}/${stats.bytesReceived}');
    buffer.writeln('Errors: ${stats.errors}');
    buffer.writeln('Reconnects: ${stats.reconnectAttempts}');
    buffer.writeln('');
    buffer.writeln('=== Log Entries (${_entries.length}) ===');
    for (final entry in _entries) {
      buffer.writeln(entry.formattedLine);
      if (entry.data != null) {
        buffer.writeln('  data: ${entry.data}');
      }
    }
    return buffer.toString();
  }

  void dispose() {
    _uploadTimer?.cancel();
    _controller.close();
  }
}
