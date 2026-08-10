import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../../core/config.dart';
import '../../../shared/utils/api_client.dart';
import '../domain/auth_state.dart';

/// Repository for authentication operations against GOD CRM backend.
class AuthRepository {
  final Dio _dio;
  final FlutterSecureStorage _storage;

  AuthRepository(this._dio, this._storage);

  /// Login with email and password.
  /// Returns [UserProfile] on success.
  Future<ApiResult<UserProfile>> login(String email, String password) async {
    try {
      final response = await _dio.post(
        AppConfig.loginPath,
        data: {'email': email, 'password': password},
      );

      if (response.statusCode == 200) {
        final body = response.data;

        // Extract token — GOD CRM returns { data: { accessToken: "..." } }
        String? token;
        if (body is Map) {
          token = body['data']?['accessToken'] ??
              body['accessToken'] ??
              body['data']?['token'] ??
              body['token'] ??
              body['access_token'];
        }

        // Also check Set-Cookie header
        final cookies = response.headers['set-cookie'];
        if (token == null && cookies != null) {
          for (final cookie in cookies) {
            if (cookie.startsWith('access_token=')) {
              token = cookie.split('=')[1].split(';')[0];
              break;
            }
          }
        }

        if (token != null) {
          await _storage.write(key: AppConfig.tokenKey, value: token);
          updateCachedToken(token);
        }

        // Extract and store refresh token for persistent auth
        String? refreshToken;
        if (body is Map) {
          refreshToken = body['data']?['refreshToken'] ??
              body['refreshToken'];
        }
        if (refreshToken != null) {
          await _storage.write(
              key: AppConfig.refreshTokenKey, value: refreshToken);
        }

        // Fetch user profile
        return await getProfile();
      }

      return ApiResult.failure('Login failed', response.statusCode);
    } on DioException catch (e) {
      final msg = e.response?.data?['error']?['message'] ??
          e.response?.data?['message'] ??
          'Connection error';
      return ApiResult.failure(msg.toString(), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Login with Google access_token.
  /// Sends the Google access_token to backend which validates it with Google
  /// and returns a CRM JWT token (same flow as Electron app).
  Future<ApiResult<UserProfile>> loginWithGoogle(String googleAccessToken) async {
    try {
      final response = await _dio.post(
        AppConfig.googleTokenPath,
        data: {'access_token': googleAccessToken},
      );

      if (response.statusCode == 200) {
        final body = response.data;

        // Extract CRM access token from response
        String? token;
        if (body is Map) {
          token = body['data']?['accessToken'] ??
              body['accessToken'] ??
              body['data']?['token'] ??
              body['token'];
        }

        if (token != null) {
          await _storage.write(key: AppConfig.tokenKey, value: token);
          updateCachedToken(token);
        }

        // Extract and store refresh token for persistent auth
        String? refreshToken;
        if (body is Map) {
          refreshToken = body['data']?['refreshToken'] ??
              body['refreshToken'];
        }
        if (refreshToken != null) {
          await _storage.write(
              key: AppConfig.refreshTokenKey, value: refreshToken);
        }

        // Fetch user profile with the new token
        return await getProfile();
      }

      return ApiResult.failure('Google login failed', response.statusCode);
    } on DioException catch (e) {
      final msg = e.response?.data?['error']?['message'] ??
          e.response?.data?['message'] ??
          'Google authentication failed';
      return ApiResult.failure(msg.toString(), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Get the Google mobile auth URL from backend.
  /// Passes the mobile callback scheme so backend redirects to godframe:// instead of web.
  Future<ApiResult<String>> getGoogleMobileAuthUrl() async {
    try {
      final response = await _dio.get(
        AppConfig.googleMobileAuthUrlPath,
        queryParameters: {
          'callback_scheme': 'godframe',
          'redirect_uri': 'godframe://auth/callback',
          'platform': 'mobile',
        },
      );
      if (response.statusCode == 200) {
        final body = response.data;
        final url = body is Map ? (body['data']?['url'] ?? body['url']) : null;
        if (url != null) {
          return ApiResult.success(url as String);
        }
        return ApiResult.failure('No auth URL in response');
      }
      return ApiResult.failure('Failed to get auth URL', response.statusCode);
    } catch (e) {
      return ApiResult.failure('Failed to get Google auth URL: $e');
    }
  }

  /// Store token directly (used by deep link callback).
  Future<void> storeToken(String token) async {
    await _storage.write(key: AppConfig.tokenKey, value: token);
    updateCachedToken(token);
  }

  /// Store refresh token directly (used by deep link callback).
  Future<void> storeRefreshToken(String refreshToken) async {
    await _storage.write(key: AppConfig.refreshTokenKey, value: refreshToken);
  }

  /// Login with API key (sk-...).
  Future<ApiResult<UserProfile>> loginWithApiKey(String apiKey) async {
    try {
      await _storage.write(key: AppConfig.tokenKey, value: apiKey);
      updateCachedToken(apiKey);
      return await getProfile();
    } catch (e) {
      await _storage.delete(key: AppConfig.tokenKey);
      return ApiResult.failure(e.toString());
    }
  }

  /// Get current user profile.
  Future<ApiResult<UserProfile>> getProfile() async {
    try {
      final response = await _dio.get(AppConfig.mePath);

      if (response.statusCode == 200) {
        final body = response.data;
        Map<String, dynamic> userData;

        if (body is Map && body.containsKey('data')) {
          final data = body['data'];
          // Backend returns { data: { accessToken, user: { id, email, role } } }
          // Extract user object if nested
          if (data is Map && data.containsKey('user') && data['user'] is Map) {
            userData = Map<String, dynamic>.from(data['user']);
          } else {
            userData = Map<String, dynamic>.from(data);
          }
        } else if (body is Map) {
          userData = Map<String, dynamic>.from(body);
        } else {
          return ApiResult.failure('Invalid response format');
        }

        // Also save refreshed accessToken if present
        final newToken = body is Map
            ? (body['data']?['accessToken'] ?? body['accessToken'])
            : null;
        if (newToken != null) {
          await _storage.write(key: AppConfig.tokenKey, value: newToken);
          updateCachedToken(newToken);
        }

        // Save refreshed refreshToken if present (token rotation)
        final newRefreshToken = body is Map
            ? (body['data']?['refreshToken'] ?? body['refreshToken'])
            : null;
        if (newRefreshToken != null) {
          await _storage.write(
              key: AppConfig.refreshTokenKey, value: newRefreshToken);
        }

        return ApiResult.success(UserProfile.fromJson(userData));
      }

      return ApiResult.failure('Failed to get profile', response.statusCode);
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        // Do NOT delete the token here — the Dio interceptor will attempt
        // a token refresh via /auth/refresh. Only an explicit logout should
        // clear stored credentials. Deleting here was the root cause of
        // users being unexpectedly logged out after JWT expiry.
        return ApiResult.failure('Session expired', 401);
      }
      return ApiResult.failure('Connection error', e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Logout: clear stored tokens.
  Future<void> logout() async {
    try {
      await _dio.post(AppConfig.logoutPath);
    } catch (_) {
      // Ignore logout API errors — always clear local state
    }
    await _storage.delete(key: AppConfig.tokenKey);
    await _storage.delete(key: AppConfig.refreshTokenKey);
    invalidateAuthCache();
  }

  /// Refresh the access token using the stored refresh token.
  /// Returns the new access token on success, null on failure.
  Future<String?> refreshAccessToken() async {
    try {
      final refreshToken =
          await _storage.read(key: AppConfig.refreshTokenKey);
      if (refreshToken == null || refreshToken.isEmpty) {
        return null;
      }

      final response = await _dio.post(
        AppConfig.refreshPath,
        data: {'refreshToken': refreshToken},
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final newAccessToken = body is Map
            ? (body['data']?['accessToken'] ?? body['accessToken'])
            : null;
        final newRefreshToken = body is Map
            ? (body['data']?['refreshToken'] ?? body['refreshToken'])
            : null;

        if (newAccessToken != null) {
          await _storage.write(key: AppConfig.tokenKey, value: newAccessToken);
          updateCachedToken(newAccessToken);
        }
        if (newRefreshToken != null) {
          await _storage.write(
              key: AppConfig.refreshTokenKey, value: newRefreshToken);
        }

        return newAccessToken;
      }
      return null;
    } catch (e) {
      print('[Auth] Token refresh failed: $e');
      return null;
    }
  }

  /// Check if we have a stored token.
  Future<bool> hasToken() async {
    final token = await _storage.read(key: AppConfig.tokenKey);
    return token != null && token.isNotEmpty;
  }

  /// Set server base URL.
  Future<void> setServerUrl(String url) async {
    await _storage.write(key: AppConfig.serverUrlKey, value: url);
    updateCachedBaseUrl(url);
  }

  /// Get server base URL.
  Future<String> getServerUrl() async {
    return await _storage.read(key: AppConfig.serverUrlKey) ??
        AppConfig.defaultBaseUrl;
  }
}
