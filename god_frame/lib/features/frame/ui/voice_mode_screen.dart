import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme.dart';
import '../providers/frame_connection_provider.dart';
import '../providers/frame_events_provider.dart';
import '../providers/voice_mode_provider.dart';
import '../providers/voice_command_provider.dart';

/// Voice mode screen — the core Frame/Phone interaction.
/// Now with voice command routing and Gemini Live mode.
class VoiceModeScreen extends ConsumerStatefulWidget {
  const VoiceModeScreen({super.key});

  @override
  ConsumerState<VoiceModeScreen> createState() => _VoiceModeScreenState();
}

class _VoiceModeScreenState extends ConsumerState<VoiceModeScreen> {
  @override
  void initState() {
    super.initState();
    // Register Gemini Live callback
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(voiceModeProvider.notifier).onGeminiLiveRequested = _startGeminiLive;
    });
  }

  void _startGeminiLive() {
    print('[VoiceModeScreen] Gemini Live requested — starting...');
    ref.read(geminiLiveProvider.notifier).start();
  }

  void _stopGeminiLive() {
    ref.read(geminiLiveProvider.notifier).stop();
    ref.read(voiceModeProvider.notifier).exitGeminiLive();
  }

  @override
  Widget build(BuildContext context) {
    final frameState = ref.watch(frameConnectionProvider);
    final voiceState = ref.watch(voiceModeProvider);
    final geminiLiveState = ref.watch(geminiLiveProvider);
    final voiceSettings = ref.watch(voiceSettingsProvider);

    // Initialize calendar events provider — sends events to Frame on connect
    ref.watch(frameEventsProvider);

    final isGeminiLive = voiceState.state == VoiceModeState.geminiLive ||
        geminiLiveState.state == GeminiLiveState.active ||
        geminiLiveState.state == GeminiLiveState.connecting;

    return Scaffold(
      appBar: AppBar(
        title: Text(isGeminiLive ? 'Gemini Live' : 'Voice Mode'),
        actions: [
          // Connection indicator
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: frameState.isConnected ? GodTheme.frameBle : GodTheme.textMuted,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  frameState.isConnected ? 'Frame' : 'Phone Mic',
                  style: TextStyle(
                    color: frameState.isConnected ? GodTheme.frameBle : GodTheme.textMuted,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.bluetooth_rounded, size: 20),
            tooltip: 'Connect Device',
            onPressed: () => context.push('/frame'),
          ),
        ],
      ),
      body: Column(
        children: [
          // Gemini Live banner when active
          if (isGeminiLive) _GeminiLiveBanner(
            state: geminiLiveState,
            onStop: _stopGeminiLive,
          ),

          // Active command indicator
          if (voiceState.activeCommand != null && !isGeminiLive)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: GodTheme.accent.withOpacity(0.1),
              child: Row(
                children: [
                  const Icon(Icons.flash_on, size: 16, color: GodTheme.accent),
                  const SizedBox(width: 6),
                  Text(
                    'Command: ${voiceState.activeCommand}',
                    style: const TextStyle(color: GodTheme.accent, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),

          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Voice mode status indicator
                    _VoiceStatusOrb(
                      state: voiceState.state,
                      isGeminiLive: isGeminiLive,
                    ),
                    const SizedBox(height: 32),

                    // Status text
                    Text(
                      _stateTitle(voiceState.state, isGeminiLive, geminiLiveState),
                      style: Theme.of(context).textTheme.headlineMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _stateSubtitle(voiceState.state, frameState.isConnected, isGeminiLive, geminiLiveState),
                      style: const TextStyle(color: GodTheme.textSecondary, fontSize: 14),
                      textAlign: TextAlign.center,
                    ),

                    // Real-time partial text from speech recognition
                    if (voiceState.partialText != null && voiceState.partialText!.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        decoration: BoxDecoration(
                          color: GodTheme.primary.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: GodTheme.primary.withOpacity(0.2)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.hearing, size: 16, color: GodTheme.primary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                voiceState.partialText!,
                                style: const TextStyle(
                                  color: GodTheme.textPrimary,
                                  fontSize: 15,
                                  fontStyle: FontStyle.italic,
                                ),
                                maxLines: 3,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    // Gemini Live transcript
                    if (isGeminiLive && geminiLiveState.lastTranscript != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        decoration: BoxDecoration(
                          color: GodTheme.frameBle.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: GodTheme.frameBle.withOpacity(0.2)),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              geminiLiveState.isGeminiSpeaking
                                  ? Icons.volume_up
                                  : Icons.record_voice_over,
                              size: 16, color: GodTheme.frameBle,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                geminiLiveState.lastTranscript!,
                                style: const TextStyle(
                                  color: GodTheme.textPrimary,
                                  fontSize: 14,
                                ),
                                maxLines: 5,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    // Error display
                    if (voiceState.error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: GodTheme.error.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: GodTheme.error.withOpacity(0.3)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, size: 18, color: GodTheme.error),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                voiceState.error!,
                                style: const TextStyle(color: GodTheme.error, fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    // Gemini Live error
                    if (geminiLiveState.error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: GodTheme.error.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: GodTheme.error.withOpacity(0.3)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline, size: 18, color: GodTheme.error),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                geminiLiveState.error!,
                                style: const TextStyle(color: GodTheme.error, fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],

                    const SizedBox(height: 32),

                    // Action buttons
                    if (isGeminiLive)
                      _GeminiLiveStopButton(onStop: _stopGeminiLive)
                    else
                      _ManualTriggerButton(
                        voiceState: voiceState.state,
                        isFrameConnected: frameState.isConnected,
                        onTap: () => ref.read(voiceModeProvider.notifier).manualTrigger(),
                      ),

                    // Available voice commands hint
                    if (voiceState.state == VoiceModeState.idle && !isGeminiLive) ...[
                      const SizedBox(height: 16),
                      _VoiceCommandsHint(commands: voiceSettings.commands),
                    ],
                  ],
                ),
              ),
            ),
          ),

          // Last interaction display
          if (!isGeminiLive && (voiceState.lastPrompt != null || voiceState.lastResponse != null))
            _LastInteraction(
              prompt: voiceState.lastPrompt,
              response: voiceState.lastResponse,
            ),

          // Conversation history count
          if (!isGeminiLive && voiceState.conversationHistory.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.history, size: 14, color: GodTheme.textMuted.withOpacity(0.6)),
                  const SizedBox(width: 4),
                  Text(
                    '${voiceState.conversationHistory.length ~/ 2} exchanges',
                    style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                  ),
                  const SizedBox(width: 12),
                  GestureDetector(
                    onTap: () => ref.read(voiceModeProvider.notifier).clearHistory(),
                    child: const Text(
                      'Clear',
                      style: TextStyle(color: GodTheme.primary, fontSize: 12, fontWeight: FontWeight.w500),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  String _stateTitle(VoiceModeState state, bool isGeminiLive, GeminiLiveData geminiData) {
    if (isGeminiLive) {
      if (geminiData.state == GeminiLiveState.connecting) return 'Connecting...';
      if (geminiData.isGeminiSpeaking) return 'Gemini Speaking';
      return 'Gemini Live';
    }
    switch (state) {
      case VoiceModeState.idle:
        return 'Ready';
      case VoiceModeState.listening:
        return 'Listening...';
      case VoiceModeState.processing:
        return 'Thinking...';
      case VoiceModeState.displaying:
        return 'Response';
      case VoiceModeState.error:
        return 'Error';
      case VoiceModeState.geminiLive:
        return 'Gemini Live';
    }
  }

  String _stateSubtitle(VoiceModeState state, bool frameConnected, bool isGeminiLive, GeminiLiveData geminiData) {
    if (isGeminiLive) {
      if (geminiData.state == GeminiLiveState.connecting) return 'Setting up WebSocket connection...';
      if (geminiData.isGeminiSpeaking) return 'Listening to Gemini response...';
      return 'Real-time voice conversation active. Tap Stop to end.';
    }
    switch (state) {
      case VoiceModeState.idle:
        return frameConnected
            ? 'Tap Frame or button. Say a command to route.'
            : 'Tap mic. Say a command word to route to agent.';
      case VoiceModeState.listening:
        return 'Speak now... say "realtime" for Gemini Live';
      case VoiceModeState.processing:
        return 'Transcribing and analyzing...';
      case VoiceModeState.displaying:
        return frameConnected ? 'Showing on Frame display' : 'See response below';
      case VoiceModeState.error:
        return 'Something went wrong. Try again.';
      case VoiceModeState.geminiLive:
        return 'Activating Gemini Live...';
    }
  }
}

// ─── Gemini Live Banner ──────────────────────────────────────

class _GeminiLiveBanner extends StatelessWidget {
  final GeminiLiveData state;
  final VoidCallback onStop;

  const _GeminiLiveBanner({required this.state, required this.onStop});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [GodTheme.frameBle.withOpacity(0.2), GodTheme.accent.withOpacity(0.1)],
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 10, height: 10,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: state.state == GeminiLiveState.active ? GodTheme.success : GodTheme.warning,
              boxShadow: [
                if (state.state == GeminiLiveState.active)
                  BoxShadow(color: GodTheme.success.withOpacity(0.5), blurRadius: 6),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'Gemini Live — Real-time Voice',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ),
          if (state.isGeminiSpeaking)
            const Padding(
              padding: EdgeInsets.only(right: 8),
              child: Icon(Icons.volume_up, size: 18, color: GodTheme.frameBle),
            ),
          TextButton(
            onPressed: onStop,
            child: const Text('Stop', style: TextStyle(color: GodTheme.error)),
          ),
        ],
      ),
    );
  }
}

// ─── Voice Commands Hint ─────────────────────────────────────

class _VoiceCommandsHint extends StatelessWidget {
  final List<dynamic> commands;

  const _VoiceCommandsHint({required this.commands});

  @override
  Widget build(BuildContext context) {
    final enabled = commands.where((c) => c.enabled == true).toList();
    if (enabled.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: GodTheme.surfaceLight,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: GodTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.tips_and_updates, size: 14, color: GodTheme.textMuted),
              SizedBox(width: 4),
              Text('Voice commands:', style: TextStyle(fontSize: 11, color: GodTheme.textMuted, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: enabled.take(5).map((cmd) => Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: GodTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                '"${cmd.keywords.first}"',
                style: const TextStyle(fontSize: 12, color: GodTheme.primary, fontWeight: FontWeight.w500),
              ),
            )).toList(),
          ),
        ],
      ),
    );
  }
}

// ─── Voice Status Orb ────────────────────────────────────────

class _VoiceStatusOrb extends StatefulWidget {
  final VoiceModeState state;
  final bool isGeminiLive;

  const _VoiceStatusOrb({required this.state, this.isGeminiLive = false});

  @override
  State<_VoiceStatusOrb> createState() => _VoiceStatusOrbState();
}

class _VoiceStatusOrbState extends State<_VoiceStatusOrb>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.15).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void didUpdateWidget(covariant _VoiceStatusOrb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isGeminiLive ||
        widget.state == VoiceModeState.listening ||
        widget.state == VoiceModeState.processing ||
        widget.state == VoiceModeState.geminiLive) {
      _pulseController.repeat(reverse: true);
    } else {
      _pulseController.stop();
      _pulseController.reset();
    }
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Color color;
    IconData icon;

    if (widget.isGeminiLive) {
      color = GodTheme.frameBle;
      icon = Icons.surround_sound;
    } else {
      switch (widget.state) {
        case VoiceModeState.idle:
          color = GodTheme.primary;
          icon = Icons.mic_none;
          break;
        case VoiceModeState.listening:
          color = GodTheme.error;
          icon = Icons.mic;
          break;
        case VoiceModeState.processing:
          color = GodTheme.warning;
          icon = Icons.psychology;
          break;
        case VoiceModeState.displaying:
          color = GodTheme.success;
          icon = Icons.check_circle_outline;
          break;
        case VoiceModeState.error:
          color = GodTheme.error;
          icon = Icons.error_outline;
          break;
        case VoiceModeState.geminiLive:
          color = GodTheme.frameBle;
          icon = Icons.surround_sound;
          break;
      }
    }

    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, child) {
        final shouldPulse = widget.isGeminiLive ||
            widget.state == VoiceModeState.listening ||
            widget.state == VoiceModeState.processing ||
            widget.state == VoiceModeState.geminiLive;
        final scale = shouldPulse ? _pulseAnimation.value : 1.0;
        return Transform.scale(
          scale: scale,
          child: Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: color.withOpacity(0.1),
              border: Border.all(color: color.withOpacity(0.5), width: 3),
              boxShadow: [
                if (shouldPulse)
                  BoxShadow(
                    color: color.withOpacity(0.3),
                    blurRadius: 20,
                    spreadRadius: 5,
                  ),
              ],
            ),
            child: Icon(icon, size: 48, color: color),
          ),
        );
      },
    );
  }
}

// ─── Gemini Live Stop Button ─────────────────────────────────

class _GeminiLiveStopButton extends StatelessWidget {
  final VoidCallback onStop;

  const _GeminiLiveStopButton({required this.onStop});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 56,
      child: ElevatedButton.icon(
        onPressed: onStop,
        icon: const Icon(Icons.stop_rounded, size: 24),
        label: const Text(
          'Stop Gemini Live',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        style: ElevatedButton.styleFrom(
          backgroundColor: GodTheme.error,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: 4,
        ),
      ),
    );
  }
}

// ─── Manual Trigger Button ───────────────────────────────────

class _ManualTriggerButton extends StatelessWidget {
  final VoiceModeState voiceState;
  final bool isFrameConnected;
  final VoidCallback onTap;

  const _ManualTriggerButton({
    required this.voiceState,
    required this.isFrameConnected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isListening = voiceState == VoiceModeState.listening;
    final isProcessing = voiceState == VoiceModeState.processing;
    final isDisabled = isProcessing;

    return SizedBox(
      width: double.infinity,
      height: 56,
      child: ElevatedButton.icon(
        onPressed: isDisabled ? null : onTap,
        icon: Icon(
          isListening ? Icons.stop_rounded : Icons.mic_rounded,
          size: 24,
        ),
        label: Text(
          isListening
              ? 'Stop Recording'
              : isProcessing
                  ? 'Processing...'
                  : 'Start Recording',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        style: ElevatedButton.styleFrom(
          backgroundColor: isListening
              ? GodTheme.error
              : isProcessing
                  ? GodTheme.surfaceLight
                  : GodTheme.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: GodTheme.surfaceLight,
          disabledForegroundColor: GodTheme.textMuted,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: isListening ? 4 : 0,
        ),
      ),
    );
  }
}

// ─── Last Interaction ────────────────────────────────────────

class _LastInteraction extends StatelessWidget {
  final String? prompt;
  final String? response;

  const _LastInteraction({this.prompt, this.response});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: GodTheme.surfaceLight,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: GodTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Row(
            children: [
              Icon(Icons.chat_bubble_outline, size: 14, color: GodTheme.textMuted),
              SizedBox(width: 6),
              Text(
                'Last Interaction',
                style: TextStyle(
                  color: GodTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (prompt != null && prompt!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: GodTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                prompt!,
                style: const TextStyle(fontSize: 14, color: GodTheme.textPrimary),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
          if (response != null && response!.isNotEmpty) ...[
            const SizedBox(height: 8),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 200),
              child: SingleChildScrollView(
                child: MarkdownBody(
                  data: response!,
                  selectable: true,
                  styleSheet: MarkdownStyleSheet(
                    p: const TextStyle(fontSize: 14, color: GodTheme.textPrimary, height: 1.4),
                    code: const TextStyle(fontSize: 12, color: GodTheme.accent),
                    a: const TextStyle(color: GodTheme.primary),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
