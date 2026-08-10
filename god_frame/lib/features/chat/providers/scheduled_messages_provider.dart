import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/chat_repository.dart';
import '../data/models.dart';
import 'conversations_provider.dart';

/// Provider for scheduled messages of a specific conversation.
/// Auto-refreshes every 30 seconds.
final scheduledMessagesProvider = StateNotifierProvider.family<
    ScheduledMessagesNotifier,
    AsyncValue<List<ScheduledMessage>>,
    int>((ref, conversationId) {
  final repo = ref.watch(chatRepositoryProvider);
  return ScheduledMessagesNotifier(repo, conversationId);
});

class ScheduledMessagesNotifier
    extends StateNotifier<AsyncValue<List<ScheduledMessage>>> {
  final ChatRepository _repo;
  final int _conversationId;
  Timer? _pollTimer;

  ScheduledMessagesNotifier(this._repo, this._conversationId)
      : super(const AsyncValue.data([])) {
    load();
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) => load());
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> load() async {
    final result = await _repo.getScheduledMessages(_conversationId);
    if (!mounted) return;
    if (result.isSuccess) {
      state = AsyncValue.data(result.data!);
    } else if (state is! AsyncData) {
      state = AsyncValue.error(result.error!, StackTrace.current);
    }
  }

  /// Schedule a new message.
  Future<String?> schedule(String content, String scheduledAt) async {
    final result = await _repo.scheduleMessage(
      _conversationId,
      content: content,
      scheduledAt: scheduledAt,
    );
    if (result.isSuccess) {
      await load();
      return null;
    }
    return result.error;
  }

  /// Edit a pending scheduled message.
  Future<String?> edit(int smId, {String? content, String? scheduledAt}) async {
    final result = await _repo.editScheduledMessage(
      smId,
      content: content,
      scheduledAt: scheduledAt,
    );
    if (result.isSuccess) {
      await load();
      return null;
    }
    return result.error;
  }

  /// Cancel a pending scheduled message.
  Future<String?> cancel(int smId) async {
    final result = await _repo.cancelScheduledMessage(smId);
    if (result.isSuccess) {
      await load();
      return null;
    }
    return result.error;
  }

  /// Send a scheduled message immediately.
  Future<String?> sendNow(ScheduledMessage sm) async {
    final result = await _repo.sendScheduledNow(_conversationId, sm);
    if (result.isSuccess) {
      await load();
      return null;
    }
    return result.error;
  }
}
