import 'dart:convert';

/// Action types for voice commands.
enum VoiceCommandAction {
  /// Activate Gemini Live real-time voice mode (WebSocket streaming).
  geminiLive,

  /// Send the rest of the text to a specific CRM agent in a chat.
  sendToAgent,

  /// Send to default chat with default agent.
  sendToDefault,

  /// Take a photo and send to AI with optional text.
  takePhoto,

  /// Custom action — runs a custom prompt template.
  custom,
}

/// A single voice command mapping: keyword → action.
class VoiceCommand {
  /// Unique ID for this command.
  final String id;

  /// The keyword(s) to match (case-insensitive).
  /// Can be multiple words separated by |, e.g. "realtime|live".
  final List<String> keywords;

  /// The action to perform when this command is recognized.
  final VoiceCommandAction action;

  /// For sendToAgent: the agent name to route to (e.g. "orchestrator").
  final String? agentName;

  /// For sendToAgent/sendToDefault: the conversation ID to send to.
  final int? conversationId;

  /// For custom: prompt template where {text} is replaced with remaining speech.
  final String? promptTemplate;

  /// User-friendly label for display in settings.
  final String label;

  /// Whether this command is enabled.
  final bool enabled;

  const VoiceCommand({
    required this.id,
    required this.keywords,
    required this.action,
    this.agentName,
    this.conversationId,
    this.promptTemplate,
    required this.label,
    this.enabled = true,
  });

  /// Check if a word matches any of this command's keywords.
  bool matches(String word) {
    final lower = word.toLowerCase().trim();
    return keywords.any((k) => k.toLowerCase().trim() == lower);
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'keywords': keywords,
    'action': action.name,
    'agentName': agentName,
    'conversationId': conversationId,
    'promptTemplate': promptTemplate,
    'label': label,
    'enabled': enabled,
  };

  factory VoiceCommand.fromJson(Map<String, dynamic> json) => VoiceCommand(
    id: json['id'] as String,
    keywords: (json['keywords'] as List).cast<String>(),
    action: VoiceCommandAction.values.firstWhere(
      (e) => e.name == json['action'],
      orElse: () => VoiceCommandAction.sendToDefault,
    ),
    agentName: json['agentName'] as String?,
    conversationId: json['conversationId'] as int?,
    promptTemplate: json['promptTemplate'] as String?,
    label: json['label'] as String,
    enabled: json['enabled'] as bool? ?? true,
  );

  VoiceCommand copyWith({
    String? id,
    List<String>? keywords,
    VoiceCommandAction? action,
    String? agentName,
    int? conversationId,
    String? promptTemplate,
    String? label,
    bool? enabled,
  }) => VoiceCommand(
    id: id ?? this.id,
    keywords: keywords ?? this.keywords,
    action: action ?? this.action,
    agentName: agentName ?? this.agentName,
    conversationId: conversationId ?? this.conversationId,
    promptTemplate: promptTemplate ?? this.promptTemplate,
    label: label ?? this.label,
    enabled: enabled ?? this.enabled,
  );
}

/// Voice settings stored per user.
class VoiceSettings {
  /// Default conversation ID for voice messages.
  final int? defaultConversationId;

  /// Default agent name for voice responses.
  final String? defaultAgentName;

  /// Gemini API key (for Gemini Live mode).
  final String? geminiApiKey;

  /// Gemini voice name (Puck, Charon, Kore, etc.).
  final String geminiVoice;

  /// Gemini system instruction.
  final String geminiSystemInstruction;

  /// All configured voice commands.
  final List<VoiceCommand> commands;

  // ─── TTS (Text-to-Speech) Settings ──────────────────────────────

  /// Whether to auto-read AI responses aloud.
  final bool ttsEnabled;

  /// TTS language (e.g., 'en-US', 'ru-RU').
  final String ttsLanguage;

  /// TTS speech rate (0.0 - 1.0).
  final double ttsSpeechRate;

  /// Voice Agent name for TTS text optimization (optional).
  /// If set, the response text is sent to this agent for cleanup
  /// before being spoken (removes tables, numbers to words, etc.).
  final String? ttsVoiceAgentName;

  /// Custom prompt for the Voice Agent optimization.
  final String? ttsVoiceAgentPrompt;

  /// Whether to only read Frame responses (vs all chat messages).
  final bool ttsFrameOnly;

  const VoiceSettings({
    this.defaultConversationId,
    this.defaultAgentName,
    this.geminiApiKey,
    this.geminiVoice = 'Kore',
    this.geminiSystemInstruction = 'You are a helpful AI assistant speaking through smart glasses. '
        'Keep responses concise and natural for voice conversation. '
        'The images you see are from the user\'s smart glasses camera. '
        'Respond directly without restating the question.',
    this.commands = const [],
    this.ttsEnabled = false,
    this.ttsLanguage = 'en-US',
    this.ttsSpeechRate = 0.5,
    this.ttsVoiceAgentName,
    this.ttsVoiceAgentPrompt,
    this.ttsFrameOnly = true,
  });

  Map<String, dynamic> toJson() => {
    'defaultConversationId': defaultConversationId,
    'defaultAgentName': defaultAgentName,
    'geminiApiKey': geminiApiKey,
    'geminiVoice': geminiVoice,
    'geminiSystemInstruction': geminiSystemInstruction,
    'commands': commands.map((c) => c.toJson()).toList(),
    'ttsEnabled': ttsEnabled,
    'ttsLanguage': ttsLanguage,
    'ttsSpeechRate': ttsSpeechRate,
    'ttsVoiceAgentName': ttsVoiceAgentName,
    'ttsVoiceAgentPrompt': ttsVoiceAgentPrompt,
    'ttsFrameOnly': ttsFrameOnly,
  };

  factory VoiceSettings.fromJson(Map<String, dynamic> json) => VoiceSettings(
    defaultConversationId: json['defaultConversationId'] as int?,
    defaultAgentName: json['defaultAgentName'] as String?,
    geminiApiKey: json['geminiApiKey'] as String?,
    geminiVoice: json['geminiVoice'] as String? ?? 'Kore',
    geminiSystemInstruction: json['geminiSystemInstruction'] as String? ??
        'You are a helpful AI assistant speaking through smart glasses. '
        'Keep responses concise and natural for voice conversation.',
    commands: (json['commands'] as List?)
            ?.map((c) => VoiceCommand.fromJson(c as Map<String, dynamic>))
            .toList() ??
        [],
    ttsEnabled: json['ttsEnabled'] as bool? ?? false,
    ttsLanguage: json['ttsLanguage'] as String? ?? 'en-US',
    ttsSpeechRate: (json['ttsSpeechRate'] as num?)?.toDouble() ?? 0.5,
    ttsVoiceAgentName: json['ttsVoiceAgentName'] as String?,
    ttsVoiceAgentPrompt: json['ttsVoiceAgentPrompt'] as String?,
    ttsFrameOnly: json['ttsFrameOnly'] as bool? ?? true,
  );

  VoiceSettings copyWith({
    int? defaultConversationId,
    String? defaultAgentName,
    String? geminiApiKey,
    String? geminiVoice,
    String? geminiSystemInstruction,
    List<VoiceCommand>? commands,
    bool? ttsEnabled,
    String? ttsLanguage,
    double? ttsSpeechRate,
    String? ttsVoiceAgentName,
    String? ttsVoiceAgentPrompt,
    bool? ttsFrameOnly,
  }) => VoiceSettings(
    defaultConversationId: defaultConversationId ?? this.defaultConversationId,
    defaultAgentName: defaultAgentName ?? this.defaultAgentName,
    geminiApiKey: geminiApiKey ?? this.geminiApiKey,
    geminiVoice: geminiVoice ?? this.geminiVoice,
    geminiSystemInstruction: geminiSystemInstruction ?? this.geminiSystemInstruction,
    commands: commands ?? this.commands,
    ttsEnabled: ttsEnabled ?? this.ttsEnabled,
    ttsLanguage: ttsLanguage ?? this.ttsLanguage,
    ttsSpeechRate: ttsSpeechRate ?? this.ttsSpeechRate,
    ttsVoiceAgentName: ttsVoiceAgentName ?? this.ttsVoiceAgentName,
    ttsVoiceAgentPrompt: ttsVoiceAgentPrompt ?? this.ttsVoiceAgentPrompt,
    ttsFrameOnly: ttsFrameOnly ?? this.ttsFrameOnly,
  );

  /// Serialize to JSON string for SharedPreferences storage.
  String serialize() => jsonEncode(toJson());

  /// Deserialize from JSON string.
  factory VoiceSettings.deserialize(String json) =>
      VoiceSettings.fromJson(jsonDecode(json) as Map<String, dynamic>);

  /// Default commands pre-configured out of the box.
  static List<VoiceCommand> get defaultCommands => [
    const VoiceCommand(
      id: 'cmd_realtime',
      keywords: ['realtime', 'live', 'stream'],
      action: VoiceCommandAction.geminiLive,
      label: 'Gemini Live Mode',
    ),
    const VoiceCommand(
      id: 'cmd_photo',
      keywords: ['photo', 'look', 'see'],
      action: VoiceCommandAction.takePhoto,
      label: 'Take Photo + AI',
    ),
  ];

  /// Default commands in Russian.
  static List<VoiceCommand> get defaultCommandsRu => [
    const VoiceCommand(
      id: 'cmd_realtime',
      keywords: ['realtime', 'live', 'stream'],
      action: VoiceCommandAction.geminiLive,
      label: 'Gemini Live Mode',
    ),
    const VoiceCommand(
      id: 'cmd_photo',
      keywords: ['photo', 'look', 'see'],
      action: VoiceCommandAction.takePhoto,
      label: 'Take Photo + AI',
    ),
  ];

  /// Available Gemini voices.
  static const List<String> geminiVoices = [
    'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr',
  ];
}

/// Result of parsing a voice command from recognized speech.
class VoiceCommandParseResult {
  /// The matched command (null if no command matched).
  final VoiceCommand? command;

  /// The remaining text after the command keyword.
  final String remainingText;

  /// The original full text.
  final String fullText;

  const VoiceCommandParseResult({
    this.command,
    required this.remainingText,
    required this.fullText,
  });

  bool get hasCommand => command != null;
}

/// Parse recognized speech text against a list of voice commands.
VoiceCommandParseResult parseVoiceCommand(
  String text,
  List<VoiceCommand> commands,
) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) {
    return VoiceCommandParseResult(remainingText: '', fullText: trimmed);
  }

  // Try matching first word(s) against each enabled command
  final words = trimmed.split(RegExp(r'\s+'));

  for (final cmd in commands) {
    if (!cmd.enabled) continue;

    // Try single-word match first
    if (cmd.matches(words[0])) {
      final remaining = words.length > 1 ? words.sublist(1).join(' ') : '';
      return VoiceCommandParseResult(
        command: cmd,
        remainingText: remaining,
        fullText: trimmed,
      );
    }

    // Try two-word match (e.g. "agent orchestrator")
    if (words.length >= 2) {
      final twoWords = '${words[0]} ${words[1]}';
      if (cmd.matches(twoWords)) {
        final remaining = words.length > 2 ? words.sublist(2).join(' ') : '';
        return VoiceCommandParseResult(
          command: cmd,
          remainingText: remaining,
          fullText: trimmed,
        );
      }
    }
  }

  // No command matched — return full text as remaining
  return VoiceCommandParseResult(
    remainingText: trimmed,
    fullText: trimmed,
  );
}
