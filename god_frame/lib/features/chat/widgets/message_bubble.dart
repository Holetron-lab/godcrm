import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../core/theme.dart';
import '../../../shared/utils/api_client.dart';
import '../data/models.dart';

/// Parsed forwarded message data.
class _ForwardedMessage {
  final String sender;
  final String? timestamp;
  final String body;
  final int? sourceConvId;
  final int? sourceMessageId;

  const _ForwardedMessage({
    required this.sender,
    this.timestamp,
    required this.body,
    this.sourceConvId,
    this.sourceMessageId,
  });
}

/// Try to parse forwarded message format:
/// --- Переслано от Name (timestamp) ---
/// content
/// --- конец пересланного сообщения ---
/// _Источник: чат #123, сообщение #456_
_ForwardedMessage? _parseForwardedMessage(String content) {
  final headerRe = RegExp(
    r'^---\s*Переслано от\s+(.+?)(?:\s*\(([^)]+)\))?\s*---\s*\n',
    caseSensitive: false,
  );
  final match = headerRe.firstMatch(content);
  if (match == null) return null;

  final sender = match.group(1)!.trim();
  final timestamp = match.group(2)?.trim();
  final afterHeader = content.substring(match.end);

  // Find end marker
  final endRe = RegExp(r'\n---\s*конец пересланного сообщения\s*---', caseSensitive: false);
  final endMatch = endRe.firstMatch(afterHeader);
  if (endMatch == null) return null;

  final body = afterHeader.substring(0, endMatch.start);
  final afterEnd = afterHeader.substring(endMatch.end).trim();

  // Parse source reference
  int? sourceConvId;
  int? sourceMessageId;
  final sourceRe = RegExp(r'_Источник:\s*чат\s*#(\d+),\s*сообщение\s*#(\d+)_');
  final sourceMatch = sourceRe.firstMatch(afterEnd);
  if (sourceMatch != null) {
    sourceConvId = int.tryParse(sourceMatch.group(1)!);
    sourceMessageId = int.tryParse(sourceMatch.group(2)!);
  }

  return _ForwardedMessage(
    sender: sender,
    timestamp: timestamp,
    body: body,
    sourceConvId: sourceConvId,
    sourceMessageId: sourceMessageId,
  );
}

/// Render <<@slug>> and <</slug>> invocation tokens as styled markdown bold text.
String _renderInvocationTokens(String content) {
  // <<@slug>> -> **@slug** (mention invocation)
  var result = content.replaceAllMapped(
    RegExp(r'<<@([a-z0-9][a-z0-9_-]*)>>', caseSensitive: false),
    (m) => '**@${m.group(1)}**',
  );
  // <</slug>> -> **/slug** (command invocation)
  result = result.replaceAllMapped(
    RegExp(r'<</([a-z0-9][a-z0-9_-]*)>>', caseSensitive: false),
    (m) => '**/${m.group(1)}**',
  );
  return result;
}

/// Chat message bubble — AI Chat Panel style.
///
/// Structure:
/// ┌─ HEADER: avatar + name + role badge + status + time ─┐
/// │  Message content (markdown)                           │
/// │  Attachments                                          │
/// ├─ FOOTER: reactions | copy | forward ─────────────────┤
/// └──────────────────────────────────────────────────────┘
class MessageBubble extends StatefulWidget {
  final Message message;
  final bool showAvatar;
  final int toolStepCount;
  final List<Message> thinkingChain;
  final String? baseUrl;
  final void Function(Message message)? onForward;
  final void Function(Message message, String emoji)? onReact;
  final Map<int, List<String>>? reactions;

  const MessageBubble({
    super.key,
    required this.message,
    this.showAvatar = true,
    this.toolStepCount = 0,
    this.thinkingChain = const [],
    this.baseUrl,
    this.onForward,
    this.onReact,
    this.reactions,
  });

  @override
  State<MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<MessageBubble> {
  static const _quickReactions = ['👍', '❤️', '🔥', '😂', '😮', '👎'];

  String _resolveUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    final base = widget.baseUrl ?? getCurrentBaseUrl();
    if (url.startsWith('/')) return '$base$url';
    return '$base/$url';
  }

  Map<String, String> _imageHeadersFor(String url) {
    final headers = <String, String>{};
    try {
      final token = getCachedToken();
      if (token != null && token.isNotEmpty) {
        if (token.startsWith('sk-')) {
          headers['X-API-Key'] = token;
        } else {
          headers['Authorization'] = 'Bearer $token';
        }
      }
    } catch (_) {}
    return headers;
  }

  bool _callExpanded = false;

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final isUser = message.isUser;

    // Render call bubble separately
    if (message.isCall) return _buildCallBubble(context, message);

    final imageAttachments = message.attachments.where((a) => a.isImage).toList();
    final fileAttachments = message.attachments.where((a) => !a.isImage).toList();
    final messageReactions = widget.reactions?[message.id] ?? [];

    // Agent color for side indicator (like AI Chat Panel)
    final agentColor = isUser
        ? const Color(0xFF3B82F6)
        : _agentColor(message.agentName);

    return Padding(
      padding: EdgeInsets.only(
        top: widget.showAvatar ? 8 : 2,
        bottom: 2,
        left: isUser ? 32 : 2,
        right: isUser ? 2 : 32,
      ),
      child: GestureDetector(
        onLongPress: () => _showMessageActions(context),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Left color indicator for agent messages
            if (!isUser)
              Container(
                width: 3,
                constraints: const BoxConstraints(minHeight: 40),
                decoration: BoxDecoration(
                  color: agentColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            if (!isUser) const SizedBox(width: 4),
            Expanded(child: Container(
          decoration: BoxDecoration(
            color: isUser ? GodTheme.primary : GodTheme.surfaceLight,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(16),
              topRight: const Radius.circular(16),
              bottomLeft: Radius.circular(isUser ? 16 : 4),
              bottomRight: Radius.circular(isUser ? 4 : 16),
            ),
            border: isUser ? null : Border.all(color: GodTheme.border, width: 0.5),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // === HEADER ===
              _buildHeader(message, isUser),

              // === CONTENT ===
              if (widget.thinkingChain.isNotEmpty && !isUser)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: _ReasoningChainAccordion(thinkingMessages: widget.thinkingChain),
                ),
              if (widget.toolStepCount > 0 && !isUser)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: _ToolStepsAccordion(count: widget.toolStepCount),
                ),

              // Image attachments
              if (imageAttachments.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Column(
                    children: imageAttachments.map((a) {
                      final resolved = _resolveUrl(a.url);
                      return _ImageAttachment(
                        attachment: a,
                        resolvedUrl: resolved,
                        isUser: isUser,
                        headers: _imageHeadersFor(resolved),
                      );
                    }).toList(),
                  ),
                ),

              // Text content — detect forwarded messages
              if (message.content.trim().isNotEmpty)
                _buildContentBlock(message, isUser),

              // File attachments
              if (fileAttachments.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
                  child: Column(
                    children: fileAttachments.map((a) => _AttachmentChip(
                      attachment: a,
                      isUser: isUser,
                      onTap: () {
                        final url = _resolveUrl(a.url);
                        if (url.isNotEmpty) {
                          launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
                        }
                      },
                    )).toList(),
                  ),
                ),

              // === FOOTER ===
              _buildFooter(message, isUser, messageReactions),
            ],
          ),
        )),
            // Right color indicator for user messages
            if (isUser) const SizedBox(width: 4),
            if (isUser)
              Container(
                width: 3,
                constraints: const BoxConstraints(minHeight: 40),
                decoration: BoxDecoration(
                  color: agentColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// Generate a consistent color for an agent name (cached).
  static const _agentColors = [
    Color(0xFF8B5CF6), // purple
    Color(0xFF06B6D4), // cyan
    Color(0xFFF59E0B), // amber
    Color(0xFFEF4444), // red
    Color(0xFF10B981), // emerald
    Color(0xFFEC4899), // pink
    Color(0xFF6366F1), // indigo
    Color(0xFF14B8A6), // teal
  ];
  static final _agentColorCache = <String, Color>{};

  static Color _agentColor(String? name) {
    if (name == null || name.isEmpty) return const Color(0xFF8B5CF6);
    return _agentColorCache.putIfAbsent(name, () {
      final hash = name.codeUnits.fold<int>(0, (prev, c) => prev + c);
      return _agentColors[hash % _agentColors.length];
    });
  }

  /// Header: avatar + name + role badge + status dot + timestamp
  Widget _buildHeader(Message message, bool isUser) {
    final name = isUser ? 'Вы' : (message.agentName ?? 'Ассистент');
    final roleLabel = isUser ? 'user' : 'agent';
    final roleColor = isUser ? const Color(0xFF3B82F6) : _agentColor(message.agentName);

    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
      child: Row(
        children: [
          // Mini avatar
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: isUser
                  ? const LinearGradient(
                      colors: [Color(0xFF3B82F6), Color(0xFF2563EB)],
                    )
                  : const LinearGradient(
                      colors: [Color(0xFF8B5CF6), Color(0xFF6366F1)],
                    ),
            ),
            child: Center(
              child: Icon(
                isUser ? Icons.person : Icons.smart_toy_outlined,
                size: 12,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(width: 6),
          // Name
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: isUser ? const Color(0xE6FFFFFF) : GodTheme.textPrimary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 6),
          // Role badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              color: (isUser ? Colors.white : roleColor).withOpacity(0.15),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              roleLabel,
              style: TextStyle(
                color: isUser ? Colors.white70 : roleColor,
                fontSize: 9,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 4),
          // Status dot
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isUser
                  ? const Color(0xFF22C55E) // online
                  : const Color(0xFF8B5CF6), // agent active
            ),
          ),
          const Spacer(),
          // Timestamp
          Text(
            message.time,
            style: TextStyle(
              color: isUser ? Colors.white54 : GodTheme.textMuted,
              fontSize: 10,
            ),
          ),
        ],
      ),
    );
  }

  /// Build content block — detects forwarded messages and renders styled quote.
  Widget _buildContentBlock(Message message, bool isUser) {
    final forwarded = _parseForwardedMessage(message.content);
    if (forwarded != null) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Forwarded quote block
            Container(
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(
                    color: isUser ? Colors.white54 : const Color(0xFF8B5CF6),
                    width: 3,
                  ),
                ),
                color: isUser
                    ? Colors.white.withOpacity(0.08)
                    : const Color(0xFF8B5CF6).withOpacity(0.06),
                borderRadius: const BorderRadius.only(
                  topRight: Radius.circular(8),
                  bottomRight: Radius.circular(8),
                ),
              ),
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Sender + timestamp
                  Row(
                    children: [
                      Icon(Icons.reply, size: 12,
                        color: isUser ? Colors.white70 : const Color(0xFF8B5CF6)),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          forwarded.sender,
                          style: TextStyle(
                            color: isUser ? Colors.white70 : const Color(0xFF8B5CF6),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (forwarded.timestamp != null) ...[
                        const SizedBox(width: 6),
                        Text(
                          forwarded.timestamp!,
                          style: TextStyle(
                            color: isUser ? Colors.white38 : GodTheme.textMuted,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  // Forwarded body
                  MarkdownBody(
                    data: _renderInvocationTokens(forwarded.body),
                    selectable: true,
                    imageBuilder: (uri, title, alt) {
                      final src = _resolveUrl(uri.toString());
                      return _InlineImage(url: src, alt: alt, headers: _imageHeadersFor(src));
                    },
                    onTapLink: (text, href, title) {
                      if (href != null) {
                        launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
                      }
                    },
                    styleSheet: _markdownStyle(isUser),
                  ),
                ],
              ),
            ),
            // Source reference
            if (forwarded.sourceConvId != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'чат #${forwarded.sourceConvId}, сообщение #${forwarded.sourceMessageId ?? "?"}',
                  style: TextStyle(
                    color: isUser ? Colors.white30 : GodTheme.textMuted,
                    fontSize: 10,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
          ],
        ),
      );
    }

    // Regular content
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      child: MarkdownBody(
        data: _renderInvocationTokens(message.content),
        selectable: true,
        imageBuilder: (uri, title, alt) {
          final src = _resolveUrl(uri.toString());
          return _InlineImage(url: src, alt: alt, headers: _imageHeadersFor(src));
        },
        onTapLink: (text, href, title) {
          if (href != null) {
            launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
          }
        },
        styleSheet: _markdownStyle(isUser),
      ),
    );
  }

  /// Footer: reactions above action icons
  Widget _buildFooter(Message message, bool isUser, List<String> messageReactions) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 2, 6, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Reactions row (above icons)
          if (messageReactions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Wrap(
                spacing: 4,
                runSpacing: 2,
                children: _buildReactionChips(messageReactions, isUser),
              ),
            ),
          // Action buttons row
          Row(
            children: [
              _FooterAction(
                icon: Icons.emoji_emotions_outlined,
                color: isUser ? Colors.white54 : GodTheme.textMuted,
                onTap: () => _showReactionPicker(context),
              ),
              _FooterAction(
                icon: Icons.copy_outlined,
                color: isUser ? Colors.white54 : GodTheme.textMuted,
                onTap: () {
                  Clipboard.setData(ClipboardData(text: message.content));
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Скопировано'), duration: Duration(seconds: 1)),
                  );
                },
              ),
              if (widget.onForward != null)
                _FooterAction(
                  icon: Icons.reply_outlined,
                  color: isUser ? Colors.white54 : GodTheme.textMuted,
                  onTap: () => widget.onForward?.call(message),
                ),
              const Spacer(),
            ],
          ),
        ],
      ),
    );
  }

  /// Format seconds to MM:SS
  String _fmtTime(dynamic seconds) {
    final s = (seconds is num ? seconds.toInt() : 0);
    final m = s ~/ 60;
    final sec = s % 60;
    return '$m:${sec.toString().padLeft(2, '0')}';
  }

  /// Format duration to human-readable
  String _fmtDuration(double seconds) {
    final m = seconds ~/ 60;
    final s = (seconds % 60).toInt();
    if (m > 0) return '$m мин${s > 0 ? ' $s сек' : ''}';
    return '$s сек';
  }

  /// Speaker color palette
  Color _speakerColor(int index) {
    const colors = [
      Color(0xFF3B82F6), // blue
      Color(0xFF10B981), // emerald
      Color(0xFFF59E0B), // amber
      Color(0xFFEF4444), // red
      Color(0xFF8B5CF6), // purple
      Color(0xFFEC4899), // pink
      Color(0xFF06B6D4), // cyan
      Color(0xFF14B8A6), // teal
    ];
    return colors[index % colors.length];
  }

  /// Expandable call transcript bubble
  Widget _buildCallBubble(BuildContext context, Message message) {
    final dialogue = message.callDialogue;
    final duration = message.callDuration;
    final participants = message.callParticipants;

    // Build speaker → index map for colors
    final speakerMap = <String, int>{};
    for (final d in dialogue) {
      final speaker = d['speaker']?.toString() ?? '';
      if (speaker.isNotEmpty && !speakerMap.containsKey(speaker)) {
        speakerMap[speaker] = speakerMap.length;
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
      child: Container(
        decoration: BoxDecoration(
          color: GodTheme.surfaceLight,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0x4D3B82F6), width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // === CALL HEADER (always visible) ===
            InkWell(
              onTap: () => setState(() => _callExpanded = !_callExpanded),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
              child: Container(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0x263B82F6),
                      Color(0x148B5CF6),
                    ],
                  ),
                  borderRadius: _callExpanded
                      ? const BorderRadius.vertical(top: Radius.circular(16))
                      : BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    // Phone icon
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: const LinearGradient(
                          colors: [Color(0xFF3B82F6), Color(0xFF2563EB)],
                        ),
                      ),
                      child: const Icon(Icons.phone, color: Colors.white, size: 18),
                    ),
                    const SizedBox(width: 10),
                    // Title + duration
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Звонок',
                            style: TextStyle(
                              color: GodTheme.textPrimary,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Icon(Icons.timer_outlined, size: 12, color: GodTheme.textMuted),
                              const SizedBox(width: 3),
                              Text(
                                _fmtDuration(duration),
                                style: TextStyle(color: GodTheme.textMuted, fontSize: 11),
                              ),
                              if (participants.isNotEmpty) ...[
                                const SizedBox(width: 8),
                                Icon(Icons.group_outlined, size: 12, color: GodTheme.textMuted),
                                const SizedBox(width: 3),
                                Text(
                                  '${participants.length}',
                                  style: TextStyle(color: GodTheme.textMuted, fontSize: 11),
                                ),
                              ],
                            ],
                          ),
                        ],
                      ),
                    ),
                    // Participant avatars
                    if (participants.isNotEmpty)
                      Row(
                        children: participants.take(3).toList().asMap().entries.map((entry) {
                          final idx = entry.key;
                          final name = entry.value;
                          return Transform.translate(
                            offset: Offset(-idx * 8.0, 0),
                            child: Container(
                              width: 24,
                              height: 24,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: _speakerColor(idx),
                                border: Border.all(color: GodTheme.surfaceLight, width: 1.5),
                              ),
                              child: Center(
                                child: Text(
                                  name.isNotEmpty ? name[0].toUpperCase() : '?',
                                  style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w600),
                                ),
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    const SizedBox(width: 4),
                    // Expand/collapse arrow
                    Icon(
                      _callExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                      color: GodTheme.textMuted,
                      size: 20,
                    ),
                    // Timestamp
                    const SizedBox(width: 4),
                    Text(
                      message.time,
                      style: TextStyle(color: GodTheme.textMuted, fontSize: 10),
                    ),
                  ],
                ),
              ),
            ),

            // === DIALOGUE (expandable) ===
            if (_callExpanded && dialogue.isNotEmpty)
              Container(
                padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Participants legend
                    if (speakerMap.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6, left: 4),
                        child: Wrap(
                          spacing: 8,
                          children: speakerMap.entries.map((e) => Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 8, height: 8,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: _speakerColor(e.value),
                                ),
                              ),
                              const SizedBox(width: 4),
                              Text(e.key, style: TextStyle(fontSize: 11, color: GodTheme.textMuted)),
                            ],
                          )).toList(),
                        ),
                      ),
                    const Divider(height: 1),
                    const SizedBox(height: 4),
                    // Dialogue lines
                    ...dialogue.map((d) {
                      final speaker = d['speaker']?.toString() ?? '';
                      final text = d['text']?.toString() ?? '';
                      final start = d['start'];
                      final speakerIdx = speakerMap[speaker] ?? 0;
                      final color = _speakerColor(speakerIdx);

                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 3),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Color bar
                            Container(
                              width: 3,
                              constraints: const BoxConstraints(minHeight: 20),
                              decoration: BoxDecoration(
                                color: color,
                                borderRadius: BorderRadius.circular(2),
                              ),
                            ),
                            const SizedBox(width: 6),
                            // Content
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Text(
                                        speaker,
                                        style: TextStyle(
                                          color: color,
                                          fontSize: 11,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      if (start != null) ...[
                                        const SizedBox(width: 6),
                                        Text(
                                          _fmtTime(start),
                                          style: TextStyle(
                                            color: GodTheme.textMuted,
                                            fontSize: 9,
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  const SizedBox(height: 1),
                                  Text(
                                    text,
                                    style: TextStyle(
                                      color: GodTheme.textPrimary,
                                      fontSize: 13,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildReactionChips(List<String> reactions, bool isUser) {
    final counts = <String, int>{};
    for (final r in reactions) {
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts.entries.map((e) {
      return GestureDetector(
        onTap: () => widget.onReact?.call(widget.message, e.key),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          decoration: BoxDecoration(
            color: isUser ? const Color(0x26FFFFFF) : const Color(0x266366F1),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            e.value > 1 ? '${e.key} ${e.value}' : e.key,
            style: const TextStyle(fontSize: 13),
          ),
        ),
      );
    }).toList();
  }

  void _showReactionPicker(BuildContext context) {
    HapticFeedback.lightImpact();
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: _quickReactions.map((emoji) {
              return GestureDetector(
                onTap: () {
                  Navigator.pop(ctx);
                  widget.onReact?.call(widget.message, emoji);
                },
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: GodTheme.surfaceLight,
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Center(child: Text(emoji, style: const TextStyle(fontSize: 22))),
                ),
              );
            }).toList(),
          ),
        ),
      ),
    );
  }

  void _showMessageActions(BuildContext context) {
    HapticFeedback.mediumImpact();
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Quick reactions row
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: _quickReactions.map((emoji) {
                    return GestureDetector(
                      onTap: () {
                        Navigator.pop(ctx);
                        widget.onReact?.call(widget.message, emoji);
                      },
                      child: Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: GodTheme.surfaceLight,
                          borderRadius: BorderRadius.circular(22),
                        ),
                        child: Center(child: Text(emoji, style: const TextStyle(fontSize: 22))),
                      ),
                    );
                  }).toList(),
                ),
              ),
              const Divider(color: GodTheme.border, height: 1),
              ListTile(
                leading: const Icon(Icons.copy, color: GodTheme.textSecondary),
                title: const Text('Копировать'),
                onTap: () {
                  Clipboard.setData(ClipboardData(text: widget.message.content));
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Скопировано'), duration: Duration(seconds: 1)),
                  );
                },
              ),
              if (widget.onForward != null)
                ListTile(
                  leading: const Icon(Icons.reply, color: GodTheme.textSecondary),
                  title: const Text('Переслать'),
                  onTap: () {
                    Navigator.pop(ctx);
                    widget.onForward?.call(widget.message);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  MarkdownStyleSheet _markdownStyle(bool isUser) {
    return MarkdownStyleSheet(
      p: TextStyle(
        color: isUser ? Colors.white : GodTheme.textPrimary,
        fontSize: 14,
        height: 1.5,
      ),
      code: TextStyle(
        color: isUser ? Colors.white70 : GodTheme.accent,
        fontSize: 12,
        backgroundColor: isUser ? const Color(0x1AFFFFFF) : GodTheme.background,
        fontFamily: 'monospace',
      ),
      codeblockDecoration: BoxDecoration(
        color: isUser ? const Color(0x1AFFFFFF) : GodTheme.background,
        borderRadius: BorderRadius.circular(8),
      ),
      codeblockPadding: const EdgeInsets.all(10),
      blockquoteDecoration: BoxDecoration(
        border: Border(
          left: BorderSide(color: isUser ? Colors.white54 : GodTheme.primary, width: 3),
        ),
      ),
      blockquotePadding: const EdgeInsets.only(left: 12),
      a: TextStyle(
        color: isUser ? Colors.white : GodTheme.primary,
        decoration: TextDecoration.underline,
      ),
      listBullet: TextStyle(color: isUser ? Colors.white70 : GodTheme.textSecondary),
      h1: TextStyle(
        color: isUser ? Colors.white : GodTheme.textPrimary,
        fontSize: 18, fontWeight: FontWeight.w700,
      ),
      h2: TextStyle(
        color: isUser ? Colors.white : GodTheme.textPrimary,
        fontSize: 16, fontWeight: FontWeight.w600,
      ),
      h3: TextStyle(
        color: isUser ? Colors.white : GodTheme.textPrimary,
        fontSize: 15, fontWeight: FontWeight.w600,
      ),
      tableHead: TextStyle(
        color: isUser ? Colors.white : GodTheme.textPrimary,
        fontWeight: FontWeight.w600,
      ),
      tableBody: TextStyle(color: isUser ? Colors.white : GodTheme.textPrimary),
      tableBorder: TableBorder.all(color: isUser ? Colors.white24 : GodTheme.border, width: 1),
      tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    );
  }
}

/// Small footer action button.
class _FooterAction extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _FooterAction({required this.icon, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Icon(icon, size: 16, color: color),
      ),
    );
  }
}

/// Image attachment — rendered inline with CachedNetworkImage for auth headers + caching.
class _ImageAttachment extends StatelessWidget {
  final Attachment attachment;
  final String resolvedUrl;
  final bool isUser;
  final Map<String, String> headers;

  const _ImageAttachment({
    required this.attachment,
    required this.resolvedUrl,
    this.isUser = false,
    this.headers = const {},
  });

  @override
  Widget build(BuildContext context) {
    if (resolvedUrl.isEmpty) {
      return _AttachmentChip(attachment: attachment, isUser: isUser);
    }

    return GestureDetector(
      onTap: () => _showFullScreenImage(context),
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        constraints: const BoxConstraints(maxWidth: 280, maxHeight: 300),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isUser ? Colors.white24 : GodTheme.border,
            width: 0.5,
          ),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: CachedNetworkImage(
            imageUrl: resolvedUrl,
            httpHeaders: headers,
            fit: BoxFit.cover,
            placeholder: (context, url) => Container(
              width: 200, height: 150,
              color: isUser ? const Color(0x1AFFFFFF) : GodTheme.background,
              child: Center(
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: isUser ? Colors.white70 : GodTheme.primary,
                ),
              ),
            ),
            errorWidget: (context, url, error) {
              return Image.network(
                resolvedUrl,
                headers: const {},
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) return child;
                  return Container(
                    width: 200, height: 150,
                    color: isUser ? const Color(0x1AFFFFFF) : GodTheme.background,
                    child: Center(
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: isUser ? Colors.white70 : GodTheme.primary,
                      ),
                    ),
                  );
                },
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    width: 200, height: 80,
                    color: isUser ? const Color(0x1AFFFFFF) : GodTheme.background,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.broken_image_outlined, size: 28,
                            color: isUser ? Colors.white54 : GodTheme.textMuted),
                        const SizedBox(height: 4),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          child: Text(
                            attachment.name,
                            style: TextStyle(
                              color: isUser ? Colors.white54 : GodTheme.textMuted,
                              fontSize: 11,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }

  void _showFullScreenImage(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (ctx) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.black,
            foregroundColor: Colors.white,
            title: Text(attachment.name, style: const TextStyle(fontSize: 14)),
          ),
          body: Center(
            child: InteractiveViewer(
              minScale: 0.5,
              maxScale: 4.0,
              child: CachedNetworkImage(
                imageUrl: resolvedUrl,
                httpHeaders: headers,
                fit: BoxFit.contain,
                placeholder: (context, url) => const Center(
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                errorWidget: (context, url, error) {
                  return const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.broken_image, size: 64, color: Colors.white54),
                        SizedBox(height: 12),
                        Text('Failed to load image', style: TextStyle(color: Colors.white54)),
                      ],
                    ),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Inline image from markdown content.
class _InlineImage extends StatelessWidget {
  final String url;
  final String? alt;
  final Map<String, String> headers;

  const _InlineImage({required this.url, this.alt, this.headers = const {}});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (ctx) => Scaffold(
              backgroundColor: Colors.black,
              appBar: AppBar(
                backgroundColor: Colors.black,
                foregroundColor: Colors.white,
                title: Text(alt ?? 'Image', style: const TextStyle(fontSize: 14)),
              ),
              body: Center(
                child: InteractiveViewer(
                  minScale: 0.5,
                  maxScale: 4.0,
                  child: CachedNetworkImage(
                    imageUrl: url,
                    httpHeaders: headers,
                    fit: BoxFit.contain,
                  ),
                ),
              ),
            ),
          ),
        );
      },
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        constraints: const BoxConstraints(maxHeight: 300),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: CachedNetworkImage(
            imageUrl: url,
            httpHeaders: headers,
            fit: BoxFit.cover,
            placeholder: (context, imgUrl) => Container(
              width: 200, height: 120,
              color: GodTheme.background,
              child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
            ),
            errorWidget: (context, imgUrl, error) {
              return Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: GodTheme.background,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.broken_image, size: 16, color: GodTheme.textMuted),
                    const SizedBox(width: 6),
                    Text(
                      alt ?? 'Image failed to load',
                      style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Collapsed tool steps indicator.
class _ToolStepsAccordion extends StatefulWidget {
  final int count;
  const _ToolStepsAccordion({required this.count});

  @override
  State<_ToolStepsAccordion> createState() => _ToolStepsAccordionState();
}

class _ToolStepsAccordionState extends State<_ToolStepsAccordion> {
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: GodTheme.background,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color(0x802D2D44)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.build_outlined, size: 12, color: GodTheme.textMuted),
            const SizedBox(width: 4),
            Text(
              'Used ${widget.count} tool${widget.count != 1 ? 's' : ''}',
              style: const TextStyle(color: GodTheme.textMuted, fontSize: 11, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}

/// Collapsible reasoning chain.
class _ReasoningChainAccordion extends StatefulWidget {
  final List<Message> thinkingMessages;
  const _ReasoningChainAccordion({required this.thinkingMessages});

  @override
  State<_ReasoningChainAccordion> createState() => _ReasoningChainAccordionState();
}

class _ReasoningChainAccordionState extends State<_ReasoningChainAccordion>
    with SingleTickerProviderStateMixin {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final thinkingText = widget.thinkingMessages
        .map((m) => m.content.trim())
        .where((c) => c.isNotEmpty)
        .join('\n\n');

    final preview = thinkingText.length > 120
        ? '${thinkingText.substring(0, 120)}...'
        : thinkingText;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A2E),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0x4D8B5CF6)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _expanded ? Icons.psychology : Icons.psychology_outlined,
                    size: 12,
                    color: const Color(0xFF8B5CF6),
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: Text(
                      'Reasoning (${widget.thinkingMessages.length} step${widget.thinkingMessages.length != 1 ? 's' : ''})',
                      style: const TextStyle(
                        color: Color(0xFF8B5CF6), fontSize: 11, fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 14,
                    color: const Color(0xB38B5CF6),
                  ),
                ],
              ),
            ),
          ),
          if (_expanded) ...[
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFF0F0F1A),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: const Color(0x268B5CF6)),
              ),
              constraints: const BoxConstraints(maxHeight: 300),
              child: SingleChildScrollView(
                child: Text(
                  thinkingText,
                  style: TextStyle(
                    color: const Color(0xCC94A3B8),
                    fontSize: 11, height: 1.5,
                    fontFamily: 'monospace',
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            ),
          ] else if (preview.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              preview,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: const Color(0x9964748B),
                fontSize: 10,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// File attachment chip.
class _AttachmentChip extends StatelessWidget {
  final Attachment attachment;
  final bool isUser;
  final VoidCallback? onTap;

  const _AttachmentChip({required this.attachment, this.isUser = false, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: isUser ? const Color(0x26FFFFFF) : GodTheme.background,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: isUser ? Colors.white24 : GodTheme.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(_getFileIcon(), size: 14,
                color: isUser ? Colors.white70 : GodTheme.textSecondary),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                attachment.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: isUser ? Colors.white70 : GodTheme.textSecondary,
                  fontSize: 12,
                ),
              ),
            ),
            if (attachment.size != null) ...[
              const SizedBox(width: 6),
              Text(
                _formatSize(attachment.size!),
                style: TextStyle(
                  color: isUser ? Colors.white38 : GodTheme.textMuted,
                  fontSize: 10,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  IconData _getFileIcon() {
    final name = attachment.name.toLowerCase();
    final mime = attachment.mimeType?.toLowerCase() ?? '';
    if (mime.startsWith('application/pdf') || name.endsWith('.pdf')) return Icons.picture_as_pdf;
    if (mime.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.mov')) return Icons.videocam;
    if (mime.startsWith('audio/') || name.endsWith('.mp3') || name.endsWith('.wav')) return Icons.audiotrack;
    if (name.endsWith('.doc') || name.endsWith('.docx')) return Icons.description;
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return Icons.table_chart;
    if (name.endsWith('.zip') || name.endsWith('.rar')) return Icons.archive;
    return Icons.attach_file;
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)}KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)}MB';
  }
}
