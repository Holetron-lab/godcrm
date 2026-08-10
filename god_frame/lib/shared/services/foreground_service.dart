import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// Foreground service manager for keeping BLE and audio alive in background.
class ForegroundServiceManager {
  static bool _isRunning = false;

  /// Initialize the foreground task configuration.
  static void init() {
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'god_frame_bg',
        channelName: 'GOD Frame Background',
        channelDescription: 'Keeps connection to Frame glasses active',
        channelImportance: NotificationChannelImportance.DEFAULT,
        priority: NotificationPriority.DEFAULT,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        // NOA pattern: use once() instead of repeat() — just keep the process alive.
        // Periodic ticks every 10s are unnecessary and waste battery.
        // The foreground service notification alone is enough to prevent Android
        // from killing the process. BLE connection handles its own keepalive.
        eventAction: ForegroundTaskEventAction.once(),
        autoRunOnBoot: false,
        autoRunOnMyPackageReplaced: false,
        allowWakeLock: true,
        allowWifiLock: true,
      ),
    );
  }

  /// Start foreground service.
  static Future<void> start({String title = 'GOD Frame', String text = 'Connected to Frame glasses'}) async {
    if (_isRunning) {
      FlutterForegroundTask.updateService(
        notificationTitle: title,
        notificationText: text,
      );
      return;
    }

    try {
      final result = await FlutterForegroundTask.startService(
        notificationTitle: title,
        notificationText: text,
        callback: startCallback,
      );
      _isRunning = true;
      print('[ForegroundService] Start: $result, running=$_isRunning');
    } catch (e) {
      print('[ForegroundService] Start failed: $e');
      _isRunning = false;
    }
  }

  /// Update notification text.
  static Future<void> updateNotification({required String title, required String text}) async {
    if (!_isRunning) return;
    FlutterForegroundTask.updateService(
      notificationTitle: title,
      notificationText: text,
    );
  }

  /// Stop foreground service.
  static Future<void> stop() async {
    if (!_isRunning) return;
    await FlutterForegroundTask.stopService();
    _isRunning = false;
    print('[ForegroundService] Stopped');
  }

  static bool get isRunning => _isRunning;

  /// Request notification permission (Android 13+).
  static Future<bool> requestNotificationPermission() async {
    final perm = await FlutterForegroundTask.checkNotificationPermission();
    if (perm != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
      final result = await FlutterForegroundTask.checkNotificationPermission();
      return result == NotificationPermission.granted;
    }
    return true;
  }

  /// Request to ignore battery optimizations.
  static Future<void> requestBatteryOptimization() async {
    final isIgnoring = await FlutterForegroundTask.isIgnoringBatteryOptimizations;
    if (!isIgnoring) {
      await FlutterForegroundTask.requestIgnoreBatteryOptimization();
    }
  }
}

@pragma('vm:entry-point')
void startCallback() {
  FlutterForegroundTask.setTaskHandler(_KeepAliveHandler());
}

class _KeepAliveHandler extends TaskHandler {
  int _tickCount = 0;

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    print('[ForegroundTask] Started by $starter at $timestamp');
    _tickCount = 0;
  }

  @override
  void onRepeatEvent(DateTime timestamp) {
    _tickCount++;
    // Periodic tick keeps the process alive in background
    // Without this, Android may kill the app after ~1 minute in background
    if (_tickCount % 6 == 0) {
      // Every 60 seconds, log a heartbeat
      print('[ForegroundTask] Heartbeat #$_tickCount at $timestamp');
    }
  }

  @override
  Future<void> onDestroy(DateTime timestamp) async {
    print('[ForegroundTask] Destroyed at $timestamp after $_tickCount ticks');
  }

  @override
  void onNotificationPressed() {
    FlutterForegroundTask.launchApp();
  }
}
