import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../providers/call_provider.dart';

/// Full-screen audio call overlay with recording controls.
class CallScreen extends ConsumerStatefulWidget {
  final int conversationId;
  final String title;
  final List<String> participantNames;
  final bool withRecording;

  const CallScreen({
    super.key,
    required this.conversationId,
    required this.title,
    this.participantNames = const [],
    this.withRecording = true,
  });

  @override
  ConsumerState<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends ConsumerState<CallScreen> {
  Timer? _timer;
  Duration _elapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (ref.read(callProvider).state == CallState.connected) {
        setState(() => _elapsed += const Duration(seconds: 1));
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String _formatDuration(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    if (d.inHours > 0) {
      return '${d.inHours}:$minutes:$seconds';
    }
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final call = ref.watch(callProvider);
    final notifier = ref.read(callProvider.notifier);

    // Auto-close on idle (call ended externally)
    if (call.state == CallState.idle && _elapsed > Duration.zero) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop();
      });
    }

    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      body: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),

            // Recording indicator
            if (call.isRecording)
              _buildRecordingBadge(),

            const SizedBox(height: 12),

            // Title
            Text(
              widget.title,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),

            // Status
            _buildStatus(call),
            const SizedBox(height: 8),

            // Timer
            if (call.state == CallState.connected)
              Text(
                _formatDuration(_elapsed),
                style: const TextStyle(
                  color: GodTheme.textMuted,
                  fontSize: 18,
                  fontFamily: 'monospace',
                ),
              ),

            const SizedBox(height: 32),

            // Participant avatars
            _buildParticipants(call),

            const Spacer(flex: 3),

            // Action buttons
            _buildActions(call, notifier),

            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }

  Widget _buildRecordingBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: GodTheme.error.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GodTheme.error.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: GodTheme.error,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'REC',
            style: TextStyle(
              color: GodTheme.error,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatus(CallInfo call) {
    String text;
    Color color;
    switch (call.state) {
      case CallState.connecting:
        text = 'Подключение...';
        color = GodTheme.warning;
        break;
      case CallState.connected:
        final count = call.remoteParticipants.length;
        text = count == 0
            ? 'Ожидание участников...'
            : '$count ${count == 1 ? 'участник' : 'участников'}';
        color = GodTheme.success;
        break;
      case CallState.error:
        text = call.errorMessage ?? 'Ошибка подключения';
        color = GodTheme.error;
        break;
      case CallState.idle:
        text = 'Завершён';
        color = GodTheme.textMuted;
        break;
    }
    return Text(text, style: TextStyle(color: color, fontSize: 14));
  }

  Widget _buildParticipants(CallInfo call) {
    final names = <String>[];
    for (final p in call.remoteParticipants) {
      names.add(p.name.isNotEmpty ? p.name : p.identity);
    }
    for (final n in widget.participantNames) {
      if (!names.contains(n)) names.add(n);
    }

    if (names.isEmpty) {
      return const Icon(
        Icons.phone_in_talk,
        size: 80,
        color: GodTheme.textMuted,
      );
    }

    return Wrap(
      spacing: 16,
      runSpacing: 16,
      alignment: WrapAlignment.center,
      children: names.map((name) {
        final initials = name.split(' ').map((w) => w.isNotEmpty ? w[0] : '').take(2).join().toUpperCase();
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              radius: 32,
              backgroundColor: GodTheme.primary.withValues(alpha: 0.3),
              child: Text(
                initials,
                style: const TextStyle(color: GodTheme.primary, fontSize: 20, fontWeight: FontWeight.bold),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              name,
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ],
        );
      }).toList(),
    );
  }

  Widget _buildActions(CallInfo call, CallNotifier notifier) {
    return Column(
      children: [
        // Main row: mute, speaker, end call
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _ActionButton(
              icon: call.isMuted ? Icons.mic_off : Icons.mic,
              label: call.isMuted ? 'Вкл.' : 'Мут',
              color: call.isMuted ? GodTheme.error : Colors.white24,
              onTap: call.state == CallState.connected ? () => notifier.toggleMute() : null,
            ),
            _ActionButton(
              icon: call.isSpeakerOn ? Icons.volume_up : Icons.volume_off,
              label: call.isSpeakerOn ? 'Динамик' : 'Телефон',
              color: call.isSpeakerOn ? GodTheme.primary : Colors.white24,
              onTap: call.state == CallState.connected ? () => notifier.toggleSpeaker() : null,
            ),
            _ActionButton(
              icon: Icons.call_end,
              label: 'Завершить',
              color: GodTheme.error,
              large: true,
              onTap: () {
                notifier.endCall();
                Navigator.of(context).pop();
              },
            ),
          ],
        ),
        const SizedBox(height: 24),
        // Secondary row: recording toggle
        if (call.state == CallState.connected)
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _ActionButton(
                icon: call.isRecording ? Icons.stop_circle : Icons.fiber_manual_record,
                label: call.isRecording ? 'Стоп запись' : 'Записать',
                color: call.isRecording
                    ? GodTheme.error
                    : Colors.white24,
                onTap: () => notifier.toggleRecording(),
              ),
            ],
          ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final bool large;
  final VoidCallback? onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    this.large = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final size = large ? 64.0 : 52.0;
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color,
            ),
            child: Icon(icon, color: Colors.white, size: large ? 32 : 24),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: const TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
