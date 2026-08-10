import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../core/config.dart';

/// Secure storage provider.
final secureStorageProvider = Provider<FlutterSecureStorage>((ref) {
  return const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );
});

/// In-memory cache for auth values to avoid repeated async reads.
class _AuthCache {
  String? baseUrl;
  String? token;
  bool initialized = false;
}

final _authCache = _AuthCache();

/// Tracks whether a token refresh is already in progress to prevent
/// concurrent refresh requests from multiple 401 responses.
Completer<String?>? _refreshCompleter;

/// Dio HTTP client provider with auth interceptor and automatic token refresh.
final apiClientProvider = Provider<Dio>((ref) {
  final storage = ref.watch(secureStorageProvider);

  final dio = Dio(BaseOptions(
    connectTimeout: AppConfig.connectTimeout,
    receiveTimeout: AppConfig.receiveTimeout,
    // Use contentType property (NOT headers map) so Dio can auto-override
    // for FormData requests (multipart/form-data with boundary).
    contentType: 'application/json',
    headers: {
      'Accept': 'application/json',
    },
  ));

  // Auth interceptor: attach JWT/API key to every request
  dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) async {
      try {
        // Read from cache first, fallback to storage
        if (!_authCache.initialized) {
          _authCache.baseUrl = await storage.read(key: AppConfig.serverUrlKey);
          _authCache.token = await storage.read(key: AppConfig.tokenKey);
          _authCache.initialized = true;
          // If no stored server URL, persist the default to prevent stale values
          if (_authCache.baseUrl == null) {
            _authCache.baseUrl = AppConfig.defaultBaseUrl;
            await storage.write(key: AppConfig.serverUrlKey, value: AppConfig.defaultBaseUrl);
          }
        }

        final baseUrl = _authCache.baseUrl ?? AppConfig.defaultBaseUrl;
        options.baseUrl = '$baseUrl${AppConfig.apiPrefix}';

        // Attach token — detect API key vs JWT
        final token = _authCache.token ??
            await storage.read(key: AppConfig.tokenKey);
        if (token != null && token.isNotEmpty) {
          if (token.startsWith('sk-')) {
            // API key — use X-API-Key header
            options.headers['X-API-Key'] = token;
          } else {
            // JWT — use Authorization Bearer
            options.headers['Authorization'] = 'Bearer $token';
          }
        }

        handler.next(options);
      } catch (e) {
        // Don't block requests due to storage errors
        print('[API] Auth interceptor error: $e');
        options.baseUrl = '${AppConfig.defaultBaseUrl}${AppConfig.apiPrefix}';
        handler.next(options);
      }
    },
    onError: (error, handler) async {
      // On 401, attempt to refresh the access token using the stored refresh token.
      // Skip refresh for auth endpoints themselves to avoid infinite loops.
      if (error.response?.statusCode == 401) {
        final requestPath = error.requestOptions.path;

        // Don't try to refresh if the failing request IS the refresh/login/logout endpoint
        if (requestPath.contains('/auth/refresh') ||
            requestPath.contains('/auth/login') ||
            requestPath.contains('/auth/logout')) {
          _authCache.initialized = false;
          return handler.next(error);
        }

        // Don't try to refresh for API key auth (sk-...) — those don't expire
        final currentToken = _authCache.token;
        if (currentToken != null && currentToken.startsWith('sk-')) {
          return handler.next(error);
        }

        try {
          // If a refresh is already in progress, wait for it
          final String? newToken;
          if (_refreshCompleter != null && !_refreshCompleter!.isCompleted) {
            newToken = await _refreshCompleter!.future;
          } else {
            // Start a new refresh
            _refreshCompleter = Completer<String?>();
            newToken = await _performTokenRefresh(storage, dio);
            _refreshCompleter!.complete(newToken);
          }

          if (newToken != null) {
            // Retry the original request with the new token
            final retryOptions = error.requestOptions;
            retryOptions.headers['Authorization'] = 'Bearer $newToken';

            final response = await dio.fetch(retryOptions);
            return handler.resolve(response);
          }
        } catch (refreshError) {
          print('[API] Token refresh error: $refreshError');
          if (_refreshCompleter != null && !_refreshCompleter!.isCompleted) {
            _refreshCompleter!.complete(null);
          }
        }

        // Refresh failed — clear cache so next request re-reads storage
        _authCache.initialized = false;
      }
      handler.next(error);
    },
  ));

  // Logging interceptor (shows URL and status)
  dio.interceptors.add(LogInterceptor(
    requestBody: false,
    responseBody: false,
    logPrint: (msg) => print('[API] $msg'),
  ));

  return dio;
});

/// Perform the actual token refresh call.
/// Uses a raw Dio instance to avoid the interceptor re-triggering.
Future<String?> _performTokenRefresh(
    FlutterSecureStorage storage, Dio parentDio) async {
  try {
    final refreshToken = await storage.read(key: AppConfig.refreshTokenKey);
    if (refreshToken == null || refreshToken.isEmpty) {
      print('[API] No refresh token available');
      return null;
    }

    final baseUrl = _authCache.baseUrl ?? AppConfig.defaultBaseUrl;

    // Use a separate Dio instance for the refresh call to avoid interceptor loops
    final refreshDio = Dio(BaseOptions(
      baseUrl: '$baseUrl${AppConfig.apiPrefix}',
      connectTimeout: AppConfig.connectTimeout,
      receiveTimeout: const Duration(seconds: 15),
      contentType: 'application/json',
    ));

    final response = await refreshDio.post(
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
        await storage.write(key: AppConfig.tokenKey, value: newAccessToken);
        _authCache.token = newAccessToken;
        _authCache.initialized = true;
        print('[API] Access token refreshed successfully');
      }
      if (newRefreshToken != null) {
        await storage.write(
            key: AppConfig.refreshTokenKey, value: newRefreshToken);
      }

      return newAccessToken;
    }

    print('[API] Token refresh returned status: ${response.statusCode}');
    return null;
  } catch (e) {
    print('[API] Token refresh failed: $e');
    return null;
  }
}

/// Call this after login/logout to refresh the cached auth values.
void invalidateAuthCache() {
  _authCache.initialized = false;
  _authCache.token = null;
  _authCache.baseUrl = null;
}

/// Update cached token (call after login).
void updateCachedToken(String? token) {
  _authCache.token = token;
}

/// Update cached base URL (call after server URL change).
void updateCachedBaseUrl(String? url) {
  _authCache.baseUrl = url;
}

/// Get the current base URL for resolving relative URLs (e.g. image attachments).
String getCurrentBaseUrl() => _authCache.baseUrl ?? AppConfig.defaultBaseUrl;

/// Get the cached auth token (for image loading headers etc).
String? getCachedToken() => _authCache.token;

/// API response wrapper.
class ApiResult<T> {
  final T? data;
  final String? error;
  final int? statusCode;

  const ApiResult({this.data, this.error, this.statusCode});

  bool get isSuccess => data != null && error == null;
  bool get isError => error != null;

  factory ApiResult.success(T data) => ApiResult(data: data);
  factory ApiResult.failure(String error, [int? statusCode]) =>
      ApiResult(error: error, statusCode: statusCode);
}
