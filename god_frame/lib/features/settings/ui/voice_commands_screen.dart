import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../../frame/data/voice_command.dart';
import '../../frame/data/tts_service.dart';
import '../../frame/providers/voice_command_provider.dart';
import '../../chat/providers/conversations_provider.dart';

/// Voice Commands Settings screen.
/// Allows configuring voice commands, default chat/agent, and Gemini Live settings.
class VoiceCommandsScreen extends ConsumerStatefulWidget {
  const VoiceCommandsScreen({super.key});

  @override
  ConsumerState<VoiceCommandsScreen> createState() => _VoiceCommandsScreenState();
}

class _VoiceCommandsScreenState extends ConsumerState<VoiceCommandsScreen> {
  final _geminiKeyCtrl = TextEditingController();
  final _systemInstructionCtrl = TextEditingController();
  bool _showApiKey = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  void _loadSettings() {
    final settings = ref.read(voiceSettingsProvider);
    _geminiKeyCtrl.text = settings.geminiApiKey ?? '';
    _systemInstructionCtrl.text = settings.geminiSystemInstruction;
  }

  @override
  void dispose() {
    _geminiKeyCtrl.dispose();
    _systemInstructionCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(voiceSettingsProvider);
    final settingsNotifier = ref.watch(voiceSettingsProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Voice Commands'),
        actions: [
          IconButton(
            icon: const Icon(Icons.restore),
            tooltip: 'Reset to Defaults',
            onPressed: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  title: const Text('Reset Commands'),
                  content: const Text('Reset all voice commands to defaults?'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                    TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reset')),
                  ],
                ),
              );
              if (confirmed == true) {
                settingsNotifier.resetToDefaults();
              }
            },
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // ─── Default Chat & Agent ─────────────────────────────
          _SectionCard(
            title: 'DEFAULT VOICE ROUTING',
            children: [
              // Default conversation
              ListTile(
                leading: const Icon(Icons.chat_bubble_outline, color: GodTheme.primary),
                title: const Text('Default Chat'),
                subtitle: Text(
                  settings.defaultConversationId != null
                      ? 'Chat #${settings.defaultConversationId}'
                      : 'Not set — voice goes to Frame Noa',
                  style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                ),
                trailing: const Icon(Icons.chevron_right, size: 20),
                onTap: () => _selectDefaultConversation(context, settingsNotifier),
              ),

              // Default agent
              ListTile(
                leading: const Icon(Icons.smart_toy_outlined, color: GodTheme.accent),
                title: const Text('Default Agent'),
                subtitle: Text(
                  settings.defaultAgentName ?? 'Not set — use system default',
                  style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                ),
                trailing: const Icon(Icons.chevron_right, size: 20),
                onTap: () => _selectDefaultAgent(context, settingsNotifier),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // ─── Voice Commands ───────────────────────────────────
          _SectionCard(
            title: 'VOICE COMMANDS',
            children: [
              if (settings.commands.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'No commands configured.\nTap + to add a voice command.',
                    style: TextStyle(color: GodTheme.textMuted),
                    textAlign: TextAlign.center,
                  ),
                )
              else
                ...settings.commands.map((cmd) => _VoiceCommandTile(
                  command: cmd,
                  onToggle: () => settingsNotifier.toggleCommand(cmd.id),
                  onEdit: () => _editCommand(context, cmd, settingsNotifier),
                  onDelete: () => settingsNotifier.removeCommand(cmd.id),
                )),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.add_circle_outline, color: GodTheme.success),
                title: const Text('Add Voice Command'),
                onTap: () => _addCommand(context, settingsNotifier),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // ─── Gemini Live Settings ─────────────────────────────
          _SectionCard(
            title: 'GEMINI LIVE MODE',
            children: [
              // API Key
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: TextField(
                  controller: _geminiKeyCtrl,
                  obscureText: !_showApiKey,
                  style: const TextStyle(fontSize: 14),
                  decoration: InputDecoration(
                    labelText: 'Gemini API Key',
                    hintText: 'AIza...',
                    prefixIcon: const Icon(Icons.key, size: 20),
                    suffixIcon: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: Icon(_showApiKey ? Icons.visibility_off : Icons.visibility, size: 20),
                          onPressed: () => setState(() => _showApiKey = !_showApiKey),
                        ),
                        IconButton(
                          icon: const Icon(Icons.save, size: 20, color: GodTheme.success),
                          onPressed: () {
                            settingsNotifier.setGeminiApiKey(_geminiKeyCtrl.text.trim());
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('API key saved')),
                            );
                          },
                        ),
                      ],
                    ),
                    border: const OutlineInputBorder(),
                  ),
                ),
              ),

              // Voice selection
              ListTile(
                leading: const Icon(Icons.record_voice_over, color: GodTheme.primary),
                title: const Text('Voice'),
                trailing: DropdownButton<String>(
                  value: settings.geminiVoice,
                  underline: const SizedBox(),
                  items: VoiceSettings.geminiVoices
                      .map((v) => DropdownMenuItem(value: v, child: Text(v)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) settingsNotifier.setGeminiVoice(v);
                  },
                ),
              ),

              // System instruction
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: TextField(
                  controller: _systemInstructionCtrl,
                  maxLines: 4,
                  style: const TextStyle(fontSize: 13),
                  decoration: InputDecoration(
                    labelText: 'System Instruction',
                    hintText: 'You are a helpful assistant...',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.save, size: 20, color: GodTheme.success),
                      onPressed: () {
                        settingsNotifier.setGeminiSystemInstruction(
                          _systemInstructionCtrl.text.trim(),
                        );
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('System instruction saved')),
                        );
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),

          const SizedBox(height: 16),

          // ─── TTS (Text-to-Speech) Settings ─────────────────────
          _SectionCard(
            title: 'TEXT-TO-SPEECH (TTS)',
            children: [
              // Enable/disable toggle
              SwitchListTile(
                secondary: const Icon(Icons.volume_up, color: GodTheme.primary),
                title: const Text('Read Responses Aloud'),
                subtitle: Text(
                  settings.ttsEnabled
                      ? 'AI responses will be spoken'
                      : 'TTS is off — tap to enable',
                  style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                ),
                value: settings.ttsEnabled,
                activeColor: GodTheme.primary,
                onChanged: (v) => settingsNotifier.setTtsEnabled(v),
              ),

              if (settings.ttsEnabled) ...[
                // Frame-only toggle
                SwitchListTile(
                  secondary: const Icon(Icons.diamond_outlined, color: GodTheme.frameBle),
                  title: const Text('Frame Only'),
                  subtitle: const Text(
                    'Only read responses from Frame voice',
                    style: TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                  ),
                  value: settings.ttsFrameOnly,
                  activeColor: GodTheme.frameBle,
                  onChanged: (v) => settingsNotifier.setTtsFrameOnly(v),
                ),

                // Language
                ListTile(
                  leading: const Icon(Icons.language, color: GodTheme.accent),
                  title: const Text('Language'),
                  trailing: DropdownButton<String>(
                    value: settings.ttsLanguage,
                    underline: const SizedBox(),
                    items: const [
                      DropdownMenuItem(value: 'en-US', child: Text('English (US)')),
                      DropdownMenuItem(value: 'en-GB', child: Text('English (UK)')),
                      DropdownMenuItem(value: 'ru-RU', child: Text('Russian')),
                      DropdownMenuItem(value: 'de-DE', child: Text('German')),
                      DropdownMenuItem(value: 'fr-FR', child: Text('French')),
                      DropdownMenuItem(value: 'es-ES', child: Text('Spanish')),
                      DropdownMenuItem(value: 'zh-CN', child: Text('Chinese')),
                      DropdownMenuItem(value: 'ja-JP', child: Text('Japanese')),
                    ],
                    onChanged: (v) {
                      if (v != null) settingsNotifier.setTtsLanguage(v);
                    },
                  ),
                ),

                // Speech rate slider
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.speed, size: 20, color: GodTheme.accent),
                          const SizedBox(width: 8),
                          const Text('Speech Rate', style: TextStyle(fontSize: 14)),
                          const Spacer(),
                          Text(
                            '${(settings.ttsSpeechRate * 100).round()}%',
                            style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                          ),
                        ],
                      ),
                      Slider(
                        value: settings.ttsSpeechRate,
                        min: 0.1,
                        max: 1.0,
                        divisions: 9,
                        activeColor: GodTheme.primary,
                        onChanged: (v) => settingsNotifier.setTtsSpeechRate(v),
                      ),
                    ],
                  ),
                ),

                const Divider(height: 1),

                // Voice Agent for TTS optimization
                ListTile(
                  leading: const Icon(Icons.auto_fix_high, color: GodTheme.warning),
                  title: const Text('Voice Agent'),
                  subtitle: Text(
                    settings.ttsVoiceAgentName != null && settings.ttsVoiceAgentName!.isNotEmpty
                        ? 'Agent: ${settings.ttsVoiceAgentName}'
                        : 'Not set — text spoken as-is (with cleanup)',
                    style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 20),
                  onTap: () => _editVoiceAgent(context, settingsNotifier, settings),
                ),

                // Test TTS button
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.play_arrow, size: 20),
                      label: const Text('Test TTS'),
                      onPressed: () {
                        final tts = ref.read(ttsServiceProvider);
                        tts.setLanguage(settings.ttsLanguage);
                        tts.setSpeechRate(settings.ttsSpeechRate);
                        tts.speak('Hello! This is the text-to-speech test. Voice commands are working correctly.');
                      },
                    ),
                  ),
                ),
                const SizedBox(height: 8),
              ],
            ],
          ),

          const SizedBox(height: 16),

          // ─── How It Works ─────────────────────────────────────
          _SectionCard(
            title: 'HOW IT WORKS',
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _HowItWorksStep(
                      icon: Icons.touch_app,
                      title: 'Tap Frame glasses',
                      subtitle: 'Activates listening mode',
                    ),
                    SizedBox(height: 12),
                    _HowItWorksStep(
                      icon: Icons.mic,
                      title: 'Say a command + text',
                      subtitle: 'e.g. "realtime" or "agent orchestrator check status"',
                    ),
                    SizedBox(height: 12),
                    _HowItWorksStep(
                      icon: Icons.route,
                      title: 'Routes automatically',
                      subtitle: 'Command word activates the right mode/agent',
                    ),
                    SizedBox(height: 12),
                    _HowItWorksStep(
                      icon: Icons.record_voice_over,
                      title: 'No command = default',
                      subtitle: 'Without command word, sends to default agent',
                    ),
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Future<void> _selectDefaultConversation(
    BuildContext context,
    VoiceSettingsNotifier notifier,
  ) async {
    final conversations = ref.read(conversationsProvider).valueOrNull ?? [];
    if (conversations.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No conversations available')),
      );
      return;
    }

    final selected = await showDialog<int?>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Select Default Chat'),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, -1),
            child: const Text('None (use Frame Noa)', style: TextStyle(color: GodTheme.textMuted)),
          ),
          ...conversations.map((c) => SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, c.id),
            child: Text(c.title),
          )),
        ],
      ),
    );

    if (selected != null) {
      notifier.setDefaultConversation(selected == -1 ? null : selected);
    }
  }

  Future<void> _selectDefaultAgent(
    BuildContext context,
    VoiceSettingsNotifier notifier,
  ) async {
    final agents = ref.read(agentsProvider).valueOrNull ?? [];

    final selected = await showDialog<String?>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Select Default Agent'),
        children: [
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, ''),
            child: const Text('None (system default)', style: TextStyle(color: GodTheme.textMuted)),
          ),
          ...agents.map((a) => SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, a.name),
            child: Row(
              children: [
                const Icon(Icons.smart_toy, size: 18, color: GodTheme.accent),
                const SizedBox(width: 8),
                Text(a.name),
              ],
            ),
          )),
        ],
      ),
    );

    if (selected != null) {
      notifier.setDefaultAgent(selected.isEmpty ? null : selected);
    }
  }

  Future<void> _addCommand(
    BuildContext context,
    VoiceSettingsNotifier notifier,
  ) async {
    final result = await _showCommandEditor(context, null);
    if (result != null) {
      notifier.addCommand(result);
    }
  }

  Future<void> _editCommand(
    BuildContext context,
    VoiceCommand command,
    VoiceSettingsNotifier notifier,
  ) async {
    final result = await _showCommandEditor(context, command);
    if (result != null) {
      notifier.updateCommand(result);
    }
  }

  Future<VoiceCommand?> _showCommandEditor(BuildContext context, VoiceCommand? existing) async {
    final keywordsCtrl = TextEditingController(text: existing?.keywords.join(', ') ?? '');
    final labelCtrl = TextEditingController(text: existing?.label ?? '');
    final agentCtrl = TextEditingController(text: existing?.agentName ?? '');
    final promptCtrl = TextEditingController(text: existing?.promptTemplate ?? '');
    var selectedAction = existing?.action ?? VoiceCommandAction.sendToAgent;

    return showDialog<VoiceCommand>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(existing != null ? 'Edit Command' : 'Add Command'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: labelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Label',
                    hintText: 'e.g. Call Orchestrator',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: keywordsCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Keywords (comma-separated)',
                    hintText: 'e.g. orchestrator, boss, chief',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<VoiceCommandAction>(
                  value: selectedAction,
                  decoration: const InputDecoration(
                    labelText: 'Action',
                    border: OutlineInputBorder(),
                  ),
                  items: VoiceCommandAction.values.map((a) => DropdownMenuItem(
                    value: a,
                    child: Text(_actionLabel(a)),
                  )).toList(),
                  onChanged: (v) {
                    if (v != null) setDialogState(() => selectedAction = v);
                  },
                ),
                if (selectedAction == VoiceCommandAction.sendToAgent) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: agentCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Agent Name',
                      hintText: 'e.g. orchestrator',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
                if (selectedAction == VoiceCommandAction.custom) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: promptCtrl,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Prompt Template',
                      hintText: 'Use {text} for voice input',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final keywords = keywordsCtrl.text
                    .split(',')
                    .map((k) => k.trim())
                    .where((k) => k.isNotEmpty)
                    .toList();
                if (keywords.isEmpty || labelCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Keywords and label are required')),
                  );
                  return;
                }
                Navigator.pop(ctx, VoiceCommand(
                  id: existing?.id ?? 'cmd_${DateTime.now().millisecondsSinceEpoch}',
                  keywords: keywords,
                  action: selectedAction,
                  agentName: agentCtrl.text.trim().isNotEmpty ? agentCtrl.text.trim() : null,
                  promptTemplate: promptCtrl.text.trim().isNotEmpty ? promptCtrl.text.trim() : null,
                  label: labelCtrl.text.trim(),
                  enabled: existing?.enabled ?? true,
                ));
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _editVoiceAgent(
    BuildContext context,
    VoiceSettingsNotifier notifier,
    VoiceSettings settings,
  ) async {
    final nameCtrl = TextEditingController(text: settings.ttsVoiceAgentName ?? '');
    final promptCtrl = TextEditingController(
      text: settings.ttsVoiceAgentPrompt ??
          'Optimize this text for voice reading. '
          'Remove markdown formatting, tables, code blocks. '
          'Spell out abbreviations. Make it natural for spoken delivery. '
          'Keep it concise. Return ONLY the optimized text.',
    );

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Voice Agent (TTS)'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Optional: route AI responses through a Voice Agent '
                'to optimize text before speaking (remove tables, simplify, translate).',
                style: TextStyle(color: GodTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Agent Name',
                  hintText: 'e.g. voice-optimizer',
                  prefixIcon: Icon(Icons.smart_toy, size: 20),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: promptCtrl,
                maxLines: 5,
                style: const TextStyle(fontSize: 13),
                decoration: const InputDecoration(
                  labelText: 'Optimization Prompt',
                  hintText: 'Instructions for optimizing text...',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              nameCtrl.clear();
              notifier.setTtsVoiceAgentName(null);
              notifier.setTtsVoiceAgentPrompt(null);
              Navigator.pop(ctx, true);
            },
            child: const Text('Clear', style: TextStyle(color: GodTheme.error)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              notifier.setTtsVoiceAgentName(
                nameCtrl.text.trim().isNotEmpty ? nameCtrl.text.trim() : null,
              );
              notifier.setTtsVoiceAgentPrompt(
                promptCtrl.text.trim().isNotEmpty ? promptCtrl.text.trim() : null,
              );
              Navigator.pop(ctx, true);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (saved == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Voice Agent settings saved')),
      );
    }
  }

  String _actionLabel(VoiceCommandAction action) {
    switch (action) {
      case VoiceCommandAction.geminiLive:
        return 'Gemini Live (Realtime Voice)';
      case VoiceCommandAction.sendToAgent:
        return 'Send to Agent';
      case VoiceCommandAction.sendToDefault:
        return 'Send to Default Chat';
      case VoiceCommandAction.takePhoto:
        return 'Take Photo + AI';
      case VoiceCommandAction.custom:
        return 'Custom Prompt';
    }
  }
}

// ─── Helper Widgets ─────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const _SectionCard({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 16, top: 12, bottom: 4),
            child: Text(
              title,
              style: const TextStyle(
                color: GodTheme.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}

class _VoiceCommandTile extends StatelessWidget {
  final VoiceCommand command;
  final VoidCallback onToggle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _VoiceCommandTile({
    required this.command,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(
        _actionIcon(command.action),
        color: command.enabled ? _actionColor(command.action) : GodTheme.textMuted,
      ),
      title: Text(
        command.label,
        style: TextStyle(
          color: command.enabled ? GodTheme.textPrimary : GodTheme.textMuted,
          decoration: command.enabled ? null : TextDecoration.lineThrough,
        ),
      ),
      subtitle: Text(
        command.keywords.join(', '),
        style: TextStyle(
          color: GodTheme.textSecondary,
          fontSize: 12,
          fontStyle: FontStyle.italic,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Switch(
            value: command.enabled,
            onChanged: (_) => onToggle(),
            activeColor: GodTheme.primary,
          ),
          PopupMenuButton<String>(
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'edit', child: Text('Edit')),
              const PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: GodTheme.error))),
            ],
            onSelected: (v) {
              if (v == 'edit') onEdit();
              if (v == 'delete') onDelete();
            },
          ),
        ],
      ),
    );
  }

  IconData _actionIcon(VoiceCommandAction action) {
    switch (action) {
      case VoiceCommandAction.geminiLive:
        return Icons.surround_sound;
      case VoiceCommandAction.sendToAgent:
        return Icons.smart_toy;
      case VoiceCommandAction.sendToDefault:
        return Icons.send;
      case VoiceCommandAction.takePhoto:
        return Icons.camera_alt;
      case VoiceCommandAction.custom:
        return Icons.code;
    }
  }

  Color _actionColor(VoiceCommandAction action) {
    switch (action) {
      case VoiceCommandAction.geminiLive:
        return GodTheme.frameBle;
      case VoiceCommandAction.sendToAgent:
        return GodTheme.accent;
      case VoiceCommandAction.sendToDefault:
        return GodTheme.primary;
      case VoiceCommandAction.takePhoto:
        return GodTheme.warning;
      case VoiceCommandAction.custom:
        return GodTheme.success;
    }
  }
}

class _HowItWorksStep extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;

  const _HowItWorksStep({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: GodTheme.primary.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, size: 20, color: GodTheme.primary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              Text(subtitle, style: const TextStyle(color: GodTheme.textSecondary, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }
}
