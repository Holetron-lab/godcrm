import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'shared/services/foreground_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0A0A0F),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  // Initialize foreground service for background BLE + audio
  ForegroundServiceManager.init();

  runApp(
    const ProviderScope(
      // WithForegroundTask wraps the root widget to ensure proper
      // foreground task lifecycle management (NOA pattern).
      // This prevents the app from being killed when in background
      // and maintains BLE connection to Frame glasses.
      child: WithForegroundTask(
        child: GodFrameApp(),
      ),
    ),
  );
}
