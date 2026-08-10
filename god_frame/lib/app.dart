import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/settings/providers/app_lock_provider.dart';
import 'features/settings/ui/lock_screen.dart';

class GodFrameApp extends ConsumerStatefulWidget {
  const GodFrameApp({super.key});

  @override
  ConsumerState<GodFrameApp> createState() => _GodFrameAppState();
}

class _GodFrameAppState extends ConsumerState<GodFrameApp> with WidgetsBindingObserver {
  late final AppLinks _appLinks;
  StreamSubscription? _linkSub;
  DateTime? _pausedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _appLinks = AppLinks();
    _initDeepLinks();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      _pausedAt = DateTime.now();
    } else if (state == AppLifecycleState.resumed) {
      // Only lock if the app was in background for more than 3 seconds.
      // Permission dialogs and biometric prompts cause brief paused/resumed cycles that should NOT lock.
      if (_pausedAt != null) {
        final lockState = ref.read(appLockProvider);
        final elapsed = DateTime.now().difference(_pausedAt!);
        if (elapsed.inSeconds >= 3 && !lockState.isAuthenticating) {
          ref.read(appLockProvider.notifier).lock();
        }
        _pausedAt = null;
      }
    }
  }

  Future<void> _initDeepLinks() async {
    // Handle initial deep link (app was launched from a link)
    try {
      final initialUri = await _appLinks.getInitialLink();
      if (initialUri != null) {
        _handleDeepLink(initialUri);
      }
    } catch (_) {}

    // Handle deep links while app is running
    _linkSub = _appLinks.uriLinkStream.listen((Uri uri) {
      _handleDeepLink(uri);
    });
  }

  void _handleDeepLink(Uri uri) {
    // Handle godframe://auth/callback?token=xxx&refresh_token=yyy
    if (uri.scheme == 'godframe' &&
        uri.host == 'auth' &&
        uri.path.contains('callback')) {
      final token = uri.queryParameters['token'];
      final refreshToken = uri.queryParameters['refresh_token'];
      if (token != null && token.isNotEmpty) {
        ref
            .read(authStateProvider.notifier)
            .handleGoogleCallback(token, refreshToken: refreshToken);
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    final lockState = ref.watch(appLockProvider);

    return MaterialApp.router(
      title: 'GOD',
      debugShowCheckedModeBanner: false,
      theme: GodTheme.darkTheme,
      routerConfig: router,
      builder: (context, child) {
        // Show lock screen overlay when app is locked
        if (lockState.isLocked) {
          return const LockScreen();
        }
        return child ?? const SizedBox.shrink();
      },
    );
  }
}
