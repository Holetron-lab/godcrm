import 'dart:async';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'voice_command.dart';
import '../../../shared/utils/api_client.dart';

/// TTS playback state.
enum TtsState { idle, speaking, paused }

/// TTS service for reading AI responses aloud.
/// Optionally uses a "Voice Agent" in CRM to pre-process/optimize text
/// before speaking (remove tables, simplify numbers, translate, etc.).
class TtsService {
  final FlutterTts _tts = FlutterTts();
  TtsState _state = TtsState.idle;
  final Dio? _dio;

  TtsState get state => _state;
  bool get isSpeaking => _state == TtsState.speaking;

  /// Callbacks for UI state updates.
  void Function(TtsState)? onStateChanged;

  TtsService({Dio? dio}) : _dio = dio {
    _init();
  }

  Future<void> _init() async {
    // Configure TTS engine
    await _tts.setLanguage('en-US');
    await _tts.setSpeechRate(0.5); // 0.0 - 1.0
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);

    // Try to set a good voice
    final voices = await _tts.getVoices;
    if (voices is List && voices.isNotEmpty) {
      // Prefer Google TTS voices on Android
      final googleVoice = voices.firstWhere(
        (v) => v is Map && (v['name']?.toString().contains('Google') ?? false),
        orElse: () => null,
      );
      if (googleVoice != null && googleVoice is Map) {
        await _tts.setVoice({
          'name': googleVoice['name'].toString(),
          'locale': googleVoice['locale']?.toString() ?? 'en-US',
        });
      }
    }

    // State callbacks
    _tts.setStartHandler(() {
      _state = TtsState.speaking;
      onStateChanged?.call(_state);
    });

    _tts.setCompletionHandler(() {
      _state = TtsState.idle;
      onStateChanged?.call(_state);
    });

    _tts.setCancelHandler(() {
      _state = TtsState.idle;
      onStateChanged?.call(_state);
    });

    _tts.setPauseHandler(() {
      _state = TtsState.paused;
      onStateChanged?.call(_state);
    });

    _tts.setContinueHandler(() {
      _state = TtsState.speaking;
      onStateChanged?.call(_state);
    });

    _tts.setErrorHandler((msg) {
      print('[TTS] Error: $msg');
      _state = TtsState.idle;
      onStateChanged?.call(_state);
    });
  }

  /// Set TTS language (e.g., 'ru-RU', 'en-US').
  Future<void> setLanguage(String lang) async {
    await _tts.setLanguage(lang);
  }

  /// Set speech rate (0.0 - 1.0).
  Future<void> setSpeechRate(double rate) async {
    await _tts.setSpeechRate(rate);
  }

  /// Speak text directly (no voice agent pre-processing).
  Future<void> speak(String text) async {
    if (text.trim().isEmpty) return;

    // Basic cleanup for markdown before speaking
    final cleaned = _cleanForSpeech(text);
    if (cleaned.isEmpty) return;

    await stop(); // Stop any current speech
    await _tts.speak(cleaned);
  }

  /// Speak text with Voice Agent pre-processing.
  /// Sends text to Voice Agent for optimization, then speaks the result.
  Future<void> speakWithAgent({
    required String text,
    required String voiceAgentName,
    String? voiceAgentPrompt,
    int? conversationId,
  }) async {
    if (text.trim().isEmpty || _dio == null) {
      await speak(text);
      return;
    }

    try {
      // Send to voice agent for optimization
      final optimized = await _processWithVoiceAgent(
        text: text,
        agentName: voiceAgentName,
        prompt: voiceAgentPrompt,
        conversationId: conversationId,
      );

      await speak(optimized ?? text);
    } catch (e) {
      print('[TTS] Voice agent failed, speaking raw text: $e');
      await speak(text);
    }
  }

  /// Process text through a CRM Voice Agent for optimization.
  Future<String?> _processWithVoiceAgent({
    required String text,
    required String agentName,
    String? prompt,
    int? conversationId,
  }) async {
    if (_dio == null) return null;

    try {
      final defaultPrompt =
          'Optimize this text for voice reading. '
          'Remove markdown formatting, tables, code blocks. '
          'Spell out abbreviations. Make it natural for spoken delivery. '
          'Keep it concise. Return ONLY the optimized text, nothing else.';

      final response = await _dio!.post(
        '/api/v3/frame/tts-optimize',
        data: {
          'text': text,
          'agent_name': agentName,
          'prompt': prompt ?? defaultPrompt,
          if (conversationId != null) 'conversation_id': conversationId,
        },
      );

      if (response.statusCode == 200 && response.data is Map) {
        return response.data['optimized_text'] as String?;
      }
    } catch (e) {
      print('[TTS] Voice agent API call failed: $e');
    }

    return null;
  }

  /// Clean markdown/formatting for speech.
  String _cleanForSpeech(String text) {
    var cleaned = text;

    // Remove markdown headers
    cleaned = cleaned.replaceAll(RegExp(r'^#{1,6}\s+', multiLine: true), '');

    // Remove bold/italic markers
    cleaned = cleaned.replaceAll(RegExp(r'\*{1,3}'), '');
    cleaned = cleaned.replaceAll(RegExp(r'_{1,3}'), ' ');

    // Remove markdown links — keep text, drop URL
    cleaned = cleaned.replaceAll(RegExp(r'\[([^\]]+)\]\([^)]+\)'), r'$1');

    // Remove code blocks
    cleaned = cleaned.replaceAll(RegExp(r'```[\s\S]*?```'), ' code block omitted ');
    cleaned = cleaned.replaceAll(RegExp(r'`([^`]+)`'), r'$1');

    // Remove markdown tables (| col1 | col2 |)
    cleaned = cleaned.replaceAll(RegExp(r'\|[-:\s|]+\|', multiLine: true), '');
    cleaned = cleaned.replaceAllMapped(RegExp(r'^\|.*\|$', multiLine: true), (match) {
      // Convert table rows to comma-separated
      final cells = match[0]!.split('|').where((s) => s.trim().isNotEmpty).map((s) => s.trim());
      return cells.join(', ');
    });

    // Remove bullet points
    cleaned = cleaned.replaceAll(RegExp(r'^[\s]*[-*+]\s+', multiLine: true), '');
    cleaned = cleaned.replaceAll(RegExp(r'^[\s]*\d+\.\s+', multiLine: true), '');

    // Remove HTML tags
    cleaned = cleaned.replaceAll(RegExp(r'<[^>]+>'), '');

    // Remove emojis (common unicode ranges)
    cleaned = cleaned.replaceAll(RegExp(
      r'[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]',
      unicode: true,
    ), '');

    // Collapse multiple spaces/newlines
    cleaned = cleaned.replaceAll(RegExp(r'\n{2,}'), '. ');
    cleaned = cleaned.replaceAll(RegExp(r'\n'), ' ');
    cleaned = cleaned.replaceAll(RegExp(r'\s{2,}'), ' ');

    return cleaned.trim();
  }

  /// Stop speaking.
  Future<void> stop() async {
    await _tts.stop();
    _state = TtsState.idle;
    onStateChanged?.call(_state);
  }

  /// Pause speaking.
  Future<void> pause() async {
    await _tts.pause();
  }

  /// Get available languages.
  Future<List<String>> getLanguages() async {
    final langs = await _tts.getLanguages;
    if (langs is List) {
      return langs.map((l) => l.toString()).toList()..sort();
    }
    return [];
  }

  /// Dispose.
  void dispose() {
    _tts.stop();
  }
}

/// TTS service provider (singleton).
final ttsServiceProvider = Provider<TtsService>((ref) {
  Dio? dio;
  try {
    dio = ref.watch(apiClientProvider);
  } catch (_) {}
  final service = TtsService(dio: dio);
  ref.onDispose(() => service.dispose());
  return service;
});
