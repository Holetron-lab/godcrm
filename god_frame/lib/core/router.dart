import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/auth/domain/auth_state.dart';
import '../features/auth/providers/auth_provider.dart';
import '../features/auth/ui/login_screen.dart';
import '../features/chat/ui/chat_screen.dart';
import '../features/chat/ui/conversation_screen.dart';
import '../features/crm/ui/tickets_screen.dart';
import '../features/crm/ui/contacts_screen.dart';
import '../features/frame/ui/frame_connect_screen.dart';
import '../features/frame/ui/voice_mode_screen.dart';
import '../features/frame/ui/debug_panel_screen.dart';
import '../features/documents/ui/documents_screen.dart';
import '../features/modules/ui/modules_screen.dart';
import '../features/pes/ui/pes_welcome_screen.dart';
import '../features/settings/ui/settings_screen.dart';
import '../shared/widgets/main_shell.dart';

/// Route paths.
class Routes {
  Routes._();
  static const String login = '/login';
  static const String modules = '/modules';
  static const String pes = '/pes';
  static const String pesWelcome = '/pes/welcome';
  static const String chat = '/chat';
  static const String conversation = '/chat/:id';
  static const String frame = '/frame';
  static const String voiceMode = '/voice';
  static const String tickets = '/tickets';
  static const String contacts = '/contacts';
  static const String documents = '/documents';
  static const String settings = '/settings';
  static const String debug = '/debug';

  // Legacy — kept for compatibility, redirects to /tickets
  static const String crm = '/crm';
}

/// GoRouter provider with auth redirect.
final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);

  return GoRouter(
    initialLocation: Routes.modules,
    debugLogDiagnostics: false,
    redirect: (context, state) {
      // Don't redirect while auth state is still loading (prevents race condition
      // with deep link callback where token is being processed asynchronously)
      if (authState.isLoading) return null;

      final authData = authState.valueOrNull;
      // Also don't redirect while auth is in AuthLoading state (Google callback in progress)
      if (authData is AuthLoading) return null;

      final isLoggedIn = authData?.isAuthenticated ?? false;
      final isLoginRoute = state.matchedLocation == Routes.login;

      if (!isLoggedIn && !isLoginRoute) {
        return Routes.login;
      }
      if (isLoggedIn && isLoginRoute) {
        return Routes.modules;
      }

      // Legacy /crm redirect to /tickets
      if (state.matchedLocation == Routes.crm) {
        return Routes.tickets;
      }

      return null;
    },
    routes: [
      // Login (no shell)
      GoRoute(
        path: Routes.login,
        builder: (context, state) => const LoginScreen(),
      ),

      // Main app with bottom navigation shell
      ShellRoute(
        builder: (context, state, child) => MainShell(child: child),
        routes: [
          // Modules tab (main/home)
          GoRoute(
            path: Routes.modules,
            builder: (context, state) => const ModulesScreen(),
          ),

          // PES (accessible from Modules)
          // Stage 1 of onboarding: temporarily route /pes to the welcome
          // screen so NIKITRON sees the vessel-heart immediately. Stage 6
          // will introduce the real "no pet → welcome, has pet → home"
          // gate and restore PesHomeScreen as the /pes target.
          GoRoute(
            path: Routes.pes,
            builder: (context, state) => const PesWelcomeScreen(),
          ),
          GoRoute(
            path: Routes.pesWelcome,
            builder: (context, state) => const PesWelcomeScreen(),
          ),

          // Chat tab
          GoRoute(
            path: Routes.chat,
            builder: (context, state) => const ChatScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (context, state) {
                  final id = state.pathParameters['id']!;
                  return ConversationScreen(conversationId: int.parse(id));
                },
              ),
            ],
          ),

          // Voice Mode tab
          GoRoute(
            path: Routes.voiceMode,
            builder: (context, state) => const VoiceModeScreen(),
          ),

          // Tickets tab (standalone)
          GoRoute(
            path: Routes.tickets,
            builder: (context, state) => const TicketsScreen(),
          ),

          // Contacts tab (standalone)
          GoRoute(
            path: Routes.contacts,
            builder: (context, state) => const ContactsScreen(),
          ),

          // Documents tab
          GoRoute(
            path: Routes.documents,
            builder: (context, state) => const DocumentsScreen(),
          ),

          // Frame (accessible from Voice/Settings, not in bottom nav)
          GoRoute(
            path: Routes.frame,
            builder: (context, state) => const FrameConnectScreen(),
          ),

          // Settings tab
          GoRoute(
            path: Routes.settings,
            builder: (context, state) => const SettingsScreen(),
          ),

          // Debug Panel (accessible from Frame screen)
          GoRoute(
            path: Routes.debug,
            builder: (context, state) => const DebugPanelScreen(),
          ),

          // Legacy CRM route — redirect handled in redirect callback
          GoRoute(
            path: Routes.crm,
            redirect: (_, __) => Routes.tickets,
          ),
        ],
      ),
    ],
  );
});
