import 'dart:async';
import 'dart:convert';
import 'dart:collection';
import 'dart:typed_data';
import 'dart:ui' show VoidCallback;
import 'package:web_socket_channel/web_socket_channel.dart';

/// Gemini voice names.
enum GeminiVoiceName {
  Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr,
}

/// Events from the Gemini Live stream.
enum GeminiEventType {
  setupComplete,
  audioResponse,
  textResponse,
  interrupted,
  turnComplete,
  error,
}

/// An event from the Gemini Live WebSocket.
class GeminiEvent {
  final GeminiEventType type;
  final Uint8List? audioData;
  final String? text;
  final String? error;

  const GeminiEvent({required this.type, this.audioData, this.text, this.error});
}

/// Client for Gemini's BidiGenerateContent WebSocket API.
/// Enables real-time voice-to-voice conversation with Gemini.
///
/// Audio formats:
/// - Input:  PCM16 mono 16kHz (base64-encoded in JSON)
/// - Output: PCM16 mono 24kHz (base64-encoded in JSON)
class GeminiLiveClient {
  static const String _wsBaseUrl =
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

  static const String _model = 'models/gemini-2.0-flash-live-001';

  WebSocketChannel? _channel;
  StreamSubscription? _channelSubs;
  bool _connected = false;

  /// Buffered audio chunks from Gemini response.
  final Queue<Uint8List> _audioBuffer = Queue();

  /// Event stream for the UI to listen to.
  final _eventController = StreamController<GeminiEvent>.broadcast();

  /// Callback for logging.
  final void Function(String)? onLog;

  /// Callback when audio is ready to play.
  VoidCallback? audioReadyCallback;

  GeminiLiveClient({this.onLog, this.audioReadyCallback});

  /// Whether the WebSocket is connected.
  bool get isConnected => _connected;

  /// Event stream.
  Stream<GeminiEvent> get events => _eventController.stream;

  /// Whether there's buffered audio to play.
  bool hasResponseAudio() => _audioBuffer.isNotEmpty;

  /// Get the next chunk of response audio (PCM16 24kHz).
  Uint8List? getResponseAudioChunk() {
    if (_audioBuffer.isEmpty) return null;
    return _audioBuffer.removeFirst();
  }

  /// Stop response audio (clear buffer for interruption).
  void stopResponseAudio() {
    _audioBuffer.clear();
  }

  /// Setup message template.
  Map<String, dynamic> _buildSetupMap(GeminiVoiceName voice, String systemInstruction) => {
    'setup': {
      'model': _model,
      'generation_config': {
        'response_modalities': ['AUDIO'],
        'speech_config': {
          'voice_config': {
            'prebuilt_voice_config': {
              'voice_name': voice.name,
            }
          }
        }
      },
      'system_instruction': {
        'parts': [
          {'text': systemInstruction}
        ]
      }
    }
  };

  /// Audio input message template.
  Map<String, dynamic> _buildAudioInputMap(String base64Audio) => {
    'realtime_input': {
      'media_chunks': [
        {
          'mime_type': 'audio/pcm;rate=16000',
          'data': base64Audio,
        }
      ]
    }
  };

  /// Image input message template.
  Map<String, dynamic> _buildImageInputMap(String base64Jpeg) => {
    'realtime_input': {
      'media_chunks': [
        {
          'mime_type': 'image/jpeg',
          'data': base64Jpeg,
        }
      ]
    }
  };

  /// Connect to Gemini Live API.
  Future<bool> connect(String apiKey, GeminiVoiceName voice, String systemInstruction) async {
    if (_connected) {
      _log('Already connected');
      return true;
    }

    try {
      final url = '$_wsBaseUrl?key=$apiKey';
      _log('Connecting to Gemini Live...');

      _channel = WebSocketChannel.connect(Uri.parse(url));
      await _channel!.ready;

      _connected = true;
      _log('WebSocket connected');

      // Listen for incoming events
      _channelSubs = _channel!.stream.listen(
        _handleGeminiEvent,
        onError: (error) {
          _log('WebSocket error: $error');
          _eventController.add(GeminiEvent(type: GeminiEventType.error, error: error.toString()));
          _connected = false;
        },
        onDone: () {
          _log('WebSocket closed');
          _connected = false;
        },
      );

      // Send setup message
      final setupMap = _buildSetupMap(voice, systemInstruction);
      _channel!.sink.add(jsonEncode(setupMap));
      _log('Setup message sent (voice: ${voice.name})');

      return true;
    } catch (e) {
      _log('Connection failed: $e');
      _connected = false;
      _eventController.add(GeminiEvent(type: GeminiEventType.error, error: e.toString()));
      return false;
    }
  }

  /// Send PCM16 audio to Gemini (16kHz mono).
  void sendAudio(Uint8List pcm16x16k) {
    if (!_connected || _channel == null) {
      _log('Cannot send audio: not connected');
      return;
    }

    final base64Audio = base64Encode(pcm16x16k);
    final msg = _buildAudioInputMap(base64Audio);
    _channel!.sink.add(jsonEncode(msg));
  }

  /// Send a JPEG image to Gemini.
  void sendImage(Uint8List jpegData) {
    if (!_connected || _channel == null) {
      _log('Cannot send image: not connected');
      return;
    }

    final base64Jpeg = base64Encode(jpegData);
    final msg = _buildImageInputMap(base64Jpeg);
    _channel!.sink.add(jsonEncode(msg));
    _log('Image sent (${jpegData.length} bytes)');
  }

  /// Handle incoming WebSocket event from Gemini.
  void _handleGeminiEvent(dynamic eventJson) {
    try {
      final String eventString;
      if (eventJson is String) {
        eventString = eventJson;
      } else if (eventJson is List<int>) {
        eventString = utf8.decode(eventJson);
      } else {
        _log('Unknown event type: ${eventJson.runtimeType}');
        return;
      }

      final event = jsonDecode(eventString) as Map<String, dynamic>;

      // Check for setupComplete
      if (event.containsKey('setupComplete')) {
        _log('Setup complete');
        _eventController.add(const GeminiEvent(type: GeminiEventType.setupComplete));
        return;
      }

      // Check for serverContent
      final serverContent = event['serverContent'] as Map<String, dynamic>?;
      if (serverContent != null) {
        // Check for interruption
        if (serverContent['interrupted'] != null) {
          _audioBuffer.clear();
          _log('---Interruption---');
          _eventController.add(const GeminiEvent(type: GeminiEventType.interrupted));
          return;
        }

        // Check for turn complete
        if (serverContent['turnComplete'] != null) {
          _log('Turn complete');
          _eventController.add(const GeminiEvent(type: GeminiEventType.turnComplete));
          return;
        }

        // Check for audio data in modelTurn
        final modelTurn = serverContent['modelTurn'] as Map<String, dynamic>?;
        if (modelTurn != null) {
          final parts = modelTurn['parts'] as List?;
          if (parts != null) {
            for (final part in parts) {
              if (part is Map<String, dynamic>) {
                final inlineData = part['inlineData'] as Map<String, dynamic>?;
                if (inlineData != null) {
                  final mimeType = inlineData['mimeType']?.toString() ?? '';
                  final data = inlineData['data'] as String?;

                  if (mimeType.startsWith('audio/') && data != null) {
                    try {
                      final decoded = base64Decode(data);
                      _audioBuffer.add(decoded);
                      audioReadyCallback?.call();
                      _eventController.add(GeminiEvent(
                        type: GeminiEventType.audioResponse,
                        audioData: decoded,
                      ));
                    } catch (e) {
                      _log('Failed to decode audio: $e');
                    }
                  } else if (mimeType.startsWith('text/') && data != null) {
                    _eventController.add(GeminiEvent(
                      type: GeminiEventType.textResponse,
                      text: data,
                    ));
                  }
                }

                // Check for text parts
                final text = part['text'] as String?;
                if (text != null) {
                  _eventController.add(GeminiEvent(
                    type: GeminiEventType.textResponse,
                    text: text,
                  ));
                }
              }
            }
          }
        }
      }
    } catch (e) {
      _log('Event parse error: $e');
    }
  }

  /// Disconnect from Gemini Live.
  Future<void> disconnect() async {
    _connected = false;
    _audioBuffer.clear();
    await _channelSubs?.cancel();
    _channelSubs = null;
    await _channel?.sink.close();
    _channel = null;
    _log('Disconnected');
  }

  /// Dispose resources.
  void dispose() {
    disconnect();
    _eventController.close();
  }

  void _log(String msg) {
    onLog?.call(msg);
    print('[GeminiLive] $msg');
  }
}
