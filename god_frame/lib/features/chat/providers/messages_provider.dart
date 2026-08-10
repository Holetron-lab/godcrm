import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/chat_repository.dart';
import '../data/models.dart';
import '../ui/chat_input.dart';
import 'conversations_provider.dart';

/// Active conversation ID.
final activeConversationIdProvider = StateProvider<int?>((ref) => null);

/// Messages for the active conversation.
final messagesProvider =
    StateNotifierProvider<MessagesNotifier, AsyncValue<List<Message>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  return MessagesNotifier(repo);
});

/// Last error message for UI display.
final lastChatErrorProvider = StateProvider<String?>((ref) => null);

class MessagesNotifier extends StateNotifier<AsyncValue<List<Message>>> {
  final ChatRepository _repo;

  MessagesNotifier(this._repo) : super(const AsyncValue.data([]));

  String? lastError;
  Timer? _pollTimer;
  Timer? _bgPollTimer; // Background poll for new messages from others
  int _pollAttempts = 0;
  bool _isProcessing = false;
  String? _processingAgentName;
  int _doneCountdown = 0; // Extra polls after processing completes
  int? _activeConversationId; // Track which conversation we're watching — used to guard polls

  // Pagination state for loading older messages
  bool _hasMore = false;
  int? _nextCursor;
  bool _isLoadingMore = false;

  /// Whether there are older messages to load (for scroll-to-top pagination).
  bool get hasMore => _hasMore;

  /// Whether we're currently loading older messages.
  bool get isLoadingMore => _isLoadingMore;

  // Streaming poll: 1s interval, up to 10 minutes (increased for long agent runs)
  static const int _maxPollAttempts = 600;
  static const Duration _pollInterval = Duration(seconds: 1);
  // Background poll: check for new messages every 2 seconds (faster updates)
  static const Duration _bgPollInterval = Duration(seconds: 2);

  /// Load messages for a conversation.
  Future<void> loadMessages(int conversationId) async {
    state = const AsyncValue.loading();
    _activeConversationId = conversationId;
    _hasMore = false;
    _nextCursor = null;
    try {
      final result = await _repo.getConversation(conversationId);
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!.messages);
        _hasMore = result.data!.hasMore;
        _nextCursor = result.data!.nextCursor;
        lastError = null;
      } else {
        final errMsg = result.error ?? 'Failed to load messages';
        lastError = errMsg;
        state = AsyncValue.error(errMsg, StackTrace.current);
      }
    } catch (e) {
      lastError = 'Error loading messages: ${e.toString()}';
      state = AsyncValue.error(lastError!, StackTrace.current);
    }
  }

  /// Load older messages (scroll-to-top pagination).
  /// Prepends older messages to the beginning of the list.
  Future<void> loadOlderMessages(int conversationId) async {
    if (_isLoadingMore || !_hasMore) return;
    _isLoadingMore = true;

    try {
      final currentMessages = state.valueOrNull ?? [];
      // Use nextCursor or the earliest message ID as the "before" cursor
      final beforeId = _nextCursor ?? (currentMessages.isNotEmpty ? currentMessages.first.id : null);
      if (beforeId == null || beforeId <= 0) {
        _isLoadingMore = false;
        return;
      }

      final result = await _repo.getConversationBefore(conversationId, beforeId);
      if (result.isSuccess && result.data != null && mounted) {
        final olderMessages = result.data!.messages;
        if (olderMessages.isNotEmpty) {
          // Deduplicate by ID and prepend older messages
          final existingIds = currentMessages.where((m) => m.id > 0).map((m) => m.id).toSet();
          final unique = olderMessages.where((m) => m.id <= 0 || !existingIds.contains(m.id)).toList();
          state = AsyncValue.data([...unique, ...currentMessages]);
        }
        _hasMore = result.data!.hasMore;
        _nextCursor = result.data!.nextCursor;
      }
    } catch (e) {
      print('[Messages] Error loading older messages: $e');
    }
    _isLoadingMore = false;
  }

  /// Start background polling — checks for new messages every 2 seconds.
  /// Automatically switches to fast 1s polling when agent is processing.
  /// IMPORTANT: Call this AFTER loadMessages() has completed to avoid race conditions.
  void startBackgroundPoll(int conversationId) {
    _activeConversationId = conversationId;
    _stopBackgroundPoll(); // Cancel any existing background poll

    _bgPollTimer = Timer.periodic(_bgPollInterval, (timer) async {
      if (!mounted) {
        _stopBackgroundPoll();
        return;
      }

      // Guard: ignore poll results for a different conversation
      // This prevents cross-contamination when switching conversations
      if (_activeConversationId != conversationId) {
        _stopBackgroundPoll();
        return;
      }

      // Skip if fast streaming poll is already running
      if (_pollTimer != null) return;

      try {
        final currentMessages = state.valueOrNull ?? [];
        final lastId = _getLastPositiveId(currentMessages);

        final result = await _repo.getNewMessages(
          conversationId,
          afterId: lastId,
        );

        // Re-check conversation ID after async gap (user may have navigated away)
        if (_activeConversationId != conversationId || !mounted) return;

        if (result.isSuccess && result.data != null) {
          final pollResult = result.data!;

          // If agent started processing, switch to fast streaming poll
          if (pollResult.isProcessing) {
            _isProcessing = true;
            _processingAgentName = pollResult.processingAgentName;

            // Append any new messages first
            if (pollResult.messages.isNotEmpty && mounted) {
              final updated = [...currentMessages, ...pollResult.messages];
              state = AsyncValue.data(updated);
            }

            // Start fast polling — background poll will skip while it runs
            _startStreamingPoll(conversationId);
            return;
          }

          // Append new messages (from other users or delayed agent responses)
          if (pollResult.messages.isNotEmpty && mounted) {
            final updated = [...currentMessages, ...pollResult.messages];
            state = AsyncValue.data(updated);
          }
        }
      } catch (_) {
        // Silently continue background polling on error
      }
    });

    // No immediate microtask needed — loadMessages() was already awaited by the caller
    // (conversation_screen.dart), so state already contains the full message list.
    // The first periodic tick (2s) is sufficient for detecting new messages.
    // Previously the immediate microtask caused a race condition where it would
    // read state.valueOrNull as [] (from AsyncValue.loading), send afterId=null,
    // fetch ALL messages, then compete with loadMessages to set state.
  }

  /// Stop background polling. Call when leaving the conversation screen.
  void stopBackgroundPoll() {
    _stopBackgroundPoll();
    _stopPolling();
    _activeConversationId = null;
  }

  void _stopBackgroundPoll() {
    _bgPollTimer?.cancel();
    _bgPollTimer = null;
  }

  /// Get the last positive (server-assigned) message ID from the list.
  int? _getLastPositiveId(List<Message> messages) {
    for (int i = messages.length - 1; i >= 0; i--) {
      if (messages[i].id > 0) return messages[i].id;
    }
    return null;
  }

  /// Check if message content contains @agent or /command triggers.
  /// Used to decide whether to poll for AI response.
  bool _hasAgentTrigger(String content) {
    // Check for structured invocation tokens <<@slug>> or <</slug>>
    if (RegExp(r'<<[@/][a-z0-9_-]+>>', caseSensitive: false).hasMatch(content)) return true;

    // Check for /command (e.g., /claude, /assistant)
    final commandPattern = RegExp(r'(?:^|\s)/([a-z0-9_-]+)', caseSensitive: false);
    if (commandPattern.hasMatch(content)) return true;

    // Check for @mention (e.g., @claude, @assistant)
    final mentionPattern = RegExp(r'(?:^|\s)@([a-z0-9_-]+)', caseSensitive: false);
    if (mentionPattern.hasMatch(content)) return true;

    return false;
  }

  /// Send a message with optional attachments and start streaming poll for AI response.
  Future<bool> sendMessage(
    int conversationId,
    String content, {
    List<PendingAttachment>? attachments,
  }) async {
    // Cancel streaming poll (background poll continues)
    _stopPolling();

    // Build attachment description for optimistic display
    final attachmentNames = attachments?.map((a) => a.name).join(', ') ?? '';
    final displayContent = attachmentNames.isNotEmpty && content.isEmpty
        ? '[Attached: $attachmentNames]'
        : content;

    // Optimistically add user message
    final tempMessage = Message(
      id: -DateTime.now().millisecondsSinceEpoch,
      conversationId: conversationId,
      role: 'user',
      content: displayContent,
      createdAt: DateTime.now().toIso8601String(),
    );
    final current = state.valueOrNull ?? [];
    state = AsyncValue.data([...current, tempMessage]);

    try {
      // Upload attachments first if any
      List<Map<String, dynamic>>? uploadedAttachments;
      if (attachments != null && attachments.isNotEmpty) {
        final filePaths = attachments.map((a) => a.path).toList();
        final uploadResult = await _repo.uploadFiles(filePaths);

        if (uploadResult.isSuccess && uploadResult.data != null) {
          uploadedAttachments = uploadResult.data!;
          print('[Chat] Uploaded ${uploadedAttachments.length} files');
        } else {
          // Upload failed — try sending as multipart instead
          print('[Chat] File upload failed: ${uploadResult.error}, trying multipart...');
          final multipartResult = await _repo.sendMessageWithFiles(
            conversationId,
            content,
            filePaths,
          );

          if (multipartResult.isSuccess) {
            lastError = null;
            // Start streaming poll immediately — always poll for response
            _startStreamingPoll(conversationId);
            return true;
          } else {
            lastError = uploadResult.error ?? 'Failed to upload files';
            state = AsyncValue.data(current);
            return false;
          }
        }
      }

      // Send message to backend
      final result = await _repo.sendMessage(
        conversationId,
        content,
        attachments: uploadedAttachments,
      );

      if (result.isSuccess) {
        lastError = null;

        // DON'T call loadMessages here — it resets state to loading
        // which causes the UI to flash. Instead, replace the optimistic
        // message with the server response and start streaming.
        if (result.data != null && result.data!.id > 0) {
          // Replace optimistic message with server-confirmed message
          final updated = state.valueOrNull ?? [];
          final withServer = updated.map((m) {
            if (m.id == tempMessage.id) return result.data!;
            return m;
          }).toList();
          state = AsyncValue.data(withServer);
        }

        // ALWAYS start streaming poll — catches AI responses, reasoning,
        // thinking messages in real-time without waiting for background poll
        _startStreamingPoll(conversationId);

        return true;
      } else {
        // Remove optimistic message on failure
        lastError = result.error ?? 'Failed to send message';
        state = AsyncValue.data(current);
        return false;
      }
    } catch (e) {
      // Remove optimistic message on crash
      lastError = 'Send error: ${e.toString()}';
      state = AsyncValue.data(current);
      return false;
    }
  }

  /// Start streaming poll — fast 1s incremental polling that shows
  /// thinking/tool messages in real-time as they arrive.
  void _startStreamingPoll(int conversationId) {
    _stopPolling(); // Cancel any existing streaming poll
    _pollAttempts = 0;
    _isProcessing = true;
    _processingAgentName = null;
    _doneCountdown = 0;

    _pollTimer = Timer.periodic(_pollInterval, (timer) async {
      _pollAttempts++;

      if (_pollAttempts > _maxPollAttempts || !mounted) {
        _stopPolling();
        return;
      }

      // Guard: stop if user navigated to a different conversation
      if (_activeConversationId != conversationId) {
        _stopPolling();
        return;
      }

      try {
        // Get the last positive message ID for incremental fetch
        final currentMessages = state.valueOrNull ?? [];
        final lastId = _getLastPositiveId(currentMessages);

        // Use incremental fetch — only gets messages newer than lastId
        final result = await _repo.getNewMessages(
          conversationId,
          afterId: lastId,
        );

        // Re-check after async gap
        if (_activeConversationId != conversationId || !mounted) return;

        if (result.isSuccess && result.data != null) {
          final pollResult = result.data!;

          // Update processing state
          _isProcessing = pollResult.isProcessing;
          _processingAgentName = pollResult.processingAgentName;

          // Append new messages to existing state (deduplicate by ID)
          if (pollResult.messages.isNotEmpty && mounted) {
            final existingIds = currentMessages.where((m) => m.id > 0).map((m) => m.id).toSet();
            final newMessages = pollResult.messages.where((m) => m.id <= 0 || !existingIds.contains(m.id)).toList();
            if (newMessages.isNotEmpty) {
              final updated = [...currentMessages, ...newMessages];
              state = AsyncValue.data(updated);
            }
          }

          // Stop logic: when processing is done and we have the final response
          if (!pollResult.isProcessing) {
            if (_doneCountdown == 0) {
              // Agent stopped processing — poll 10 more times to catch trailing messages
              _doneCountdown = 10;
            } else {
              _doneCountdown--;
              if (_doneCountdown <= 0) {
                _stopPolling();
                // Do a final full refresh to catch any trailing messages
                // Also updates hasMore/nextCursor for pagination
                try {
                  final result = await _repo.getConversation(conversationId);
                  if (result.isSuccess && result.data != null && mounted &&
                      _activeConversationId == conversationId) {
                    state = AsyncValue.data(result.data!.messages);
                    _hasMore = result.data!.hasMore;
                    _nextCursor = result.data!.nextCursor;
                  }
                } catch (_) {}
              }
            }
          } else {
            // Reset countdown if processing resumes
            _doneCountdown = 0;
          }
        }
      } catch (_) {
        // Silently continue polling on error
      }
    });
  }

  /// Stop streaming poll (does NOT stop background poll).
  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _pollAttempts = 0;
    _isProcessing = false;
    _processingAgentName = null;
    _doneCountdown = 0;
  }

  /// Whether we're currently polling for AI response (fast streaming or background).
  bool get isPolling => _pollTimer != null;

  /// Whether background poll is active (conversation screen is open).
  bool get isBackgroundPolling => _bgPollTimer != null;

  /// Whether the AI agent is currently processing.
  bool get isProcessing => _isProcessing;

  /// Name of the agent currently processing.
  String? get processingAgentName => _processingAgentName;

  /// Add a message locally (e.g., from Frame voice mode).
  void addLocalMessage(Message message) {
    final current = state.valueOrNull ?? [];
    state = AsyncValue.data([...current, message]);
  }

  @override
  void dispose() {
    _stopPolling();
    _stopBackgroundPoll();
    super.dispose();
  }
}
