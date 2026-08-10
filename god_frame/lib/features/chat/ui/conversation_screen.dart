import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../../../shared/utils/api_client.dart';
import '../data/models.dart';
import '../providers/conversations_provider.dart';
import '../providers/messages_provider.dart';
import '../providers/call_provider.dart';
import '../widgets/message_bubble.dart';
import '../widgets/scheduled_messages_bar.dart';
import '../widgets/schedule_date_picker.dart';
import '../providers/scheduled_messages_provider.dart';
import '../../crm/ui/link_row_sheet.dart';
import 'chat_input.dart';
import 'call_screen.dart';

/// Conversation screen — message thread with AI chat.
/// Shows real-time streaming of reasoning chains and tool steps.
/// Thinking messages appear live as the agent processes.
class ConversationScreen extends ConsumerStatefulWidget {
  final int conversationId;

  const ConversationScreen({super.key, required this.conversationId});

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _scrollController = ScrollController();
  bool _sending = false;
  String? _sendError;
  bool _isNearBottom = true;
  bool _initialScrollDone = false;
  final Map<int, List<String>> _reactions = {}; // messageId -> list of emojis
  bool _searchActive = false;
  String _searchQuery = '';
  final _searchController = TextEditingController();
  bool _summaryLoading = false;
  bool _showSchedulePicker = false;
  final _chatInputKey = GlobalKey<ChatInputState>();

  // Forward mode state
  Message? _forwardingMessage;
  Conversation? _forwardTargetConversation;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    // CRITICAL FIX: await loadMessages BEFORE starting background poll.
    // Previously both ran concurrently — the poll's immediate microtask would
    // see empty state (AsyncValue.loading), capture currentMessages = [],
    // and fetch ALL messages. Then loadMessages would overwrite state,
    // causing race conditions that could lose or duplicate messages.
    Future.microtask(() async {
      final notifier = ref.read(messagesProvider.notifier);
      // 1. Load messages first — await ensures state is populated
      await notifier.loadMessages(widget.conversationId);
      if (!mounted) return;
      ref.read(activeConversationIdProvider.notifier).state = widget.conversationId;
      // Mark conversation as read
      ref.read(conversationsProvider.notifier).markAsRead(widget.conversationId);
      // 2. Start background polling AFTER messages are loaded
      // This way the poll sees correct lastId from loaded messages
      notifier.startBackgroundPoll(widget.conversationId);
    });
  }

  @override
  void dispose() {
    // Stop background polling when leaving conversation
    // Use try-catch in case provider is already disposed
    try {
      ref.read(messagesProvider.notifier).stopBackgroundPoll();
    } catch (_) {}
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  /// Track scroll position: near bottom → auto-scroll on new messages.
  /// Near top → load older messages.
  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    // Consider "near bottom" if within 150px of the end
    _isNearBottom = pos.pixels >= pos.maxScrollExtent - 150;
    // Load older messages when scrolled near the top
    if (pos.pixels <= 100) {
      final notifier = ref.read(messagesProvider.notifier);
      if (notifier.hasMore && !notifier.isLoadingMore) {
        notifier.loadOlderMessages(widget.conversationId);
      }
    }
  }

  void _scrollToBottom() {
    if (_scrollController.hasClients) {
      Future.delayed(const Duration(milliseconds: 100), () {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  /// ADR-116: Wrap bare @mentions into structured <<@slug>> invocation tokens
  /// before sending, matching web AI Chat Panel behavior.
  String _wrapMentions(String text) {
    final users = ref.read(mentionableUsersProvider).valueOrNull ?? [];
    if (users.isEmpty) return text;
    final slugSet = <String>{};
    for (final u in users) {
      if (u.isAgent) slugSet.add(u.slug);
    }
    // Replace bare @slug (not already wrapped in <<@>>) with <<@slug>>
    return text.replaceAllMapped(
      RegExp(r'(?<!<)@([a-z0-9_-]+)', caseSensitive: false),
      (m) {
        final slug = m.group(1)!.toLowerCase();
        return slugSet.contains(slug) ? '<<@$slug>>' : m.group(0)!;
      },
    );
  }

  Future<void> _handleSend(String content, List<PendingAttachment> attachments) async {
    if (content.trim().isEmpty && attachments.isEmpty) return;
    if (_sending) return;

    // ADR-116: Validate and wrap bare @mentions into <<@slug>> tokens
    final wrappedContent = _wrapMentions(content.trim());

    setState(() {
      _sending = true;
      _sendError = null;
    });

    final success = await ref
        .read(messagesProvider.notifier)
        .sendMessage(
          widget.conversationId,
          wrappedContent,
          attachments: attachments.isNotEmpty ? attachments : null,
        );

    if (mounted) {
      setState(() {
        _sending = false;
        if (!success) {
          _sendError = ref.read(messagesProvider.notifier).lastError ??
              'Failed to send message';
        }
      });
    }

    // User just sent a message — always scroll to bottom and track position
    _isNearBottom = true;
    _scrollToBottom();

    if (!success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_sendError ?? 'Failed to send message'),
          backgroundColor: GodTheme.error,
          duration: const Duration(seconds: 5),
          action: SnackBarAction(
            label: 'Retry',
            textColor: Colors.white,
            onPressed: () => _handleSend(content, attachments),
          ),
        ),
      );
    }
  }

  /// Handle emoji reaction on a message.
  void _handleReact(Message message, String emoji) {
    setState(() {
      final list = _reactions[message.id] ?? [];
      // Toggle: if same emoji exists, remove it; otherwise add
      if (list.contains(emoji)) {
        list.remove(emoji);
      } else {
        list.add(emoji);
      }
      _reactions[message.id] = list;
    });
    HapticFeedback.lightImpact();
  }

  /// Handle forwarding a message — enter forward mode with card above input.
  void _handleForward(Message message) {
    setState(() {
      _forwardingMessage = message;
      _forwardTargetConversation = null; // user must pick target
    });
  }

  /// Cancel forward mode.
  void _cancelForward() {
    setState(() {
      _forwardingMessage = null;
      _forwardTargetConversation = null;
    });
  }

  /// Pick target conversation for forwarding.
  Future<void> _pickForwardTarget() async {
    final conversations = ref.read(conversationsProvider).valueOrNull ?? [];
    if (conversations.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Нет доступных чатов')),
      );
      return;
    }

    final selected = await showModalBottomSheet<Conversation>(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.8,
        expand: false,
        builder: (ctx, scrollCtrl) => Column(
          children: [
            Container(
              width: 36, height: 4,
              margin: const EdgeInsets.only(top: 12, bottom: 8),
              decoration: BoxDecoration(
                color: GodTheme.textMuted.withOpacity(0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Icon(Icons.forward, color: GodTheme.textPrimary, size: 20),
                  SizedBox(width: 8),
                  Text('Переслать в...', style: TextStyle(
                    color: GodTheme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600,
                  )),
                ],
              ),
            ),
            const Divider(color: GodTheme.border),
            Expanded(
              child: ListView.builder(
                controller: scrollCtrl,
                itemCount: conversations.length,
                itemBuilder: (ctx, i) {
                  final conv = conversations[i];
                  if (conv.id == widget.conversationId) return const SizedBox.shrink();
                  return ListTile(
                    key: ValueKey('fwd_conv_${conv.id}'),
                    leading: CircleAvatar(
                      radius: 18,
                      backgroundColor: GodTheme.primary.withOpacity(0.15),
                      child: const Icon(Icons.chat, size: 16, color: GodTheme.primary),
                    ),
                    title: Text(conv.title,
                      style: const TextStyle(color: GodTheme.textPrimary, fontSize: 14),
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: conv.lastMessage != null
                        ? Text(conv.lastMessage!,
                            style: const TextStyle(color: GodTheme.textMuted, fontSize: 11),
                            maxLines: 1, overflow: TextOverflow.ellipsis)
                        : null,
                    trailing: _forwardTargetConversation?.id == conv.id
                        ? const Icon(Icons.check_circle, color: GodTheme.success, size: 20)
                        : null,
                    onTap: () => Navigator.pop(ctx, conv),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );

    if (selected != null && mounted) {
      setState(() => _forwardTargetConversation = selected);
    }
  }

  /// Execute the forward — send message to target conversation.
  Future<void> _executeForward() async {
    final message = _forwardingMessage;
    final target = _forwardTargetConversation;
    if (message == null || target == null) return;

    final senderLabel = message.agentName ?? (message.isUser ? 'Вы' : 'Ассистент');
    final timestamp = message.createdAt.isNotEmpty
        ? ' (${_formatForwardTimestamp(message.createdAt)})'
        : '';
    final forwarded = '--- Переслано от $senderLabel$timestamp ---\n'
        '${message.content}\n'
        '--- конец пересланного сообщения ---\n\n'
        '_Источник: чат #${widget.conversationId}, сообщение #${message.id}_';
    final repo = ref.read(chatRepositoryProvider);
    final result = await repo.sendMessage(target.id, forwarded);

    if (mounted) {
      _cancelForward();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.isSuccess
              ? 'Переслано в "${target.title}"'
              : 'Ошибка: ${result.error}'),
          backgroundColor: result.isSuccess ? GodTheme.success : GodTheme.error,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  /// Format timestamp for forwarded message header.
  String _formatForwardTimestamp(String isoDate) {
    try {
      final dt = DateTime.parse(isoDate);
      return '${dt.day.toString().padLeft(2, '0')}.${dt.month.toString().padLeft(2, '0')}.${dt.year}, '
          '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return isoDate;
    }
  }

  /// Toggle schedule date picker.
  void _toggleSchedulePicker() {
    setState(() => _showSchedulePicker = !_showSchedulePicker);
  }

  /// Schedule the current input text for later.
  Future<void> _handleSchedule(DateTime scheduledAt) async {
    final inputState = _chatInputKey.currentState;
    final text = inputState?.currentText ?? '';
    if (text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Введите текст сообщения'), backgroundColor: GodTheme.error),
      );
      return;
    }

    final notifier = ref.read(scheduledMessagesProvider(widget.conversationId).notifier);
    final error = await notifier.schedule(text, scheduledAt.toUtc().toIso8601String());
    if (mounted) {
      setState(() => _showSchedulePicker = false);
      if (error == null) {
        inputState?.clearText();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Сообщение запланировано'), backgroundColor: GodTheme.success),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Ошибка: $error'), backgroundColor: GodTheme.error),
        );
      }
    }
  }

  /// Send a scheduled message immediately.
  Future<void> _handleSendScheduledNow(ScheduledMessage sm) async {
    final notifier = ref.read(scheduledMessagesProvider(widget.conversationId).notifier);
    final error = await notifier.sendNow(sm);
    if (mounted && error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка: $error'), backgroundColor: GodTheme.error),
      );
    }
  }

  /// Cancel a scheduled message.
  Future<void> _handleCancelScheduled(ScheduledMessage sm) async {
    final notifier = ref.read(scheduledMessagesProvider(widget.conversationId).notifier);
    final error = await notifier.cancel(sm.id);
    if (mounted && error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Ошибка: $error'), backgroundColor: GodTheme.error),
      );
    }
  }

  /// Edit (reschedule) a scheduled message — show picker with pre-filled content.
  void _handleEditScheduled(ScheduledMessage sm) {
    // For simplicity, show the date picker — on confirm, update the scheduled time
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => ScheduleDatePicker(
        onSchedule: (dt) async {
          Navigator.pop(ctx);
          final notifier = ref.read(scheduledMessagesProvider(widget.conversationId).notifier);
          final error = await notifier.edit(sm.id, scheduledAt: dt.toUtc().toIso8601String());
          if (mounted && error != null) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Ошибка: $error'), backgroundColor: GodTheme.error),
            );
          }
        },
        onCancel: () => Navigator.pop(ctx),
      ),
    );
  }

  /// Handle link row to CHAT — binds the selected row to the conversation via API.
  /// This is shown in the AppBar header.
  Future<void> _handleLinkRowToChat() async {
    final row = await showLinkRowSheet(context, ref);
    if (row != null && mounted) {
      final repo = ref.read(chatRepositoryProvider);
      final result = await repo.bindRow(widget.conversationId, row.tableId, row.id);
      if (mounted) {
        if (result.isSuccess) {
          ref.invalidate(conversationDetailProvider(widget.conversationId));
          ref.invalidate(conversationsProvider);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Привязано: ${row.displayTitle ?? "Row #${row.id}"}'),
              backgroundColor: GodTheme.success,
              duration: const Duration(seconds: 2),
            ),
          );
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Ошибка: ${result.error}'),
              backgroundColor: GodTheme.error,
              duration: const Duration(seconds: 3),
            ),
          );
        }
      }
    }
  }

  /// Handle link row to MESSAGE — inserts row reference into the message text.
  /// This is shown in the input area.
  Future<void> _handleLinkRowToMessage() async {
    final row = await showLinkRowSheet(context, ref);
    if (row != null && mounted) {
      final title = row.displayTitle ?? 'Row #${row.id}';
      final rowRef = '[📎 Table:${row.tableId} / $title (#${row.id})]';
      _handleSend(rowRef, []);
    }
  }

  /// Handle summary — calls the summary API endpoint (like AI Chat Panel).
  /// The backend triggers the summary agent to process the conversation.
  Future<void> _handleSummary() async {
    setState(() => _summaryLoading = true);
    final dio = ref.read(apiClientProvider);
    try {
      await dio.post('/chat/conversations/${widget.conversationId}/summary');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Сводка создана'),
            backgroundColor: GodTheme.success,
            duration: Duration(seconds: 2),
          ),
        );
        // Refresh messages to show the summary
        ref.read(messagesProvider.notifier).loadMessages(widget.conversationId);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ошибка создания сводки: $e'),
            backgroundColor: GodTheme.error,
            duration: const Duration(seconds: 3),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _summaryLoading = false);
    }
  }

  /// Start audio call via LiveKit.
  /// [withRecording] - true = call with logging/recording (default), false = silent call.
  Future<void> _handleStartCall(BuildContext context, String title, List<Participant> participants, {bool withRecording = true}) async {
    final callNotifier = ref.read(callProvider.notifier);
    final currentCall = ref.read(callProvider);

    if (currentCall.state == CallState.connected || currentCall.state == CallState.connecting) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Звонок уже активен'),
          backgroundColor: GodTheme.warning,
        ),
      );
      return;
    }

    // Start call with or without recording
    callNotifier.startCall(widget.conversationId, withRecording: withRecording);

    // Open call screen
    if (mounted) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CallScreen(
            conversationId: widget.conversationId,
            title: title,
            participantNames: participants.map((p) => p.name).toList(),
            withRecording: withRecording,
          ),
        ),
      );
    }
  }

  /// Show rename dialog for the conversation title.
  void _showRenameDialog(BuildContext context, WidgetRef ref, String currentTitle) {
    final controller = TextEditingController(text: currentTitle);

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: GodTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Rename Conversation', style: TextStyle(color: GodTheme.textPrimary)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(color: GodTheme.textPrimary),
          decoration: InputDecoration(
            hintText: 'Enter new name',
            hintStyle: const TextStyle(color: GodTheme.textMuted),
            filled: true,
            fillColor: GodTheme.surfaceLight,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: GodTheme.border),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: GodTheme.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: GodTheme.primary, width: 2),
            ),
          ),
          onSubmitted: (value) async {
            if (value.trim().isNotEmpty && value.trim() != currentTitle) {
              Navigator.pop(ctx);
              final error = await ref
                  .read(conversationsProvider.notifier)
                  .rename(widget.conversationId, value.trim());
              if (error == null) {
                ref.invalidate(conversationDetailProvider(widget.conversationId));
              } else if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Rename failed: $error'),
                    backgroundColor: GodTheme.error,
                    duration: const Duration(seconds: 5),
                  ),
                );
              }
            }
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: GodTheme.textMuted)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: GodTheme.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () async {
              final value = controller.text.trim();
              if (value.isNotEmpty && value != currentTitle) {
                Navigator.pop(ctx);
                final error = await ref
                    .read(conversationsProvider.notifier)
                    .rename(widget.conversationId, value);
                if (error == null) {
                  ref.invalidate(conversationDetailProvider(widget.conversationId));
                } else if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Rename failed: $error'),
                      backgroundColor: GodTheme.error,
                      duration: const Duration(seconds: 5),
                    ),
                  );
                }
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  /// Show participants bottom sheet.
  void _showParticipantsSheet(List<Participant> participants) {
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
              Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: GodTheme.textMuted.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    const Icon(Icons.group, color: GodTheme.textPrimary, size: 20),
                    const SizedBox(width: 8),
                    Text(
                      'Participants (${participants.length})',
                      style: const TextStyle(
                        color: GodTheme.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(color: GodTheme.border),
              ...participants.map((p) => ListTile(
                leading: CircleAvatar(
                  radius: 18,
                  backgroundColor: GodTheme.primary.withOpacity(0.15),
                  child: Text(
                    _getInitials(p.name),
                    style: const TextStyle(
                      color: GodTheme.primary,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                ),
                title: Text(
                  p.name,
                  style: const TextStyle(color: GodTheme.textPrimary, fontSize: 14),
                ),
                subtitle: p.email != null
                    ? Text(
                        p.email!,
                        style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                      )
                    : null,
                trailing: Text(
                  p.role,
                  style: const TextStyle(color: GodTheme.textMuted, fontSize: 11),
                ),
              )),
              const Divider(color: GodTheme.border),
              ListTile(
                leading: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: GodTheme.success.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: const Icon(Icons.person_add, color: GodTheme.success, size: 18),
                ),
                title: const Text(
                  'Add Participant',
                  style: TextStyle(color: GodTheme.success, fontWeight: FontWeight.w600),
                ),
                onTap: () {
                  Navigator.pop(ctx);
                  _showAddParticipantPicker(participants);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Show contacts picker to add a new participant.
  void _showAddParticipantPicker(List<Participant> existingParticipants) {
    final existingIds = existingParticipants.map((p) => p.id).toSet();

    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (ctx, scrollController) {
          return Consumer(
            builder: (ctx, ref, _) {
              final contactsAsync = ref.watch(contactsProvider);

              return Column(
                children: [
                  Container(
                    width: 36,
                    height: 4,
                    margin: const EdgeInsets.only(top: 12, bottom: 8),
                    decoration: BoxDecoration(
                      color: GodTheme.textMuted.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      children: [
                        Icon(Icons.person_add, color: GodTheme.textPrimary, size: 20),
                        SizedBox(width: 8),
                        Text(
                          'Add Participant',
                          style: TextStyle(
                            color: GodTheme.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(color: GodTheme.border),
                  Expanded(
                    child: contactsAsync.when(
                      loading: () => const Center(child: CircularProgressIndicator()),
                      error: (err, _) => Center(
                        child: Text('Error: $err', style: const TextStyle(color: GodTheme.error)),
                      ),
                      data: (contacts) {
                        final available = contacts
                            .where((c) => !existingIds.contains(c.id))
                            .toList();

                        if (available.isEmpty) {
                          return const Center(
                            child: Padding(
                              padding: EdgeInsets.all(24),
                              child: Text(
                                'All contacts are already participants',
                                style: TextStyle(color: GodTheme.textMuted),
                              ),
                            ),
                          );
                        }

                        return ListView.builder(
                          controller: scrollController,
                          itemCount: available.length,
                          itemBuilder: (ctx, index) {
                            final contact = available[index];
                            return ListTile(
                              key: ValueKey('contact_${contact.id}'),
                              leading: CircleAvatar(
                                radius: 18,
                                backgroundColor: GodTheme.accent.withOpacity(0.15),
                                child: Text(
                                  contact.initials,
                                  style: const TextStyle(
                                    color: GodTheme.accent,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                              title: Text(
                                contact.name,
                                style: const TextStyle(color: GodTheme.textPrimary, fontSize: 14),
                              ),
                              subtitle: contact.email != null
                                  ? Text(
                                      contact.email!,
                                      style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                                    )
                                  : null,
                              trailing: const Icon(Icons.add_circle_outline, color: GodTheme.success),
                              onTap: () async {
                                Navigator.pop(ctx);
                                await _addParticipant(contact);
                              },
                            );
                          },
                        );
                      },
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  /// Add a participant to the current conversation.
  Future<void> _addParticipant(Contact contact) async {
    final repo = ref.read(chatRepositoryProvider);
    final result = await repo.addParticipant(widget.conversationId, contact.id);

    if (result.isSuccess && mounted) {
      ref.invalidate(conversationDetailProvider(widget.conversationId));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${contact.name} added to conversation'),
          backgroundColor: GodTheme.success,
          duration: const Duration(seconds: 2),
        ),
      );
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to add participant: ${result.error ?? "Unknown error"}'),
          backgroundColor: GodTheme.error,
          duration: const Duration(seconds: 3),
        ),
      );
    }
  }

  String _getInitials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }

  /// Build stacked participant avatars for the AppBar.
  Widget _buildParticipantAvatars(List<Participant> participants) {
    if (participants.isEmpty) return const SizedBox.shrink();

    final maxShow = 3;
    final shown = participants.take(maxShow).toList();
    final extra = participants.length - maxShow;

    return SizedBox(
      width: (shown.length * 18.0) + 8,
      height: 28,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          for (int i = 0; i < shown.length; i++)
            Positioned(
              left: i * 14.0,
              child: Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: GodTheme.primary.withOpacity(0.2),
                  shape: BoxShape.circle,
                  border: Border.all(color: GodTheme.surface, width: 1.5),
                ),
                child: Center(
                  child: Text(
                    _getInitials(shown[i].name),
                    style: const TextStyle(
                      color: GodTheme.primary,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          if (extra > 0)
            Positioned(
              left: shown.length * 14.0,
              child: Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: GodTheme.surfaceLight,
                  shape: BoxShape.circle,
                  border: Border.all(color: GodTheme.surface, width: 1.5),
                ),
                child: Center(
                  child: Text(
                    '+$extra',
                    style: const TextStyle(
                      color: GodTheme.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// Build display messages with real-time streaming support.
  /// Completed responses: thinking + tools are grouped into the assistant message.
  /// In-progress: orphan thinking/tools shown as live streaming block.
  List<_DisplayMessage> _buildDisplayMessages(List<Message> allMessages) {
    final display = <_DisplayMessage>[];
    int pendingToolSteps = 0;
    final pendingThinking = <Message>[];

    for (final msg in allMessages) {
      // Collect thinking messages (reasoning chains)
      if (msg.contentType == 'thinking' && msg.content.trim().isNotEmpty) {
        pendingThinking.add(msg);
        continue;
      }

      // Count tool steps silently
      if (msg.isToolStep) {
        if (msg.contentType == 'tool_call') {
          pendingToolSteps++;
        }
        continue;
      }

      // This is a visible message
      if (msg.isHumanVisible) {
        int toolCount = 0;
        List<Message> thinkingChain = [];

        if (msg.isAssistant) {
          // Attach accumulated thinking and tools to this assistant message
          if (pendingThinking.isNotEmpty) {
            thinkingChain = List.from(pendingThinking);
            pendingThinking.clear();
          }
          if (pendingToolSteps > 0) {
            toolCount = pendingToolSteps;
            pendingToolSteps = 0;
          }
        }

        // Also check toolResults on the message itself
        if (msg.toolResults != null && msg.toolResults!.isNotEmpty) {
          toolCount = msg.toolResults!.length;
        }

        display.add(_DisplayMessage(
          message: msg,
          toolStepCount: toolCount,
          thinkingChain: thinkingChain,
        ));
      }
    }

    // STREAMING: If there are orphan thinking/tool messages at the end
    // (AI is still processing), show them as a live streaming block
    if (pendingThinking.isNotEmpty || pendingToolSteps > 0) {
      display.add(_DisplayMessage(
        message: Message(
          id: -999,
          conversationId: 0,
          role: 'assistant',
          content: '',
          createdAt: DateTime.now().toIso8601String(),
        ),
        toolStepCount: pendingToolSteps,
        thinkingChain: List.from(pendingThinking),
        isStreaming: true,
      ));
    }

    return display;
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(messagesProvider);
    final detailAsync = ref.watch(conversationDetailProvider(widget.conversationId));
    final notifier = ref.watch(messagesProvider.notifier);
    final isPolling = notifier.isPolling;

    final title = detailAsync.whenOrNull(
      data: (detail) => detail?.conversation.title,
    ) ?? 'Chat';

    final participants = detailAsync.whenOrNull(
      data: (detail) => detail?.conversation.participants,
    ) ?? [];

    var conversation = detailAsync.whenOrNull(
      data: (detail) => detail?.conversation,
    );

    // Detail endpoint may not include bound_row_title/bound_table_name (only listing does).
    // Fallback: enrich from conversations list which has the JOINed fields.
    if (conversation != null && conversation.boundRowId != null && conversation.boundRowTitle == null) {
      final convList = ref.watch(conversationsProvider).valueOrNull ?? [];
      final fromList = convList.where((c) => c.id == conversation!.id).firstOrNull;
      if (fromList != null && fromList.boundRowTitle != null) {
        conversation = Conversation(
          id: conversation.id,
          title: conversation.title,
          lastMessage: conversation.lastMessage,
          lastMessageAt: conversation.lastMessageAt,
          messageCount: conversation.messageCount,
          unreadCount: conversation.unreadCount,
          createdAt: conversation.createdAt,
          participants: conversation.participants,
          boundTableId: conversation.boundTableId,
          boundRowId: conversation.boundRowId,
          boundRowTitle: fromList.boundRowTitle,
          boundTableName: fromList.boundTableName,
          boundTableIcon: fromList.boundTableIcon,
        );
      }
    }

    // Auto-scroll ONLY when user is near bottom and new messages arrive
    ref.listen<AsyncValue<List<Message>>>(messagesProvider, (prev, next) {
      final prevCount = prev?.valueOrNull?.length ?? 0;
      final nextCount = next.valueOrNull?.length ?? 0;
      if (nextCount > prevCount && _isNearBottom) {
        _scrollToBottom();
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onTap: () => _showRenameDialog(context, ref, title),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (participants.isNotEmpty) ...[
                _buildParticipantAvatars(participants),
                const SizedBox(width: 6),
              ],
              Flexible(
                child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
              const SizedBox(width: 6),
              const Icon(Icons.edit_outlined, size: 16, color: GodTheme.textMuted),
            ],
          ),
        ),
      ),
      body: Column(
        children: [
          // Toolbar strip below title
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: const BoxDecoration(
              color: GodTheme.surface,
              border: Border(bottom: BorderSide(color: GodTheme.border, width: 0.5)),
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  // Call button — prominent, green, first position
                  GestureDetector(
                    onTap: () => _handleStartCall(context, title, participants, withRecording: true),
                    onLongPress: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Звонок без записи'),
                          backgroundColor: GodTheme.warning,
                          duration: Duration(seconds: 1),
                        ),
                      );
                      _handleStartCall(context, title, participants, withRecording: false);
                    },
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.phone, size: 16, color: Colors.white),
                          SizedBox(width: 6),
                          Text('Звонок', style: TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          )),
                        ],
                      ),
                    ),
                  ),
                  _ToolbarBtn(
                    icon: Icons.summarize_outlined,
                    label: 'Суммари',
                    loading: _summaryLoading,
                    onTap: _summaryLoading ? null : _handleSummary,
                  ),
                  _ToolbarBtn(
                    icon: Icons.group_outlined,
                    label: 'Контакты',
                    onTap: participants.isNotEmpty
                        ? () => _showParticipantsSheet(participants)
                        : null,
                  ),
                  _ToolbarBtn(
                    icon: Icons.refresh,
                    label: 'Обновить',
                    onTap: () => ref.read(messagesProvider.notifier).loadMessages(widget.conversationId),
                  ),
                  _ToolbarBtn(
                    icon: Icons.link_rounded,
                    label: 'Привязать',
                    onTap: _handleLinkRowToChat,
                  ),
                  _ToolbarBtn(
                    icon: _searchActive ? Icons.search_off : Icons.search,
                    label: 'Поиск',
                    active: _searchActive,
                    onTap: () {
                      setState(() {
                        _searchActive = !_searchActive;
                        if (!_searchActive) {
                          _searchQuery = '';
                          _searchController.clear();
                        }
                      });
                    },
                  ),
                ],
              ),
            ),
          ),
          // Search bar
          if (_searchActive)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: const BoxDecoration(
                color: GodTheme.surfaceLight,
                border: Border(bottom: BorderSide(color: GodTheme.border, width: 0.5)),
              ),
              child: TextField(
                controller: _searchController,
                autofocus: true,
                style: const TextStyle(color: GodTheme.textPrimary, fontSize: 14),
                decoration: InputDecoration(
                  hintText: 'Поиск по сообщениям...',
                  hintStyle: const TextStyle(color: GodTheme.textMuted, fontSize: 14),
                  prefixIcon: const Icon(Icons.search, size: 18, color: GodTheme.textMuted),
                  suffixIcon: _searchQuery.isNotEmpty
                      ? GestureDetector(
                          onTap: () {
                            _searchController.clear();
                            setState(() => _searchQuery = '');
                          },
                          child: const Icon(Icons.close, size: 18, color: GodTheme.textMuted),
                        )
                      : null,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  filled: true,
                  fillColor: GodTheme.surface,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: GodTheme.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: GodTheme.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide: const BorderSide(color: GodTheme.primary, width: 1.5),
                  ),
                ),
                onChanged: (val) => setState(() => _searchQuery = val.toLowerCase()),
              ),
            ),
          // Bound row strip
          if (conversation?.boundRowId != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF3B82F6).withOpacity(0.1),
                border: const Border(
                  bottom: BorderSide(color: Color(0xFF3B82F6), width: 0.5),
                ),
              ),
              child: Row(
                children: [
                  const Icon(Icons.link, size: 14, color: Color(0xFF60A5FA)),
                  const SizedBox(width: 6),
                  if (conversation!.boundTableIcon != null) ...[
                    Text(conversation.boundTableIcon!, style: const TextStyle(fontSize: 12)),
                    const SizedBox(width: 4),
                  ],
                  Expanded(
                    child: Text(
                      '${conversation.boundTableName != null ? '${conversation.boundTableName}: ' : ''}'
                      '${conversation.boundRowTitle ?? '#${conversation.boundRowId}'}',
                      style: const TextStyle(
                        color: Color(0xFF60A5FA),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          // Error banner
          if (_sendError != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: GodTheme.error.withOpacity(0.1),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, size: 16, color: GodTheme.error),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _sendError!,
                      style: const TextStyle(color: GodTheme.error, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  GestureDetector(
                    onTap: () => setState(() => _sendError = null),
                    child: const Icon(Icons.close, size: 16, color: GodTheme.error),
                  ),
                ],
              ),
            ),

          // Messages list
          Expanded(
            child: messagesAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (err, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48, color: GodTheme.error),
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Text(
                        err.toString(),
                        style: const TextStyle(color: GodTheme.error),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextButton.icon(
                      onPressed: () => ref.read(messagesProvider.notifier)
                          .loadMessages(widget.conversationId),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (messages) {
                var displayMessages = _buildDisplayMessages(messages);

                // Filter by search query
                if (_searchQuery.isNotEmpty) {
                  displayMessages = displayMessages.where((dm) {
                    final content = dm.message.content.toLowerCase();
                    final agent = (dm.message.agentName ?? '').toLowerCase();
                    return content.contains(_searchQuery) || agent.contains(_searchQuery);
                  }).toList();
                }

                if (displayMessages.isEmpty && !isPolling) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 64,
                          height: 64,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: GodTheme.primary.withOpacity(0.1),
                          ),
                          child: Icon(
                            Icons.chat_bubble_outline,
                            size: 28,
                            color: GodTheme.primary.withOpacity(0.5),
                          ),
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'Start the conversation',
                          style: TextStyle(
                            color: GodTheme.textPrimary,
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Use @ to mention agents or people',
                          style: TextStyle(color: GodTheme.textMuted, fontSize: 14),
                        ),
                      ],
                    ),
                  );
                }

                // Only auto-scroll to bottom on initial load, not on every rebuild
                if (!_initialScrollDone) {
                  _initialScrollDone = true;
                  WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
                }

                final hasMoreMessages = notifier.hasMore;
                final isLoadingMore = notifier.isLoadingMore;
                final extraTop = (hasMoreMessages || isLoadingMore) ? 1 : 0;
                final extraBottom = (isPolling && !displayMessages.any((d) => d.isStreaming)) ? 1 : 0;

                return ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.only(left: 12, right: 12, top: 8, bottom: 2),
                  itemCount: extraTop + displayMessages.length + extraBottom,
                  itemBuilder: (context, index) {
                    // "Load more" indicator at the top
                    if (index < extraTop) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Center(
                          child: isLoadingMore
                              ? SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: GodTheme.primary.withOpacity(0.6),
                                  ),
                                )
                              : GestureDetector(
                                  onTap: () => ref.read(messagesProvider.notifier)
                                      .loadOlderMessages(widget.conversationId),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                    decoration: BoxDecoration(
                                      color: GodTheme.surfaceLight,
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(color: GodTheme.border),
                                    ),
                                    child: const Text(
                                      'Load earlier messages',
                                      style: TextStyle(color: GodTheme.textMuted, fontSize: 13),
                                    ),
                                  ),
                                ),
                        ),
                      );
                    }

                    final msgIndex = index - extraTop;

                    // Show "AI is thinking" at the bottom when polling but no streaming content yet
                    if (msgIndex >= displayMessages.length) {
                      return _SimpleThinkingIndicator(
                        key: const ValueKey('thinking_indicator'),
                        agentName: notifier.processingAgentName,
                      );
                    }

                    final dm = displayMessages[msgIndex];

                    // Streaming reasoning block — live display of thinking/tools
                    if (dm.isStreaming) {
                      return _StreamingReasoningBlock(
                        key: const ValueKey('streaming_reasoning'),
                        thinkingChain: dm.thinkingChain,
                        toolStepCount: dm.toolStepCount,
                        agentName: notifier.processingAgentName,
                      );
                    }

                    final prevMsg = msgIndex > 0 ? displayMessages[msgIndex - 1].message : null;
                    final showAvatar = prevMsg == null || prevMsg.role != dm.message.role;

                    return MessageBubble(
                      key: ValueKey('msg_${dm.message.id}'),
                      message: dm.message,
                      showAvatar: showAvatar,
                      toolStepCount: dm.toolStepCount,
                      thinkingChain: dm.thinkingChain,
                      baseUrl: getCurrentBaseUrl(),
                      onForward: _handleForward,
                      onReact: _handleReact,
                      reactions: _reactions,
                    );
                  },
                );
              },
            ),
          ),

          // Scheduled messages bar
          Builder(
            builder: (context) {
              final scheduled = ref.watch(scheduledMessagesProvider(widget.conversationId));
              final items = scheduled.valueOrNull ?? [];
              if (items.isEmpty) return const SizedBox.shrink();
              return ScheduledMessagesBar(
                messages: items,
                onSendNow: _handleSendScheduledNow,
                onEdit: _handleEditScheduled,
                onCancel: _handleCancelScheduled,
              );
            },
          ),

          // Forward card — shown when user taps forward on a message
          if (_forwardingMessage != null)
            _ForwardCard(
              message: _forwardingMessage!,
              targetConversation: _forwardTargetConversation,
              sourceConversationId: widget.conversationId,
              onPickTarget: _pickForwardTarget,
              onSend: _executeForward,
              onCancel: _cancelForward,
            ),

          // Schedule date picker (shown when tapping schedule button)
          if (_showSchedulePicker)
            ScheduleDatePicker(
              onSchedule: _handleSchedule,
              onCancel: () => setState(() => _showSchedulePicker = false),
            ),

          // Chat input with file attachment support, @mentions, link, and mic
          Builder(
            builder: (context) {
              final mentionableUsers = ref.watch(mentionableUsersProvider).valueOrNull ?? [];
              return ChatInput(
                key: _chatInputKey,
                onSend: _handleSend,
                enabled: !_sending,
                users: mentionableUsers,
                onLinkRow: _handleLinkRowToMessage,
                onSchedule: _toggleSchedulePicker,
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Internal display message with computed tool step count and thinking chain.
class _DisplayMessage {
  final Message message;
  final int toolStepCount;
  final List<Message> thinkingChain;
  final bool isStreaming;

  const _DisplayMessage({
    required this.message,
    this.toolStepCount = 0,
    this.thinkingChain = const [],
    this.isStreaming = false,
  });
}

/// Simple "AI is thinking..." indicator when no streaming content yet.
class _SimpleThinkingIndicator extends StatelessWidget {
  final String? agentName;

  const _SimpleThinkingIndicator({super.key, this.agentName});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: GodTheme.primary.withOpacity(0.6),
            ),
          ),
          const SizedBox(width: 10),
          Text(
            agentName != null
                ? '@$agentName is thinking...'
                : 'AI is thinking...',
            style: const TextStyle(color: GodTheme.textMuted, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

/// Live streaming reasoning block — shows thinking/tool steps in real-time.
/// Displayed when the AI agent is still processing (orphan thinking messages).
class _StreamingReasoningBlock extends StatefulWidget {
  final List<Message> thinkingChain;
  final int toolStepCount;
  final String? agentName;

  const _StreamingReasoningBlock({
    super.key,
    required this.thinkingChain,
    this.toolStepCount = 0,
    this.agentName,
  });

  @override
  State<_StreamingReasoningBlock> createState() => _StreamingReasoningBlockState();
}

class _StreamingReasoningBlockState extends State<_StreamingReasoningBlock>
    with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Combine all thinking content
    final allThinkingText = widget.thinkingChain
        .map((m) => m.content.trim())
        .where((c) => c.isNotEmpty)
        .join('\n\n');

    // Show last 300 chars for live preview
    final preview = allThinkingText.length > 300
        ? allThinkingText.substring(allThinkingText.length - 300)
        : allThinkingText;

    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 2, right: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Animated pulsing avatar
          AnimatedBuilder(
            animation: _pulseController,
            builder: (context, child) {
              return Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [
                      Color.lerp(
                        const Color(0xFF8B5CF6),
                        const Color(0xFF6366F1),
                        _pulseController.value,
                      )!,
                      Color.lerp(
                        const Color(0xFF6366F1),
                        const Color(0xFF8B5CF6),
                        _pulseController.value,
                      )!,
                    ],
                  ),
                ),
                child: const Center(
                  child: Icon(Icons.psychology, size: 16, color: Colors.white),
                ),
              );
            },
          ),
          const SizedBox(width: 8),

          // Streaming content
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A2E),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(18),
                  topRight: Radius.circular(18),
                  bottomRight: Radius.circular(18),
                  bottomLeft: Radius.circular(4),
                ),
                border: Border.all(
                  color: const Color(0xFF8B5CF6).withOpacity(0.3),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header with pulsing icon
                  Row(
                    children: [
                      AnimatedBuilder(
                        animation: _pulseController,
                        builder: (context, _) {
                          return Icon(
                            Icons.psychology,
                            size: 14,
                            color: Color.lerp(
                              const Color(0xFF8B5CF6),
                              const Color(0xFFa78bfa),
                              _pulseController.value,
                            ),
                          );
                        },
                      ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          widget.agentName != null
                              ? '@${widget.agentName} reasoning...'
                              : 'Reasoning...',
                          style: const TextStyle(
                            color: Color(0xFF8B5CF6),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      if (widget.thinkingChain.isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Text(
                          '${widget.thinkingChain.length} step${widget.thinkingChain.length != 1 ? "s" : ""}',
                          style: TextStyle(
                            color: const Color(0xFF8B5CF6).withOpacity(0.6),
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ],
                  ),

                  // Tool steps count
                  if (widget.toolStepCount > 0) ...[
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: GodTheme.background,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.build_outlined, size: 12, color: GodTheme.textMuted),
                          const SizedBox(width: 4),
                          Text(
                            'Used ${widget.toolStepCount} tool${widget.toolStepCount != 1 ? "s" : ""}',
                            style: const TextStyle(
                              color: GodTheme.textMuted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],

                  // Live thinking text preview (auto-scrolls to bottom)
                  if (preview.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(8),
                      constraints: const BoxConstraints(maxHeight: 150),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0F0F1A),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: const Color(0xFF8B5CF6).withOpacity(0.1),
                        ),
                      ),
                      child: SingleChildScrollView(
                        reverse: true, // Auto-scroll to latest content
                        child: Text(
                          preview,
                          style: TextStyle(
                            color: GodTheme.textSecondary.withOpacity(0.7),
                            fontSize: 11,
                            height: 1.4,
                            fontFamily: 'monospace',
                            fontStyle: FontStyle.italic,
                          ),
                        ),
                      ),
                    ),
                  ],

                  // Typing indicator dots
                  const SizedBox(height: 8),
                  const _TypingDots(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Animated typing dots indicator.
class _TypingDots extends StatefulWidget {
  const _TypingDots();

  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots> with TickerProviderStateMixin {
  late List<AnimationController> _controllers;

  @override
  void initState() {
    super.initState();
    _controllers = List.generate(3, (index) {
      return AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 600),
      );
    });

    // Stagger the animations
    for (int i = 0; i < _controllers.length; i++) {
      Future.delayed(Duration(milliseconds: i * 200), () {
        if (mounted) _controllers[i].repeat(reverse: true);
      });
    }
  }

  @override
  void dispose() {
    for (final c in _controllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(3, (index) {
        return AnimatedBuilder(
          animation: _controllers[index],
          builder: (context, _) {
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Color.lerp(
                  const Color(0xFF8B5CF6).withOpacity(0.3),
                  const Color(0xFF8B5CF6),
                  _controllers[index].value,
                ),
              ),
            );
          },
        );
      }),
    );
  }
}

/// Forward card — shows forwarded message preview above input with target chat selector.
class _ForwardCard extends StatelessWidget {
  final Message message;
  final Conversation? targetConversation;
  final int sourceConversationId;
  final VoidCallback onPickTarget;
  final VoidCallback onSend;
  final VoidCallback onCancel;

  const _ForwardCard({
    required this.message,
    required this.targetConversation,
    required this.sourceConversationId,
    required this.onPickTarget,
    required this.onSend,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    final senderLabel = message.agentName ?? (message.isUser ? 'Вы' : 'Ассистент');
    final preview = message.content.length > 120
        ? '${message.content.substring(0, 120)}...'
        : message.content;

    return Container(
      decoration: BoxDecoration(
        color: GodTheme.surface,
        border: Border(
          top: BorderSide(color: const Color(0xFF8B5CF6).withOpacity(0.4), width: 1),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: forward icon + label + close
          Row(
            children: [
              const Icon(Icons.forward, size: 16, color: Color(0xFF8B5CF6)),
              const SizedBox(width: 6),
              const Expanded(
                child: Text('Пересылка сообщения',
                  style: TextStyle(color: Color(0xFF8B5CF6), fontSize: 12, fontWeight: FontWeight.w600)),
              ),
              GestureDetector(
                onTap: onCancel,
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(Icons.close, size: 16, color: GodTheme.textMuted),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // Message preview
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: const Color(0xFF8B5CF6).withOpacity(0.06),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFF8B5CF6).withOpacity(0.15)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(senderLabel,
                  style: const TextStyle(color: Color(0xFF8B5CF6), fontSize: 11, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(preview,
                  style: const TextStyle(color: GodTheme.textSecondary, fontSize: 12),
                  maxLines: 3, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          const SizedBox(height: 6),
          // Target chat selector + send button
          Row(
            children: [
              Expanded(
                child: GestureDetector(
                  onTap: onPickTarget,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: GodTheme.surfaceLight,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: GodTheme.border),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          targetConversation != null ? Icons.chat : Icons.chat_bubble_outline,
                          size: 14,
                          color: targetConversation != null ? GodTheme.primary : GodTheme.textMuted,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            targetConversation?.title ?? 'Выберите чат...',
                            style: TextStyle(
                              color: targetConversation != null ? GodTheme.textPrimary : GodTheme.textMuted,
                              fontSize: 13,
                            ),
                            maxLines: 1, overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const Icon(Icons.keyboard_arrow_down, size: 16, color: GodTheme.textMuted),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // Send forward button
              GestureDetector(
                onTap: targetConversation != null ? onSend : null,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: targetConversation != null
                        ? const Color(0xFF8B5CF6)
                        : GodTheme.textMuted.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.send, size: 14,
                        color: targetConversation != null ? Colors.white : GodTheme.textMuted),
                      const SizedBox(width: 4),
                      Text('Переслать',
                        style: TextStyle(
                          color: targetConversation != null ? Colors.white : GodTheme.textMuted,
                          fontSize: 12, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Compact toolbar button with icon and label for the chat toolbar strip.
class _ToolbarBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool active;
  final bool loading;

  const _ToolbarBtn({
    required this.icon,
    required this.label,
    this.onTap,
    this.onLongPress,
    this.active = false,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final color = active
        ? GodTheme.primary
        : enabled
            ? GodTheme.textSecondary
            : GodTheme.textMuted.withOpacity(0.4);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(8),
          decoration: active
              ? BoxDecoration(
                  color: GodTheme.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                )
              : null,
          child: loading
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    color: color,
                  ),
                )
              : Tooltip(
                  message: label,
                  child: Icon(icon, size: 20, color: color),
                ),
        ),
      ),
    );
  }
}
