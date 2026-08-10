import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';
import 'package:audio_session/audio_session.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../data/frame_noa_repository.dart';
import '../data/frame_repository.dart';
import '../data/voice_command.dart';
import '../data/tts_service.dart';
import '../../chat/data/models.dart';
import '../../chat/providers/messages_provider.dart';
import '../../../shared/utils/api_client.dart';
import 'frame_connection_provider.dart';
import 'voice_command_provider.dart';
import '../../../shared/services/foreground_service.dart';

/// Voice mode states.
enum VoiceModeState {
  idle,        // Waiting for tap
  listening,   // Recording audio + capturing photo
  processing,  // Sending to backend
  displaying,  // Showing response on Frame
  error,       // Something went wrong
  geminiLive,  // Gemini Live real-time mode active
}

/// Voice mode state.
class VoiceModeData {
  final VoiceModeState state;
  final String? lastPrompt;
  final String? lastResponse;
  final String? error;
  final List<Map<String, String>> conversationHistory;
  final String? partialText; // Real-time partial STT text
  final String? activeCommand; // Currently matched command label

  const VoiceModeData({
    this.state = VoiceModeState.idle,
    this.lastPrompt,
    this.lastResponse,
    this.error,
    this.conversationHistory = const [],
    this.partialText,
    this.activeCommand,
  });

  VoiceModeData copyWith({
    VoiceModeState? state,
    String? lastPrompt,
    String? lastResponse,
    String? error,
    List<Map<String, String>>? conversationHistory,
    String? partialText,
    String? activeCommand,
  }) {
    return VoiceModeData(
      state: state ?? this.state,
      lastPrompt: lastPrompt ?? this.lastPrompt,
      lastResponse: lastResponse ?? this.lastResponse,
      error: error,
      conversationHistory: conversationHistory ?? this.conversationHistory,
      partialText: partialText,
      activeCommand: activeCommand,
    );
  }
}

/// Frame Noa API repository provider.
final frameNoaRepositoryProvider = Provider<FrameNoaRepository>((ref) {
  final dio = ref.watch(apiClientProvider);
  return FrameNoaRepository(dio);
});

/// Voice mode provider — now with voice command routing + TTS.
final voiceModeProvider =
    StateNotifierProvider<VoiceModeNotifier, VoiceModeData>((ref) {
  final frameRepo = ref.watch(frameRepositoryProvider);
  final noaRepo = ref.watch(frameNoaRepositoryProvider);
  final messagesNotifier = ref.watch(messagesProvider.notifier);
  final frameState = ref.watch(frameConnectionProvider);
  final voiceSettings = ref.watch(voiceSettingsProvider);
  final ttsService = ref.watch(ttsServiceProvider);

  return VoiceModeNotifier(
    frameRepo, noaRepo, messagesNotifier,
    frameState.isConnected, voiceSettings, ttsService,
  );
});

class VoiceModeNotifier extends StateNotifier<VoiceModeData> {
  final FrameRepository _frameRepo;
  final FrameNoaRepository _noaRepo;
  final MessagesNotifier _messagesNotifier;
  final bool _isFrameConnected;
  final VoiceSettings _voiceSettings;
  final TtsService _ttsService;

  StreamSubscription? _tapSub;
  StreamSubscription? _audioSub;
  StreamSubscription? _photoSub;

  Uint8List? _capturedAudio;
  Uint8List? _capturedPhoto;
  Timer? _holdTimer;
  Timer? _keepaliveTimer;
  Timer? _recordingTimeout;
  Timer? _stopTimeout; // Timeout after stop — force-process if no audioFinal
  bool _waitingForCapture = false;

  static const int _maxRecordingSeconds = 60;

  // Phone mic recorder (for Whisper API fallback)
  final AudioRecorder _recorder = AudioRecorder();
  String? _recordingPath;
  bool _isRecording = false;

  // Local speech-to-text engine (primary for phone)
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _speechAvailable = false;
  bool _usingSpeechToText = false;
  String _recognizedText = '';

  /// Callback to notify when Gemini Live mode should be activated.
  /// Set by the UI (VoiceModeScreen) to handle the transition.
  void Function()? onGeminiLiveRequested;

  VoiceModeNotifier(
    this._frameRepo,
    this._noaRepo,
    this._messagesNotifier,
    this._isFrameConnected,
    this._voiceSettings,
    this._ttsService,
  ) : super(const VoiceModeData()) {
    _setupListeners();
    _setupMediaButtons();
    _initSpeechToText();
    _ensureForegroundService();
  }

  /// Start foreground service if not already running.
  Future<void> _ensureForegroundService() async {
    if (!ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.requestNotificationPermission();
      await ForegroundServiceManager.start(
        title: 'GOD Frame',
        text: _isFrameConnected ? 'Connected to Frame' : 'Voice mode ready',
      );
    }
  }

  /// Initialize local speech-to-text engine.
  Future<void> _initSpeechToText() async {
    try {
      _speechAvailable = await _speech.initialize(
        onError: (error) {
          print('[STT] Error: ${error.errorMsg}');
        },
        onStatus: (status) {
          print('[STT] Status: $status');
          if (status == 'done' && _usingSpeechToText && state.state == VoiceModeState.listening) {
            _finishLocalSTT();
          }
        },
      );
      print('[STT] Speech-to-text available: $_speechAvailable');
      if (_speechAvailable) {
        final locales = await _speech.locales();
        print('[STT] Available locales: ${locales.map((l) => l.localeId).take(5).join(', ')}...');
      }
    } catch (e) {
      print('[STT] Init failed (will use Whisper API): $e');
      _speechAvailable = false;
    }
  }

  void _setupListeners() {
    _tapSub = _frameRepo.tapStream.listen((_) => _handleTap());
    _audioSub = _frameRepo.audioStream.listen((audio) {
      _capturedAudio = audio;
      print('[Voice] Audio received: ${audio.length} bytes, state=${state.state}');
      // Cancel stop timeout — we got audio!
      _stopTimeout?.cancel();
      _stopTimeout = null;
      if ((state.state == VoiceModeState.listening || state.state == VoiceModeState.processing) && _isFrameConnected) {
        print('[Voice] Auto-processing: audioFinal received (state=${state.state})');
        _waitingForCapture = false;
        _recordingTimeout?.cancel();
        _keepaliveTimer?.cancel();
        _holdTimer?.cancel();
        _processCapture();
        return;
      }
      _checkCaptureComplete();
    });
    _photoSub = _frameRepo.photoStream.listen((photo) {
      _capturedPhoto = photo;
      _checkCaptureComplete();
    });
  }

  /// Setup Bluetooth headset media button handling.
  Future<void> _setupMediaButtons() async {
    try {
      final session = await AudioSession.instance;
      await session.configure(const AudioSessionConfiguration(
        avAudioSessionCategory: AVAudioSessionCategory.playAndRecord,
        avAudioSessionCategoryOptions: AVAudioSessionCategoryOptions.defaultToSpeaker,
        avAudioSessionMode: AVAudioSessionMode.spokenAudio,
        avAudioSessionRouteSharingPolicy: AVAudioSessionRouteSharingPolicy.defaultPolicy,
        avAudioSessionSetActiveOptions: AVAudioSessionSetActiveOptions.none,
        androidAudioAttributes: AndroidAudioAttributes(
          contentType: AndroidAudioContentType.speech,
          flags: AndroidAudioFlags.none,
          usage: AndroidAudioUsage.voiceCommunication,
        ),
        androidAudioFocusGainType: AndroidAudioFocusGainType.gain,
        androidWillPauseWhenDucked: true,
      ));

      session.becomingNoisyEventStream.listen((_) {
        if (state.state == VoiceModeState.listening) {
          _stopListening();
        }
      });

      print('[Voice] Audio session configured for BT headset support');
    } catch (e) {
      print('[Voice] Audio session setup error (non-fatal): $e');
    }
  }

  void _handleTap() {
    print('[Voice] Tap received! Current state: ${state.state}');
    switch (state.state) {
      case VoiceModeState.idle:
        print('[Voice] Tap → starting listening');
        _startListening();
        break;
      case VoiceModeState.listening:
        print('[Voice] Tap → stopping listening');
        _stopListening();
        break;
      case VoiceModeState.displaying:
        print('[Voice] Tap → back to idle from display');
        state = state.copyWith(state: VoiceModeState.idle);
        break;
      case VoiceModeState.processing:
        print('[Voice] Tap during processing — ignored');
        break;
      case VoiceModeState.error:
        print('[Voice] Tap during error — resetting to idle');
        state = state.copyWith(state: VoiceModeState.idle);
        break;
      case VoiceModeState.geminiLive:
        // Double-tap during Gemini Live → exit real-time mode
        print('[Voice] Tap during Gemini Live — will be handled by GeminiLiveNotifier');
        break;
    }
  }

  /// Start recording — Frame BLE, local STT, or phone mic + Whisper API.
  Future<void> _startListening() async {
    state = state.copyWith(state: VoiceModeState.listening, error: null, partialText: null, activeCommand: null);
    if (!ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.requestNotificationPermission();
      await ForegroundServiceManager.start(title: 'GOD Frame', text: 'Listening...');
    } else {
      await ForegroundServiceManager.updateNotification(title: 'GOD Frame', text: 'Listening...');
    }
    _capturedAudio = null;
    _capturedPhoto = null;
    _waitingForCapture = true;
    _recognizedText = '';

    _recordingTimeout?.cancel();
    _recordingTimeout = Timer(Duration(seconds: _maxRecordingSeconds), () {
      print('[Voice] Recording auto-stopped after $_maxRecordingSeconds seconds');
      if (state.state == VoiceModeState.listening) {
        _stopListening();
      }
    });

    if (_isFrameConnected) {
      _keepaliveTimer?.cancel();
      _keepaliveTimer = Timer.periodic(const Duration(seconds: 2), (_) {
        if (_isFrameConnected && state.state == VoiceModeState.listening) {
          _frameRepo.sendHold();
        }
      });
      _frameRepo.sendHold();
      await _frameRepo.startCapture();
      _holdTimer?.cancel();
      _holdTimer = Timer(const Duration(seconds: 30), () {
        if (state.state == VoiceModeState.listening) {
          print('[Voice] Safety timeout: auto-stopping after 30s');
          _stopListening();
        }
      });

      // Start local STT in parallel as backup — in case Frame audio doesn't arrive
      if (_speechAvailable) {
        print('[Voice] Starting parallel local STT as backup for Frame');
        _usingSpeechToText = true;
        _recognizedText = '';
        _speech.listen(
          onResult: (result) {
            _recognizedText = result.recognizedWords;
            // Show partial text in UI for feedback
            if (state.state == VoiceModeState.listening) {
              state = state.copyWith(partialText: _recognizedText);
            }
            print('[STT] Parallel backup: $_recognizedText (final: ${result.finalResult})');
          },
          listenFor: const Duration(seconds: 30),
          pauseFor: const Duration(seconds: 5),
          partialResults: true,
          cancelOnError: false,
          listenMode: stt.ListenMode.dictation,
        ).catchError((e) {
          print('[STT] Parallel backup failed: $e');
          _usingSpeechToText = false;
        });
      }
      print('[Voice] Frame capture started — press Frame button or phone mic to stop');
    } else if (_speechAvailable) {
      await _startLocalSTT();
    } else {
      await _startPhoneMicRecording();
    }
  }

  Future<void> _stopListening() async {
    // Prevent double-stop
    if (state.state != VoiceModeState.listening && state.state != VoiceModeState.processing) {
      print('[Voice] _stopListening skipped — state is ${state.state}');
      return;
    }

    // === IMMEDIATE UI RESPONSE ===
    state = state.copyWith(state: VoiceModeState.processing, partialText: null);

    if (ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: _isFrameConnected ? 'Connected to Frame' : 'Processing...',
      );
    }
    _recordingTimeout?.cancel();
    _recordingTimeout = null;
    _keepaliveTimer?.cancel();
    _keepaliveTimer = null;
    _stopTimeout?.cancel();

    print('[Voice] _stopListening called, isFrame=$_isFrameConnected, usingStt=$_usingSpeechToText');

    if (_isFrameConnected) {
      // Send stop command to Frame (3x for reliability)
      await _frameRepo.stopCapture();
      await Future.delayed(const Duration(milliseconds: 100));
      await _frameRepo.stopCapture();
      await Future.delayed(const Duration(milliseconds: 100));
      await _frameRepo.stopCapture();
      _holdTimer?.cancel();
      _holdTimer = Timer.periodic(const Duration(seconds: 3), (_) {
        _frameRepo.sendHold();
      });

      // Check if we already have audio
      if (_capturedAudio != null && _capturedAudio!.isNotEmpty) {
        print('[Voice] Already have audio (${_capturedAudio!.length} bytes), processing now');
        _waitingForCapture = false;
        _processCapture();
        return;
      }

      // Start local STT as fallback in case Frame doesn't respond
      if (_speechAvailable && !_usingSpeechToText) {
        print('[Voice] Starting local STT as fallback while waiting for Frame audio');
        _usingSpeechToText = true;
        _speech.listen(
          onResult: (result) {
            _recognizedText = result.recognizedWords;
            print('[STT] Fallback partial: $_recognizedText');
          },
          listenFor: const Duration(seconds: 5),
          pauseFor: const Duration(seconds: 3),
          partialResults: true,
          cancelOnError: false,
          listenMode: stt.ListenMode.dictation,
        ).catchError((_) {
          _usingSpeechToText = false;
        });
      }

      // Safety timeout: if Frame doesn't send audioFinal within 4 seconds,
      // force-process whatever we have (audio > STT text > phone mic > error)
      _stopTimeout = Timer(const Duration(seconds: 4), () {
        print('[Voice] Stop timeout! No audioFinal received after 4s');
        // Stop parallel STT
        if (_usingSpeechToText) {
          _speech.stop();
          _usingSpeechToText = false;
        }
        _waitingForCapture = false;
        if (_capturedAudio != null && _capturedAudio!.isNotEmpty) {
          print('[Voice] Force-processing captured audio (${_capturedAudio!.length} bytes)');
          _processCapture();
        } else if (_recognizedText.trim().isNotEmpty) {
          print('[Voice] Using parallel STT text: "$_recognizedText"');
          _processTextInput(_recognizedText.trim());
        } else {
          print('[Voice] No audio and no STT text — trying phone mic fallback');
          // Last resort: start phone mic recording for 3 seconds
          _startPhoneMicRecording().then((_) {
            Timer(const Duration(seconds: 3), () {
              if (_isRecording) {
                _stopPhoneMicRecording();
              }
            });
          }).catchError((_) {
            state = state.copyWith(
              state: VoiceModeState.error,
              error: 'No audio received. Try speaking louder or closer.',
            );
            _autoRecoverAfterError(3);
          });
        }
      });
    } else if (_usingSpeechToText) {
      await _speech.stop();
      _finishLocalSTT();
    } else {
      await _stopPhoneMicRecording();
    }
  }

  /// Start local on-device speech-to-text.
  Future<void> _startLocalSTT() async {
    try {
      final micStatus = await Permission.microphone.request();
      if (!micStatus.isGranted) {
        state = state.copyWith(
          state: VoiceModeState.error,
          error: micStatus.isPermanentlyDenied
              ? 'Microphone permission permanently denied. Open Settings > App Permissions.'
              : 'Microphone permission denied.',
        );
        _autoRecoverAfterError(5);
        return;
      }

      _usingSpeechToText = true;
      _recognizedText = '';

      await _speech.listen(
        onResult: (result) {
          _recognizedText = result.recognizedWords;
          state = state.copyWith(partialText: _recognizedText);
          print('[STT] Partial: $_recognizedText (final: ${result.finalResult})');
          if (result.finalResult) {
            _finishLocalSTT();
          }
        },
        listenFor: const Duration(seconds: 30),
        pauseFor: const Duration(seconds: 3),
        partialResults: true,
        cancelOnError: false,
        listenMode: stt.ListenMode.dictation,
      );

      print('[STT] Listening started (on-device)');
    } catch (e) {
      print('[STT] Failed to start local STT, falling back to mic recording: $e');
      _usingSpeechToText = false;
      await _startPhoneMicRecording();
    }
  }

  /// Finish local STT — now with voice command parsing!
  void _finishLocalSTT() {
    if (!_usingSpeechToText) return;
    _usingSpeechToText = false;
    _waitingForCapture = false;

    if (_recognizedText.trim().isEmpty) {
      state = state.copyWith(
        state: VoiceModeState.error,
        error: 'No speech detected. Please try again and speak clearly.',
        partialText: null,
      );
      _autoRecoverAfterError(4);
      return;
    }

    print('[STT] Final text: "$_recognizedText"');

    // ═══ VOICE COMMAND PARSING ═══
    final parseResult = parseVoiceCommand(_recognizedText.trim(), _voiceSettings.commands);

    if (parseResult.hasCommand) {
      final cmd = parseResult.command!;
      print('[VoiceCmd] Matched command: "${cmd.label}" (action: ${cmd.action})');
      state = state.copyWith(activeCommand: cmd.label);

      switch (cmd.action) {
        case VoiceCommandAction.geminiLive:
          // Activate Gemini Live mode
          print('[VoiceCmd] → Activating Gemini Live mode');
          state = state.copyWith(
            state: VoiceModeState.geminiLive,
            partialText: null,
            lastPrompt: 'Gemini Live activated',
          );
          // Notify UI to start Gemini Live
          onGeminiLiveRequested?.call();
          return;

        case VoiceCommandAction.sendToAgent:
          // Route to specific agent: prepend @agent to the text
          final agentName = cmd.agentName ?? _voiceSettings.defaultAgentName ?? 'assistant';
          final text = parseResult.remainingText.isNotEmpty
              ? '@$agentName ${parseResult.remainingText}'
              : '@$agentName help';
          print('[VoiceCmd] → Sending to agent: $agentName, text: "$text"');
          _processTextInput(text);
          return;

        case VoiceCommandAction.sendToDefault:
          // Send remaining text to default chat
          final text = parseResult.remainingText.isNotEmpty
              ? parseResult.remainingText
              : parseResult.fullText;
          print('[VoiceCmd] → Sending to default: "$text"');
          _processTextInput(text);
          return;

        case VoiceCommandAction.takePhoto:
          // Trigger photo capture + AI analysis
          print('[VoiceCmd] → Taking photo for AI analysis');
          if (_isFrameConnected) {
            _frameRepo.startCapture();
            // Wait for photo, then process with remaining text as prompt
            _waitingForCapture = true;
            state = state.copyWith(state: VoiceModeState.processing, partialText: null);
          } else {
            _processTextInput(parseResult.remainingText.isNotEmpty
                ? parseResult.remainingText
                : 'What do you see?');
          }
          return;

        case VoiceCommandAction.custom:
          // Custom prompt template
          final template = cmd.promptTemplate ?? '{text}';
          final text = template.replaceAll('{text}', parseResult.remainingText);
          print('[VoiceCmd] → Custom prompt: "$text"');
          _processTextInput(text);
          return;
      }
    }

    // No command matched → default behavior: send to default agent or Noa
    print('[VoiceCmd] No command matched, using default route');
    final defaultAgent = _voiceSettings.defaultAgentName;
    if (defaultAgent != null && defaultAgent.isNotEmpty) {
      _processTextInput('@$defaultAgent ${parseResult.fullText}');
    } else {
      _processTextInput(parseResult.fullText);
    }
  }

  /// Process text input (from local STT) — send to backend as text prompt.
  Future<void> _processTextInput(String text) async {
    state = state.copyWith(state: VoiceModeState.processing, partialText: null);
    if (ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.updateNotification(title: 'GOD Frame', text: 'Processing voice...');
    }

    try {
      print('[Voice] Sending text to /frame/noa: "$text"');

      final result = await _noaRepo.sendTextInput(
        text: text,
        messages: state.conversationHistory.isNotEmpty
            ? state.conversationHistory
            : null,
        time: DateTime.now().toIso8601String(),
        conversationId: _voiceSettings.defaultConversationId,
      );

      print('[Voice] Response: success=${result.isSuccess}, error=${result.error}');

      if (result.isSuccess) {
        _handleSuccessfulResponse(result.data!, text);
      } else {
        _handleErrorResponse(result.error ?? 'Unknown error', result.statusCode);
      }
    } catch (e) {
      print('[Voice] Exception: $e');
      state = state.copyWith(state: VoiceModeState.error, error: e.toString());
      _autoRecoverAfterError(8);
    }
  }

  /// Start recording from phone microphone (for Whisper API fallback).
  Future<void> _startPhoneMicRecording() async {
    try {
      final micStatus = await Permission.microphone.request();
      if (!micStatus.isGranted) {
        state = state.copyWith(
          state: VoiceModeState.error,
          error: micStatus.isPermanentlyDenied
              ? 'Microphone permission permanently denied. Open Settings > App Permissions.'
              : 'Microphone permission denied.',
        );
        _autoRecoverAfterError(5);
        return;
      }

      final hasRecordPerm = await _recorder.hasPermission();
      if (!hasRecordPerm) {
        state = state.copyWith(
          state: VoiceModeState.error,
          error: 'Audio recorder not available. Please check microphone access.',
        );
        _autoRecoverAfterError(4);
        return;
      }

      final dir = await getTemporaryDirectory();
      _recordingPath = '${dir.path}/voice_recording_${DateTime.now().millisecondsSinceEpoch}.wav';

      _isRecording = true;
      _usingSpeechToText = false;

      try {
        await _recorder.start(
          const RecordConfig(
            encoder: AudioEncoder.wav,
            sampleRate: 16000,
            numChannels: 1,
            bitRate: 128000,
          ),
          path: _recordingPath!,
        );
        print('[Voice] Recording started at $_recordingPath');
      } catch (wavError) {
        print('[Voice] WAV encoder failed, trying AAC: $wavError');
        _recordingPath = _recordingPath!.replaceAll('.wav', '.m4a');
        await _recorder.start(
          const RecordConfig(
            encoder: AudioEncoder.aacLc,
            sampleRate: 16000,
            numChannels: 1,
            bitRate: 128000,
          ),
          path: _recordingPath!,
        );
        print('[Voice] Recording started (AAC fallback) at $_recordingPath');
      }
    } catch (e) {
      state = state.copyWith(
        state: VoiceModeState.error,
        error: 'Failed to start recording: ${e.toString()}',
      );
      _autoRecoverAfterError(4);
    }
  }

  /// Stop recording from phone microphone and process via Whisper API.
  Future<void> _stopPhoneMicRecording() async {
    try {
      final path = await _recorder.stop();
      print('[Voice] Recording stopped, path: $path');

      if (path != null && path.isNotEmpty) {
        final file = File(path);
        if (await file.exists()) {
          final bytes = await file.readAsBytes();
          if (bytes.isEmpty) {
            _isRecording = false;
            state = state.copyWith(
              state: VoiceModeState.error,
              error: 'Recording is empty. Please speak louder or check microphone.',
            );
            _autoRecoverAfterError(4);
            return;
          }
          _capturedAudio = bytes;
          await file.delete().catchError((_) => file);
        } else {
          _isRecording = false;
          state = state.copyWith(
            state: VoiceModeState.error,
            error: 'Recording file not found. Please try again.',
          );
          _autoRecoverAfterError(4);
          return;
        }
      } else {
        _isRecording = false;
        state = state.copyWith(
          state: VoiceModeState.error,
          error: 'No recording path returned. Please try again.',
        );
        _autoRecoverAfterError(4);
        return;
      }

      _waitingForCapture = false;
      _isRecording = false;
      _processCapture();
    } catch (e) {
      _isRecording = false;
      state = state.copyWith(
        state: VoiceModeState.error,
        error: 'Recording error: ${e.toString()}',
      );
      _autoRecoverAfterError(4);
    }
  }

  /// Manually trigger from phone (no Frame connected).
  Future<void> manualTrigger() async {
    print('[Voice] manualTrigger called, state=${state.state}, isRecording=$_isRecording, usingStt=$_usingSpeechToText');
    if (state.state == VoiceModeState.idle || state.state == VoiceModeState.error) {
      await _startListening();
    } else if (state.state == VoiceModeState.listening) {
      // === IMMEDIATE UI RESPONSE ===
      // Change state to processing RIGHT NOW so the button responds instantly
      print('[Voice] Manual stop — forcing state to processing immediately');
      state = state.copyWith(state: VoiceModeState.processing, partialText: null);

      _stopTimeout?.cancel();
      _recordingTimeout?.cancel();
      _keepaliveTimer?.cancel();

      if (_isFrameConnected) {
        // Stop parallel STT first to capture final text
        if (_usingSpeechToText) {
          await _speech.stop();
          _usingSpeechToText = false;
          print('[Voice] Stopped parallel STT, text: "$_recognizedText"');
        }

        // Send stop commands to Frame (3x for reliability)
        await _frameRepo.stopCapture();
        await Future.delayed(const Duration(milliseconds: 100));
        await _frameRepo.stopCapture();
        await Future.delayed(const Duration(milliseconds: 100));
        await _frameRepo.stopCapture();

        // Check if we already have audio
        if (_capturedAudio != null && _capturedAudio!.isNotEmpty) {
          print('[Voice] Already have audio (${_capturedAudio!.length} bytes), processing now');
          _waitingForCapture = false;
          _processCapture();
        } else if (_recognizedText.trim().isNotEmpty) {
          // Frame has no audio yet, but parallel STT captured text — use it immediately
          print('[Voice] No Frame audio, using parallel STT: "$_recognizedText"');
          _waitingForCapture = false;
          _processTextInput(_recognizedText.trim());
        } else {
          // Give Frame 3 seconds to send audio, then use fallback
          _stopTimeout = Timer(const Duration(seconds: 3), () {
            _waitingForCapture = false;
            if (_capturedAudio != null && _capturedAudio!.isNotEmpty) {
              print('[Voice] Got audio after stop (${_capturedAudio!.length} bytes)');
              _processCapture();
            } else {
              // No audio and no recognized text — show friendly message
              print('[Voice] No audio and no text — returning to idle');
              state = state.copyWith(
                state: VoiceModeState.error,
                error: 'Could not hear you. Try speaking louder.',
              );
              _autoRecoverAfterError(3);
            }
          });
        }
      } else if (_usingSpeechToText) {
        await _speech.stop();
        _finishLocalSTT();
      } else {
        await _stopPhoneMicRecording();
      }
    } else if (state.state == VoiceModeState.displaying) {
      state = state.copyWith(state: VoiceModeState.idle);
      await _startListening();
    }
  }

  void _checkCaptureComplete() {
    if (!_waitingForCapture) return;
    if (_capturedAudio != null || _capturedPhoto != null) {
      Timer(const Duration(milliseconds: 500), () {
        if (_waitingForCapture) {
          _waitingForCapture = false;
          _processCapture();
        }
      });
    }
  }

  /// Send captured data to /frame/noa endpoint (audio file mode).
  Future<void> _processCapture() async {
    if (_capturedAudio == null && _capturedPhoto == null) {
      state = state.copyWith(
        state: VoiceModeState.error,
        error: 'No audio or image captured. Please try again.',
      );
      _autoRecoverAfterError(3);
      return;
    }

    state = state.copyWith(state: VoiceModeState.processing);
    if (ForegroundServiceManager.isRunning) {
      await ForegroundServiceManager.updateNotification(title: 'GOD Frame', text: 'Processing voice...');
    }

    try {
      Uint8List? audioData;
      if (_capturedAudio != null) {
        audioData = _isFrameConnected ? _pcmToWav(_capturedAudio!) : _capturedAudio;
        print('[Voice] Audio data: ${audioData!.length} bytes, isFrame=$_isFrameConnected');
      }

      if (_capturedPhoto != null) {
        print('[Voice] Image data: ${_capturedPhoto!.length} bytes');
      }

      print('[Voice] Sending to /frame/noa...');

      final result = await _noaRepo.sendFrameInput(
        audioData: audioData,
        imageData: _capturedPhoto,
        messages: state.conversationHistory.isNotEmpty
            ? state.conversationHistory
            : null,
        time: DateTime.now().toIso8601String(),
        conversationId: _voiceSettings.defaultConversationId,
      );

      _holdTimer?.cancel();

      if (result.isSuccess) {
        _handleSuccessfulResponse(result.data!, result.data!.userPrompt);
      } else {
        _handleErrorResponse(result.error ?? 'Unknown error', result.statusCode);
      }
    } catch (e) {
      _holdTimer?.cancel();
      print('[Voice] Exception: $e');
      state = state.copyWith(state: VoiceModeState.error, error: e.toString());
      _autoRecoverAfterError(8);
    }
  }

  /// Handle successful response from backend.
  void _handleSuccessfulResponse(NoaResponse response, String userText) {
    final newHistory = [...state.conversationHistory];
    final prompt = userText.isNotEmpty ? userText : response.userPrompt;
    if (prompt.isNotEmpty) {
      newHistory.add({'role': 'user', 'content': prompt});
    }
    if (response.message.isNotEmpty) {
      newHistory.add({'role': 'assistant', 'content': response.message});
    }

    while (newHistory.length > 20) {
      newHistory.removeAt(0);
    }
    if (response.topicChanged) {
      newHistory.clear();
    }

    state = state.copyWith(
      state: VoiceModeState.displaying,
      lastPrompt: prompt,
      lastResponse: response.message,
      conversationHistory: newHistory,
      partialText: null,
    );

    if (_isFrameConnected && response.message.isNotEmpty) {
      _frameRepo.displayText(response.message);
    }

    // ─── TTS: Read response aloud if enabled ──────────────────────
    if (_voiceSettings.ttsEnabled && response.message.isNotEmpty) {
      final shouldSpeak = !_voiceSettings.ttsFrameOnly || _isFrameConnected;
      if (shouldSpeak) {
        // Apply TTS language and speech rate from settings
        _ttsService.setLanguage(_voiceSettings.ttsLanguage);
        _ttsService.setSpeechRate(_voiceSettings.ttsSpeechRate);

        final voiceAgent = _voiceSettings.ttsVoiceAgentName;
        if (voiceAgent != null && voiceAgent.isNotEmpty) {
          // Use Voice Agent for text optimization before speaking
          _ttsService.speakWithAgent(
            text: response.message,
            voiceAgentName: voiceAgent,
            voiceAgentPrompt: _voiceSettings.ttsVoiceAgentPrompt,
            conversationId: response.conversationId,
          );
        } else {
          // Direct TTS without agent optimization
          _ttsService.speak(response.message);
        }
      }
    }

    _messagesNotifier.addLocalMessage(Message(
      id: -DateTime.now().millisecondsSinceEpoch,
      conversationId: response.conversationId ?? 0,
      role: 'user',
      content: prompt,
      createdAt: DateTime.now().toIso8601String(),
    ));
    _messagesNotifier.addLocalMessage(Message(
      id: -DateTime.now().millisecondsSinceEpoch - 1,
      conversationId: response.conversationId ?? 0,
      role: 'assistant',
      content: response.message,
      agentName: 'Noa',
      createdAt: DateTime.now().toIso8601String(),
    ));

    if (ForegroundServiceManager.isRunning) {
      ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: _isFrameConnected ? 'Connected to Frame' : 'Ready',
      );
    }

    Future.delayed(const Duration(seconds: 10), () {
      if (state.state == VoiceModeState.displaying) {
        state = state.copyWith(state: VoiceModeState.idle);
      }
    });
  }

  void _handleErrorResponse(String errMsg, int? statusCode) {
    print('[Voice] API error: $errMsg (status: $statusCode)');
    state = state.copyWith(state: VoiceModeState.error, error: errMsg);
    _autoRecoverAfterError(8);
  }

  void _autoRecoverAfterError(int seconds) {
    Future.delayed(Duration(seconds: seconds), () {
      if (state.state == VoiceModeState.error) {
        state = state.copyWith(state: VoiceModeState.idle);
      }
    });
  }

  /// Convert raw 8-bit 8kHz PCM to WAV format (for Frame BLE audio).
  Uint8List _pcmToWav(Uint8List pcmData) {
    const sampleRate = 8000;
    const bitsPerSample = 8;
    const numChannels = 1;
    final dataSize = pcmData.length;
    final fileSize = 36 + dataSize;

    final wav = ByteData(44 + dataSize);

    wav.setUint8(0, 0x52); wav.setUint8(1, 0x49);
    wav.setUint8(2, 0x46); wav.setUint8(3, 0x46);
    wav.setUint32(4, fileSize, Endian.little);
    wav.setUint8(8, 0x57); wav.setUint8(9, 0x41);
    wav.setUint8(10, 0x56); wav.setUint8(11, 0x45);

    wav.setUint8(12, 0x66); wav.setUint8(13, 0x6D);
    wav.setUint8(14, 0x74); wav.setUint8(15, 0x20);
    wav.setUint32(16, 16, Endian.little);
    wav.setUint16(20, 1, Endian.little);
    wav.setUint16(22, numChannels, Endian.little);
    wav.setUint32(24, sampleRate, Endian.little);
    wav.setUint32(28, sampleRate * numChannels * bitsPerSample ~/ 8, Endian.little);
    wav.setUint16(32, numChannels * bitsPerSample ~/ 8, Endian.little);
    wav.setUint16(34, bitsPerSample, Endian.little);

    wav.setUint8(36, 0x64); wav.setUint8(37, 0x61);
    wav.setUint8(38, 0x74); wav.setUint8(39, 0x61);
    wav.setUint32(40, dataSize, Endian.little);

    // Frame sends unsigned 8-bit PCM (0-255, silence=128).
    // WAV 8-bit format is ALSO unsigned — copy directly, NO conversion needed.
    // Previous bug: +128 inverted audio → Whisper couldn't transcribe.
    for (var i = 0; i < pcmData.length; i++) {
      wav.setUint8(44 + i, pcmData[i]);
    }

    return wav.buffer.asUint8List();
  }

  /// Force stop everything — emergency button for when recording gets stuck.
  void forceStop() {
    print('[Voice] Force stop called');
    _stopTimeout?.cancel();
    _recordingTimeout?.cancel();
    _keepaliveTimer?.cancel();
    _holdTimer?.cancel();
    _waitingForCapture = false;
    _capturedAudio = null;
    _capturedPhoto = null;

    if (_usingSpeechToText) {
      _speech.stop();
      _usingSpeechToText = false;
    }

    if (_isRecording) {
      _recorder.stop().catchError((_) => null);
      _isRecording = false;
    }

    if (_isFrameConnected) {
      _frameRepo.stopCapture().catchError((_) {});
    }

    _recognizedText = '';
    state = state.copyWith(state: VoiceModeState.idle, partialText: null, activeCommand: null);

    if (ForegroundServiceManager.isRunning) {
      ForegroundServiceManager.updateNotification(
        title: 'GOD Frame',
        text: _isFrameConnected ? 'Connected to Frame' : 'Ready',
      );
    }
  }

  void clearHistory() {
    state = state.copyWith(conversationHistory: []);
  }

  /// Exit Gemini Live mode and return to idle.
  void exitGeminiLive() {
    state = state.copyWith(state: VoiceModeState.idle, activeCommand: null);
  }

  @override
  void dispose() {
    _tapSub?.cancel();
    _audioSub?.cancel();
    _photoSub?.cancel();
    _holdTimer?.cancel();
    _keepaliveTimer?.cancel();
    _recordingTimeout?.cancel();
    _stopTimeout?.cancel();
    _recorder.dispose();
    _speech.stop();
    super.dispose();
  }
}
