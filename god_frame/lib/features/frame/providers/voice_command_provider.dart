import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../data/voice_command.dart';
import '../data/gemini_live_client.dart';
import '../data/audio_upsampler.dart';
import '../data/frame_repository.dart';
import 'frame_connection_provider.dart';
import '../../../shared/services/foreground_service.dart';

/// Storage key for voice settings.
const String _voiceSettingsKey = 'voice_settings_v1';

/// Provider for voice settings (persisted in SharedPreferences).
final voiceSettingsProvider =
    StateNotifierProvider<VoiceSettingsNotifier, VoiceSettings>((ref) {
  return VoiceSettingsNotifier();
});

/// Notifier for voice settings persistence.
class VoiceSettingsNotifier extends StateNotifier<VoiceSettings> {
  VoiceSettingsNotifier() : super(const VoiceSettings()) {
    _load();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final json = prefs.getString(_voiceSettingsKey);
      if (json != null && json.isNotEmpty) {
        state = VoiceSettings.deserialize(json);
      } else {
        // Initialize with default commands
        state = VoiceSettings(commands: VoiceSettings.defaultCommands);
        await _save();
      }
      print('[VoiceSettings] Loaded: ${state.commands.length} commands');
    } catch (e) {
      print('[VoiceSettings] Load error: $e');
      state = VoiceSettings(commands: VoiceSettings.defaultCommands);
    }
  }

  Future<void> _save() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_voiceSettingsKey, state.serialize());
    } catch (e) {
      print('[VoiceSettings] Save error: $e');
    }
  }

  /// Update default conversation for voice messages.
  Future<void> setDefaultConversation(int? conversationId) async {
    state = state.copyWith(defaultConversationId: conversationId);
    await _save();
  }

  /// Update default agent name.
  Future<void> setDefaultAgent(String? agentName) async {
    state = state.copyWith(defaultAgentName: agentName);
    await _save();
  }

  /// Update Gemini API key.
  Future<void> setGeminiApiKey(String? key) async {
    state = state.copyWith(geminiApiKey: key);
    await _save();
  }

  /// Update Gemini voice.
  Future<void> setGeminiVoice(String voice) async {
    state = state.copyWith(geminiVoice: voice);
    await _save();
  }

  /// Update Gemini system instruction.
  Future<void> setGeminiSystemInstruction(String instruction) async {
    state = state.copyWith(geminiSystemInstruction: instruction);
    await _save();
  }

  /// Add a new voice command.
  Future<void> addCommand(VoiceCommand command) async {
    final commands = [...state.commands, command];
    state = state.copyWith(commands: commands);
    await _save();
  }

  /// Update an existing voice command.
  Future<void> updateCommand(VoiceCommand command) async {
    final commands = state.commands.map((c) => c.id == command.id ? command : c).toList();
    state = state.copyWith(commands: commands);
    await _save();
  }

  /// Remove a voice command.
  Future<void> removeCommand(String commandId) async {
    final commands = state.commands.where((c) => c.id != commandId).toList();
    state = state.copyWith(commands: commands);
    await _save();
  }

  /// Toggle command enabled/disabled.
  Future<void> toggleCommand(String commandId) async {
    final commands = state.commands.map((c) {
      if (c.id == commandId) return c.copyWith(enabled: !c.enabled);
      return c;
    }).toList();
    state = state.copyWith(commands: commands);
    await _save();
  }

  /// Reset to default commands.
  Future<void> resetToDefaults() async {
    state = VoiceSettings(
      commands: VoiceSettings.defaultCommands,
      defaultConversationId: state.defaultConversationId,
      defaultAgentName: state.defaultAgentName,
      geminiApiKey: state.geminiApiKey,
      geminiVoice: state.geminiVoice,
    );
    await _save();
  }

  // ─── TTS Settings ──────────────────────────────────────────────

  /// Toggle TTS on/off.
  Future<void> setTtsEnabled(bool enabled) async {
    state = state.copyWith(ttsEnabled: enabled);
    await _save();
  }

  /// Set TTS language.
  Future<void> setTtsLanguage(String language) async {
    state = state.copyWith(ttsLanguage: language);
    await _save();
  }

  /// Set TTS speech rate.
  Future<void> setTtsSpeechRate(double rate) async {
    state = state.copyWith(ttsSpeechRate: rate);
    await _save();
  }

  /// Set Voice Agent name for TTS optimization.
  Future<void> setTtsVoiceAgentName(String? name) async {
    state = state.copyWith(ttsVoiceAgentName: name);
    await _save();
  }

  /// Set Voice Agent prompt for TTS optimization.
  Future<void> setTtsVoiceAgentPrompt(String? prompt) async {
    state = state.copyWith(ttsVoiceAgentPrompt: prompt);
    await _save();
  }

  /// Toggle Frame-only TTS.
  Future<void> setTtsFrameOnly(bool frameOnly) async {
    state = state.copyWith(ttsFrameOnly: frameOnly);
    await _save();
  }
}

// ─── Gemini Live Mode State ──────────────────────────────────────

/// State for Gemini Live real-time mode.
enum GeminiLiveState {
  inactive,     // Not in real-time mode
  connecting,   // WebSocket connecting
  active,       // Streaming audio to/from Gemini
  error,        // Connection error
}

class GeminiLiveData {
  final GeminiLiveState state;
  final String? error;
  final String? lastTranscript; // Last recognized text from Gemini
  final bool isGeminiSpeaking;  // Whether Gemini is currently outputting audio

  const GeminiLiveData({
    this.state = GeminiLiveState.inactive,
    this.error,
    this.lastTranscript,
    this.isGeminiSpeaking = false,
  });

  GeminiLiveData copyWith({
    GeminiLiveState? state,
    String? error,
    String? lastTranscript,
    bool? isGeminiSpeaking,
  }) => GeminiLiveData(
    state: state ?? this.state,
    error: error,
    lastTranscript: lastTranscript ?? this.lastTranscript,
    isGeminiSpeaking: isGeminiSpeaking ?? this.isGeminiSpeaking,
  );
}

/// Provider for Gemini Live mode.
final geminiLiveProvider =
    StateNotifierProvider<GeminiLiveNotifier, GeminiLiveData>((ref) {
  final frameRepo = ref.watch(frameRepositoryProvider);
  final frameState = ref.watch(frameConnectionProvider);
  final voiceSettings = ref.watch(voiceSettingsProvider);
  return GeminiLiveNotifier(frameRepo, frameState.isConnected, voiceSettings);
});

/// Notifier for Gemini Live real-time voice mode.
class GeminiLiveNotifier extends StateNotifier<GeminiLiveData> {
  final FrameRepository _frameRepo;
  final bool _isFrameConnected;
  final VoiceSettings _settings;

  GeminiLiveClient? _client;
  StreamSubscription? _audioSub;
  StreamSubscription? _photoSub;
  StreamSubscription? _eventSub;
  Timer? _keepaliveTimer;
  Timer? _photoTimer;

  GeminiLiveNotifier(this._frameRepo, this._isFrameConnected, this._settings)
      : super(const GeminiLiveData());

  /// Start Gemini Live real-time mode.
  Future<bool> start() async {
    final apiKey = _settings.geminiApiKey;
    if (apiKey == null || apiKey.isEmpty) {
      state = state.copyWith(
        state: GeminiLiveState.error,
        error: 'Gemini API key not set. Configure it in Voice Settings.',
      );
      return false;
    }

    state = state.copyWith(state: GeminiLiveState.connecting);

    // Update notification
    if (ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: 'Gemini Live: Connecting...',
      );
    }

    try {
      _client = GeminiLiveClient(
        onLog: (msg) => print('[GeminiLive] $msg'),
        audioReadyCallback: () {
          if (state.state == GeminiLiveState.active) {
            state = state.copyWith(isGeminiSpeaking: true);
          }
        },
      );

      final voiceName = GeminiVoiceName.values.firstWhere(
        (v) => v.name == _settings.geminiVoice,
        orElse: () => GeminiVoiceName.Kore,
      );

      final connected = await _client!.connect(
        apiKey,
        voiceName,
        _settings.geminiSystemInstruction,
      );

      if (!connected) {
        state = state.copyWith(
          state: GeminiLiveState.error,
          error: 'Failed to connect to Gemini',
        );
        return false;
      }

      // Listen for Gemini events
      _eventSub = _client!.events.listen((event) {
        switch (event.type) {
          case GeminiEventType.setupComplete:
            print('[GeminiLive] Setup complete — starting audio stream');
            _startAudioStreaming();
            break;
          case GeminiEventType.audioResponse:
            // Audio is buffered in client, UI should read it
            break;
          case GeminiEventType.textResponse:
            state = state.copyWith(lastTranscript: event.text);
            break;
          case GeminiEventType.interrupted:
            state = state.copyWith(isGeminiSpeaking: false);
            break;
          case GeminiEventType.turnComplete:
            state = state.copyWith(isGeminiSpeaking: false);
            break;
          case GeminiEventType.error:
            state = state.copyWith(
              state: GeminiLiveState.error,
              error: event.error,
            );
            break;
        }
      });

      state = state.copyWith(state: GeminiLiveState.active);

      if (ForegroundServiceManager.isRunning) {
        await ForegroundServiceManager.updateNotification(
          title: 'GOD Frame',
          text: 'Gemini Live: Active',
        );
      }

      return true;
    } catch (e) {
      state = state.copyWith(
        state: GeminiLiveState.error,
        error: e.toString(),
      );
      return false;
    }
  }

  /// Start streaming audio from Frame to Gemini.
  void _startAudioStreaming() {
    if (_isFrameConnected) {
      // Listen for Frame audio chunks and forward to Gemini
      _audioSub = _frameRepo.audioStream.listen((audioData) {
        if (_client != null && _client!.isConnected) {
          // Convert Frame 8-bit 8kHz PCM → 16-bit 16kHz for Gemini
          final pcm16x16k = AudioUpsampler.frameToGemini(audioData);
          _client!.sendAudio(pcm16x16k);
        }
      });

      // Start Frame capture
      _frameRepo.startCapture();

      // Keepalive every 2 seconds
      _keepaliveTimer?.cancel();
      _keepaliveTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        if (_isFrameConnected) _frameRepo.sendHold();
      });

      // Send periodic photos every 5 seconds
      _photoSub = _frameRepo.photoStream.listen((photoData) {
        if (_client != null && _client!.isConnected) {
          _client!.sendImage(photoData);
        }
      });
    }
  }

  /// Stop Gemini Live mode.
  Future<void> stop() async {
    // Stop Frame streaming
    _audioSub?.cancel();
    _audioSub = null;
    _photoSub?.cancel();
    _photoSub = null;
    _keepaliveTimer?.cancel();
    _keepaliveTimer = null;
    _photoTimer?.cancel();
    _photoTimer = null;

    if (_isFrameConnected) {
      await _frameRepo.stopCapture();
    }

    // Disconnect Gemini
    _eventSub?.cancel();
    _eventSub = null;
    _client?.dispose();
    _client = null;

    state = const GeminiLiveData();

    if (ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: _isFrameConnected ? 'Connected to Frame' : 'Ready',
      );
    }
  }

  /// Get the Gemini client (for audio playback in UI).
  GeminiLiveClient? get client => _client;

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}
