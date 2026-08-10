import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';
import '../../../shared/utils/api_client.dart';

enum CallState { idle, connecting, connected, error }

class CallInfo {
  final CallState state;
  final String? roomName;
  final int? conversationId;
  final String? errorMessage;
  final List<RemoteParticipant> remoteParticipants;
  final Duration elapsed;
  final bool isMuted;
  final bool isSpeakerOn;
  final bool isRecording;
  final String? egressId;
  final bool isTranscribing;
  final String? transcriptionText;
  final List<String> liveTranscriptLines;

  const CallInfo({
    this.state = CallState.idle,
    this.roomName,
    this.conversationId,
    this.errorMessage,
    this.remoteParticipants = const [],
    this.elapsed = Duration.zero,
    this.isMuted = false,
    this.isSpeakerOn = true,
    this.isRecording = false,
    this.egressId,
    this.isTranscribing = false,
    this.transcriptionText,
    this.liveTranscriptLines = const [],
  });

  CallInfo copyWith({
    CallState? state,
    String? roomName,
    int? conversationId,
    String? errorMessage,
    List<RemoteParticipant>? remoteParticipants,
    Duration? elapsed,
    bool? isMuted,
    bool? isSpeakerOn,
    bool? isRecording,
    String? egressId,
    bool? isTranscribing,
    String? transcriptionText,
    List<String>? liveTranscriptLines,
  }) {
    return CallInfo(
      state: state ?? this.state,
      roomName: roomName ?? this.roomName,
      conversationId: conversationId ?? this.conversationId,
      errorMessage: errorMessage ?? this.errorMessage,
      remoteParticipants: remoteParticipants ?? this.remoteParticipants,
      elapsed: elapsed ?? this.elapsed,
      isMuted: isMuted ?? this.isMuted,
      isSpeakerOn: isSpeakerOn ?? this.isSpeakerOn,
      isRecording: isRecording ?? this.isRecording,
      egressId: egressId ?? this.egressId,
      isTranscribing: isTranscribing ?? this.isTranscribing,
      transcriptionText: transcriptionText ?? this.transcriptionText,
      liveTranscriptLines: liveTranscriptLines ?? this.liveTranscriptLines,
    );
  }
}

class CallNotifier extends StateNotifier<CallInfo> {
  final Dio _dio;
  Room? _room;
  EventsListener<RoomEvent>? _listener;
  DateTime? _callStartTime;

  CallNotifier(this._dio) : super(const CallInfo());

  Room? get room => _room;

  /// Start a call. [withRecording] = true starts server-side recording.
  Future<void> startCall(int conversationId, {bool withRecording = true}) async {
    if (state.state == CallState.connecting || state.state == CallState.connected) {
      return;
    }

    state = state.copyWith(
      state: CallState.connecting,
      conversationId: conversationId,
      errorMessage: null,
      isRecording: false,
      egressId: null,
      transcriptionText: null,
      liveTranscriptLines: [],
    );

    try {
      final response = await _dio.post(
        '/chat/conversations/$conversationId/call/token',
      );

      if (response.statusCode != 200 || response.data == null) {
        throw Exception('Failed to get call token');
      }

      final data = response.data is Map && response.data.containsKey('data')
          ? response.data['data']
          : response.data;

      final token = data['token'] as String;
      final url = data['url'] as String;

      _room = Room(
        roomOptions: const RoomOptions(
          adaptiveStream: false,
          dynacast: false,
          defaultAudioPublishOptions: AudioPublishOptions(
            dtx: true,
          ),
        ),
      );

      _listener = _room!.createListener();
      _listener!
        ..on<ParticipantConnectedEvent>((event) {
          _updateParticipants();
        })
        ..on<ParticipantDisconnectedEvent>((event) {
          _updateParticipants();
        })
        ..on<RoomDisconnectedEvent>((event) {
          endCall();
        })
        ..on<TrackSubscribedEvent>((event) {
          _updateParticipants();
        });

      await _room!.connect(url, token);
      await _room!.localParticipant?.setMicrophoneEnabled(true);

      _callStartTime = DateTime.now();

      state = state.copyWith(
        state: CallState.connected,
        roomName: data['room'] as String?,
      );

      _updateParticipants();

      // Auto-start recording if requested
      if (withRecording) {
        _startRecording(conversationId);
      }
    } catch (e) {
      state = state.copyWith(
        state: CallState.error,
        errorMessage: e.toString(),
      );
    }
  }

  void _updateParticipants() {
    if (_room == null) return;
    state = state.copyWith(
      remoteParticipants: _room!.remoteParticipants.values.toList(),
    );
  }

  /// Start server-side recording via LiveKit Egress.
  Future<void> _startRecording(int conversationId) async {
    try {
      final resp = await _dio.post(
        '/chat/conversations/$conversationId/call/recording/start',
      );
      if (resp.statusCode == 200) {
        final data = resp.data is Map && resp.data.containsKey('data')
            ? resp.data['data']
            : resp.data;
        state = state.copyWith(
          isRecording: true,
          egressId: data['egress_id'] as String?,
        );
      }
    } catch (_) {
      // Recording failed to start — call continues without recording
    }
  }

  /// Stop server-side recording.
  Future<void> stopRecording() async {
    if (!state.isRecording || state.egressId == null || state.conversationId == null) return;

    try {
      await _dio.post(
        '/chat/conversations/${state.conversationId}/call/recording/stop',
        data: {'egress_id': state.egressId},
      );
    } catch (_) {}

    state = state.copyWith(isRecording: false);
  }

  /// Toggle recording on/off during a call.
  Future<void> toggleRecording() async {
    if (state.isRecording) {
      await stopRecording();
    } else if (state.conversationId != null) {
      await _startRecording(state.conversationId!);
    }
  }

  Future<void> toggleMute() async {
    if (_room == null) return;
    final newMuted = !state.isMuted;
    await _room!.localParticipant?.setMicrophoneEnabled(!newMuted);
    state = state.copyWith(isMuted: newMuted);
  }

  Future<void> toggleSpeaker() async {
    if (_room == null) return;
    final newSpeaker = !state.isSpeakerOn;
    await Hardware.instance.setSpeakerphoneOn(newSpeaker);
    state = state.copyWith(isSpeakerOn: newSpeaker);
  }

  Future<void> endCall() async {
    // Stop recording if active, then transcribe with diarization
    final wasRecording = state.isRecording;
    final convId = state.conversationId;
    final egressId = state.egressId;

    // Calculate call duration
    final callDuration = _callStartTime != null
        ? DateTime.now().difference(_callStartTime!).inSeconds
        : 0;

    // Collect participant names (local + remote)
    final participantsList = <Map<String, String>>[];
    if (_room?.localParticipant != null) {
      participantsList.add({
        'identity': _room!.localParticipant!.identity ?? 'local',
        'name': _room!.localParticipant!.name ?? 'Вы',
      });
    }
    for (final p in state.remoteParticipants) {
      participantsList.add({
        'identity': p.identity ?? 'unknown',
        'name': p.name ?? p.identity ?? 'Unknown',
      });
    }

    if (wasRecording && egressId != null && convId != null) {
      try {
        final stopResp = await _dio.post(
          '/chat/conversations/$convId/call/recording/stop',
          data: {'egress_id': egressId},
        );
        // Trigger async transcription with diarization data
        final stopData = stopResp.data is Map && stopResp.data.containsKey('data')
            ? stopResp.data['data']
            : stopResp.data;
        final filePath = stopData?['file'] as String?;
        if (filePath != null) {
          _dio.post(
            '/chat/conversations/$convId/call/transcribe',
            data: {
              'file_path': filePath,
              'duration': callDuration,
              'participants': participantsList,
            },
          ).catchError((_) => null);
        }
      } catch (_) {}
    }

    _callStartTime = null;
    _listener?.dispose();
    _listener = null;
    await _room?.disconnect();
    await _room?.dispose();
    _room = null;
    state = const CallInfo();
  }

  @override
  void dispose() {
    endCall();
    super.dispose();
  }
}

final callProvider = StateNotifierProvider<CallNotifier, CallInfo>((ref) {
  final dio = ref.watch(apiClientProvider);
  return CallNotifier(dio);
});
