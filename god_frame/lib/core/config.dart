/// GOD Frame app configuration constants.
class AppConfig {
  AppConfig._();

  /// Default CRM backend URL (production).
  static const String defaultBaseUrl = 'https://crm.hltrn.cc';

  /// Development CRM backend URL.
  static const String devBaseUrl = 'https://devcrm.hltrn.cc';

  /// API version prefix.
  static const String apiPrefix = '/api/v3';

  /// Frame Noa endpoint path.
  static const String frameNoaPath = '/frame/noa';

  /// Auth endpoint paths.
  static const String loginPath = '/auth/login';
  static const String logoutPath = '/auth/logout';
  static const String mePath = '/auth/me';
  static const String refreshPath = '/auth/refresh';

  /// Google OAuth endpoint paths.
  static const String googleTokenPath = '/auth/google/token';
  static const String googleConfigPath = '/auth/google/config';
  static const String googleMobileAuthUrlPath = '/auth/google/mobile-auth-url';

  /// Google Web Client ID — used by native Google Sign-In to get access_token.
  /// This is the Web client ID from Google Cloud Console, NOT Android client ID.
  static const String googleWebClientId =
      '791263961317-ejnp56q23s45dsrkvps0eo094aiva1sk.apps.googleusercontent.com';

  /// Chat endpoint paths.
  static const String conversationsPath = '/chat/conversations';

  /// AI conversations path (supports PUT for title update).
  static const String aiConversationsPath = '/ai/conversations';

  /// Spaces endpoint path.
  static const String spacesPath = '/spaces';

  /// File upload path.
  static const String uploadPath = '/files/upload';

  /// Tickets path.
  static const String ticketsPath = '/tickets';

  /// Projects path.
  static const String projectsPath = '/projects';

  /// Tables path (generic table listing).
  static const String tablesPath = '/tables';

  /// Rows path template (append /{tableId}/rows).
  static const String rowsPathTemplate = '/tables';

  /// Agents table (for @mentions).
  static const String agentsTablePath = '/tables/1784/rows';

  /// Users/contacts path.
  static const String usersPath = '/users';

  /// Secure storage keys.
  static const String tokenKey = 'jwt_token';
  static const String refreshTokenKey = 'refresh_token';
  static const String serverUrlKey = 'server_url';
  static const String pairedDeviceKey = 'paired_frame_uuid';

  /// BLE constants for Brilliant Frame.
  static const String frameServiceUuid = '7a230001-5475-a6a4-654c-8431f6ad49c4';
  static const String frameTxUuid = '7a230002-5475-a6a4-654c-8431f6ad49c4';
  static const String frameRxUuid = '7a230003-5475-a6a4-654c-8431f6ad49c4';

  /// Frame display dimensions.
  static const int frameDisplayWidth = 640;
  static const int frameDisplayHeight = 400;

  /// Audio capture settings.
  static const int audioSampleRate = 8000;
  static const int audioBitDepth = 8;

  /// Request timeouts.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 60);
  static const Duration bleTimeout = Duration(seconds: 30);

  /// BLE keepalive interval — send hold every N seconds to prevent Frame sleep.
  /// Frame glasses disconnect after ~10-15s of no BLE activity.
  static const Duration bleKeepaliveInterval = Duration(seconds: 5);

  /// Max message history sent with Frame requests.
  static const int maxFrameHistory = 10;

  /// Max file upload size (10 MB).
  static const int maxUploadSize = 10 * 1024 * 1024;
}
