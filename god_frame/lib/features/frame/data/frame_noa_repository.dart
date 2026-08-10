import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../../../core/config.dart';
import '../../../shared/utils/api_client.dart';

/// Type alias for voice_mode_provider compatibility.
typedef NoaResponse = FrameNoaResponse;

/// Response from /frame/noa endpoint.
class FrameNoaResponse {
  final String userPrompt;
  final String message;
  final String? image;  // base64 image
  final String? audio;  // base64 MP3
  final int? conversationId;
  final bool topicChanged;

  const FrameNoaResponse({
    required this.userPrompt,
    required this.message,
    this.image,
    this.audio,
    this.conversationId,
    this.topicChanged = false,
  });

  factory FrameNoaResponse.fromJson(Map<String, dynamic> json) {
    return FrameNoaResponse(
      userPrompt: json['user_prompt'] ?? '',
      message: json['message'] ?? '',
      image: json['image'],
      audio: json['audio'],
      conversationId: json['conversation_id'],
      topicChanged: json['debug']?['topic_changed'] ?? false,
    );
  }
}

/// Repository for Frame Noa API calls.
class FrameNoaRepository {
  final Dio _dio;

  FrameNoaRepository(this._dio);

  /// Send audio + image from Frame to GOD CRM backend.
  ///
  /// Returns AI response to display on Frame.
  Future<ApiResult<FrameNoaResponse>> sendFrameInput({
    Uint8List? audioData,
    Uint8List? imageData,
    List<Map<String, String>>? messages,
    String? location,
    String? time,
    int? conversationId,
  }) async {
    try {
      final formData = FormData();

      // Add audio file
      if (audioData != null && audioData.isNotEmpty) {
        formData.files.add(MapEntry(
          'audio',
          MultipartFile.fromBytes(
            audioData,
            filename: 'audio.wav',
            contentType: DioMediaType('audio', 'wav'),
          ),
        ));
      }

      // Add image file
      if (imageData != null && imageData.isNotEmpty) {
        formData.files.add(MapEntry(
          'image',
          MultipartFile.fromBytes(
            imageData,
            filename: 'image.jpg',
            contentType: DioMediaType('image', 'jpeg'),
          ),
        ));
      }

      // Add text fields
      if (messages != null && messages.isNotEmpty) {
        formData.fields.add(MapEntry('messages', _encodeJson(messages)));
      }
      if (location != null) {
        formData.fields.add(MapEntry('location', location));
      }
      if (time != null) {
        formData.fields.add(MapEntry('time', time));
      }
      if (conversationId != null) {
        formData.fields.add(MapEntry('conversation_id', conversationId.toString()));
      }

      // Dio auto-detects FormData and sets multipart/form-data with correct boundary.
      // Since BaseOptions uses contentType property (not headers map), Dio can override it.
      final response = await _dio.post(
        AppConfig.frameNoaPath,
        data: formData,
        options: Options(
          receiveTimeout: const Duration(seconds: 90),
          // No contentType or Content-Type header override needed —
          // Dio automatically sets multipart/form-data when data is FormData.
        ),
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final data = body is Map<String, dynamic> ? body : <String, dynamic>{};
        return ApiResult.success(FrameNoaResponse.fromJson(data));
      }

      return ApiResult.failure(
        'Server error: ${response.statusCode}',
        response.statusCode,
      );
    } on DioException catch (e) {
      // Build detailed error message for debugging
      final statusCode = e.response?.statusCode;
      final responseData = e.response?.data;
      String msg;
      if (responseData is Map) {
        msg = responseData['error']?['message']?.toString() ??
            responseData['message']?.toString() ??
            responseData['error']?.toString() ??
            'Server error ($statusCode)';
      } else if (responseData is String && responseData.isNotEmpty) {
        msg = responseData.length > 200 ? responseData.substring(0, 200) : responseData;
      } else {
        msg = e.message ?? 'Connection error';
      }
      // Add status code context
      if (statusCode != null && !msg.contains(statusCode.toString())) {
        msg = '$msg (HTTP $statusCode)';
      }
      return ApiResult.failure(msg, statusCode);
    } catch (e) {
      return ApiResult.failure('Unexpected error: ${e.toString()}');
    }
  }

  /// Send text input directly (from local STT) — no audio file needed.
  /// Backend handles text as already-transcribed user prompt.
  Future<ApiResult<FrameNoaResponse>> sendTextInput({
    required String text,
    List<Map<String, String>>? messages,
    String? location,
    String? time,
    int? conversationId,
  }) async {
    try {
      final formData = FormData();

      // Send the transcribed text as 'text' field
      formData.fields.add(MapEntry('text', text));

      if (messages != null && messages.isNotEmpty) {
        formData.fields.add(MapEntry('messages', _encodeJson(messages)));
      }
      if (location != null) {
        formData.fields.add(MapEntry('location', location));
      }
      if (time != null) {
        formData.fields.add(MapEntry('time', time));
      }
      if (conversationId != null) {
        formData.fields.add(MapEntry('conversation_id', conversationId.toString()));
      }

      final response = await _dio.post(
        AppConfig.frameNoaPath,
        data: formData,
        options: Options(
          receiveTimeout: const Duration(seconds: 90),
        ),
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final data = body is Map<String, dynamic> ? body : <String, dynamic>{};
        return ApiResult.success(FrameNoaResponse.fromJson(data));
      }

      return ApiResult.failure(
        'Server error: ${response.statusCode}',
        response.statusCode,
      );
    } on DioException catch (e) {
      final statusCode = e.response?.statusCode;
      final responseData = e.response?.data;
      String msg;
      if (responseData is Map) {
        msg = responseData['error']?['message']?.toString() ??
            responseData['message']?.toString() ??
            responseData['error']?.toString() ??
            'Server error ($statusCode)';
      } else if (responseData is String && responseData.isNotEmpty) {
        msg = responseData.length > 200 ? responseData.substring(0, 200) : responseData;
      } else {
        msg = e.message ?? 'Connection error';
      }
      if (statusCode != null && !msg.contains(statusCode.toString())) {
        msg = '$msg (HTTP $statusCode)';
      }
      return ApiResult.failure(msg, statusCode);
    } catch (e) {
      return ApiResult.failure('Unexpected error: ${e.toString()}');
    }
  }

  String _encodeJson(dynamic data) {
    return jsonEncode(data);
  }
}
