import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../data/auth_repository.dart';
import '../domain/auth_state.dart';
import '../../../shared/utils/api_client.dart';
import '../../../core/config.dart';

/// Auth repository provider.
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final dio = ref.watch(apiClientProvider);
  final storage = ref.watch(secureStorageProvider);
  return AuthRepository(dio, storage);
});

/// Auth state notifier.
final authStateProvider =
    StateNotifierProvider<AuthNotifier, AsyncValue<AuthState>>((ref) {
  final repo = ref.watch(authRepositoryProvider);
  return AuthNotifier(repo);
});

class AuthNotifier extends StateNotifier<AsyncValue<AuthState>> {
  final AuthRepository _repo;

  AuthNotifier(this._repo) : super(const AsyncValue.loading()) {
    _init();
  }

  /// Check for existing session on app start.
  /// If the access token has expired, attempts a refresh using the stored
  /// refresh token before falling back to unauthenticated state.
  Future<void> _init() async {
    final hasToken = await _repo.hasToken();
    if (hasToken) {
      final result = await _repo.getProfile();
      if (result.isSuccess) {
        state = AsyncValue.data(Authenticated(result.data!));
      } else if (result.statusCode == 401) {
        // Access token expired — try to refresh it
        final newToken = await _repo.refreshAccessToken();
        if (newToken != null) {
          // Retry getProfile with the fresh token
          final retryResult = await _repo.getProfile();
          if (retryResult.isSuccess) {
            state = AsyncValue.data(Authenticated(retryResult.data!));
            return;
          }
        }
        // Refresh failed — user must re-login
        state = const AsyncValue.data(Unauthenticated());
      } else {
        // Non-401 error (e.g. network issue, timeout, VPN down) —
        // keep the stored token and retry after a delay.
        // Do NOT show login screen — this was the root cause of spurious logouts
        // when the server was temporarily unreachable.
        await Future.delayed(const Duration(seconds: 3));
        final retryResult = await _repo.getProfile();
        if (retryResult.isSuccess) {
          state = AsyncValue.data(Authenticated(retryResult.data!));
        } else {
          // Still can't reach server — show app anyway with offline placeholder.
          // User can pull-to-refresh or the Dio interceptor will handle reconnection.
          state = AsyncValue.data(Authenticated(UserProfile(
            id: 0, email: '', name: 'Offline',
          )));
        }
      }
    } else {
      state = const AsyncValue.data(Unauthenticated());
    }
  }

  /// Login with email + password.
  Future<bool> login(String email, String password) async {
    state = const AsyncValue.data(AuthLoading());

    final result = await _repo.login(email, password);
    if (result.isSuccess) {
      state = AsyncValue.data(Authenticated(result.data!));
      return true;
    } else {
      state = AsyncValue.data(AuthError(result.error ?? 'Login failed'));
      return false;
    }
  }

  /// Login with Google — uses native Google Sign-In.
  /// Falls back to browser-based OAuth flow if native sign-in fails.
  Future<bool> loginWithGoogle() async {
    state = const AsyncValue.data(AuthLoading());

    try {
      // Try native Google Sign-In first (best UX, no browser redirect)
      final nativeResult = await _tryNativeGoogleSignIn();
      if (nativeResult) return true;

      // Fallback to browser-based OAuth flow with deep link callback
      return await _tryBrowserGoogleSignIn();
    } catch (e) {
      state = AsyncValue.data(AuthError('Google Sign-In error: $e'));
      return false;
    }
  }

  /// Attempt native Google Sign-In using google_sign_in package.
  /// Returns true if successful, false if should fall back to browser flow.
  Future<bool> _tryNativeGoogleSignIn() async {
    try {
      final googleSignIn = GoogleSignIn(
        scopes: ['email', 'profile'],
        // Web Client ID from our Google OAuth config — needed to get serverAuthCode
        serverClientId: AppConfig.googleWebClientId,
      );

      final account = await googleSignIn.signIn();
      if (account == null) {
        // User cancelled
        state = const AsyncValue.data(Unauthenticated('Sign-in cancelled'));
        return false;
      }

      // Get authentication tokens
      final auth = await account.authentication;
      final accessToken = auth.accessToken;

      if (accessToken == null) {
        // No access token — fall back to browser flow
        await googleSignIn.signOut();
        return false;
      }

      // Send Google access_token to our backend /auth/google/token
      // Backend validates with Google and returns CRM JWT
      final result = await _repo.loginWithGoogle(accessToken);
      if (result.isSuccess) {
        state = AsyncValue.data(Authenticated(result.data!));
        await googleSignIn.signOut(); // Clear Google session (we use our own JWT)
        return true;
      } else {
        state = AsyncValue.data(
            AuthError(result.error ?? 'Google login failed'));
        await googleSignIn.signOut();
        return false;
      }
    } catch (e) {
      // Native sign-in failed (e.g., no Android OAuth client configured)
      // Return false to try browser flow
      return false;
    }
  }

  /// Browser-based OAuth flow using Chrome Custom Tab (fallback).
  /// Uses flutter_web_auth_2 which opens Chrome Custom Tab and automatically
  /// intercepts the godframe:// callback redirect — no manual deep link needed.
  Future<bool> _tryBrowserGoogleSignIn() async {
    try {
      // Get the mobile auth URL from our backend
      final result = await _repo.getGoogleMobileAuthUrl();
      if (!result.isSuccess || result.data == null) {
        state = AsyncValue.data(
            AuthError(result.error ?? 'Failed to get Google auth URL'));
        return false;
      }

      final authUrl = result.data!;

      // Open Chrome Custom Tab and wait for godframe:// callback
      // flutter_web_auth_2 automatically closes the tab when it sees
      // a redirect to the callbackUrlScheme and returns the full URL
      final callbackUrl = await FlutterWebAuth2.authenticate(
        url: authUrl,
        callbackUrlScheme: 'godframe',
      );

      // Extract token from callback URL: godframe://auth/callback?token=JWT&refresh_token=...
      final uri = Uri.parse(callbackUrl);
      final token = uri.queryParameters['token'];
      final refreshToken = uri.queryParameters['refresh_token'];

      if (token != null && token.isNotEmpty) {
        return await handleGoogleCallback(token, refreshToken: refreshToken);
      } else {
        state = const AsyncValue.data(
            AuthError('No token received from Google sign-in'));
        return false;
      }
    } catch (e) {
      // flutter_web_auth_2 throws when user cancels or closes the tab
      final msg = e.toString();
      if (msg.contains('CANCELED') ||
          msg.contains('cancelled') ||
          msg.contains('user_canceled')) {
        state = const AsyncValue.data(Unauthenticated('Sign-in cancelled'));
      } else {
        state = AsyncValue.data(AuthError('Browser sign-in error: $e'));
      }
      return false;
    }
  }

  /// Handle deep link callback from Google OAuth.
  /// Called when the app receives a godframe://auth/callback?token=xxx&refresh_token=yyy deep link.
  Future<bool> handleGoogleCallback(String token,
      {String? refreshToken}) async {
    state = const AsyncValue.data(AuthLoading());

    try {
      // Store the JWT token and optional refresh token
      await _repo.storeToken(token);
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _repo.storeRefreshToken(refreshToken);
      }

      // Fetch user profile with the new token
      final result = await _repo.getProfile();
      if (result.isSuccess) {
        state = AsyncValue.data(Authenticated(result.data!));
        return true;
      } else {
        state = AsyncValue.data(
            AuthError(result.error ?? 'Failed to get profile'));
        return false;
      }
    } catch (e) {
      state = AsyncValue.data(AuthError('Auth callback error: $e'));
      return false;
    }
  }

  /// Login with API key.
  Future<bool> loginWithApiKey(String apiKey) async {
    state = const AsyncValue.data(AuthLoading());

    final result = await _repo.loginWithApiKey(apiKey);
    if (result.isSuccess) {
      state = AsyncValue.data(Authenticated(result.data!));
      return true;
    } else {
      state = AsyncValue.data(AuthError(result.error ?? 'Invalid API key'));
      return false;
    }
  }

  /// Logout.
  Future<void> logout() async {
    await _repo.logout();
    state = const AsyncValue.data(Unauthenticated());
  }

  /// Set server URL.
  Future<void> setServerUrl(String url) async {
    await _repo.setServerUrl(url);
  }
}
