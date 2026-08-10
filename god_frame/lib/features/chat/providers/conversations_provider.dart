import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../data/chat_repository.dart';
import '../data/models.dart';
import '../../../shared/utils/api_client.dart';

/// Chat repository provider.
final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  final dio = ref.watch(apiClientProvider);
  return ChatRepository(dio);
});

/// Currently selected space ID (null = all spaces).
final selectedSpaceProvider = StateProvider<int?>((ref) => null);

/// Spaces list provider.
final spacesProvider =
    StateNotifierProvider<SpacesNotifier, AsyncValue<List<Space>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  return SpacesNotifier(repo);
});

class SpacesNotifier extends StateNotifier<AsyncValue<List<Space>>> {
  final ChatRepository _repo;

  SpacesNotifier(this._repo) : super(const AsyncValue.loading()) {
    load();
  }

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repo.getSpaces();
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!);
      } else {
        // Show empty list on error — spaces are optional, don't block the UI
        print('[Spaces] Failed to load: ${result.error}');
        state = const AsyncValue.data([]);
      }
    } catch (e) {
      print('[Spaces] Exception: $e');
      state = const AsyncValue.data([]); // Graceful degradation
    }
  }
}

/// Conversations list provider — filters by selected space.
final conversationsProvider =
    StateNotifierProvider<ConversationsNotifier, AsyncValue<List<Conversation>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  final spaceId = ref.watch(selectedSpaceProvider);
  return ConversationsNotifier(repo, spaceId);
});

class ConversationsNotifier extends StateNotifier<AsyncValue<List<Conversation>>> {
  final ChatRepository _repo;
  final int? _spaceId;
  Timer? _autoRefreshTimer;

  // Pagination state
  static const int _pageSize = 200;
  int _currentOffset = 0;
  bool _hasMore = true;
  bool _isLoadingMore = false;

  bool get hasMore => _hasMore;
  bool get isLoadingMore => _isLoadingMore;

  // Client-side unread tracking: conversationId -> last read message count
  static final Map<int, int> _lastReadCounts = {};
  static bool _lastReadLoaded = false;

  ConversationsNotifier(this._repo, this._spaceId) : super(const AsyncValue.loading()) {
    _init();
    // Auto-refresh conversation list every 5 seconds for unread updates
    _autoRefreshTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) _silentRefresh();
    });
  }

  Future<void> _init() async {
    await _loadLastReadCounts();
    await refresh();
  }

  /// Load last read message counts from SharedPreferences.
  Future<void> _loadLastReadCounts() async {
    if (_lastReadLoaded) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final keys = prefs.getKeys().where((k) => k.startsWith('chat_read_'));
      for (final key in keys) {
        final id = int.tryParse(key.replaceFirst('chat_read_', ''));
        if (id != null) {
          _lastReadCounts[id] = prefs.getInt(key) ?? 0;
        }
      }
      _lastReadLoaded = true;
    } catch (_) {
      _lastReadLoaded = true;
    }
  }

  /// Mark a conversation as read (store current message count).
  Future<void> markAsRead(int conversationId) async {
    final conversations = state.valueOrNull ?? [];
    final conv = conversations.where((c) => c.id == conversationId).firstOrNull;
    if (conv != null) {
      _lastReadCounts[conversationId] = conv.messageCount;
      // Persist
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setInt('chat_read_$conversationId', conv.messageCount);
      } catch (_) {}
      // Update state to reflect 0 unread
      final updated = conversations.map((c) {
        if (c.id == conversationId) return c.copyWith(unreadCount: 0);
        return c;
      }).toList();
      state = AsyncValue.data(updated);
    }
  }

  /// Compute unread count for a conversation based on client-side tracking.
  int _computeUnread(Conversation conv) {
    // If backend provides unread_count, always use it (most reliable)
    if (conv.unreadCount > 0) return conv.unreadCount;
    // Check client-side tracking
    final lastRead = _lastReadCounts[conv.id];
    if (lastRead == null) {
      // Never tracked — for new conversations, show 0
      // The auto-refresh timer will catch new messages via difference tracking
      // once the user opens the conversation and markAsRead() saves a baseline
      return 0;
    }
    if (lastRead == 0) {
      // Opened but had 0 messages at that time — current messages are "new"
      return conv.messageCount;
    }
    // Normal case: show difference between current count and last read count
    final diff = conv.messageCount - lastRead;
    return diff > 0 ? diff : 0;
  }

  /// Apply unread counts to conversation list.
  List<Conversation> _withUnreadCounts(List<Conversation> conversations) {
    return conversations.map((c) {
      final unread = _computeUnread(c);
      return c.copyWith(unreadCount: unread);
    }).toList();
  }

  /// Load/refresh conversations (resets pagination).
  Future<void> refresh() async {
    _currentOffset = 0;
    _hasMore = true;
    state = const AsyncValue.loading();
    final result = await _repo.getConversations(
      spaceId: _spaceId,
      limit: _pageSize,
      offset: 0,
    );
    if (result.isSuccess) {
      final data = result.data!;
      _currentOffset = data.length;
      _hasMore = data.length >= _pageSize;
      state = AsyncValue.data(_withUnreadCounts(data));
    } else {
      state = AsyncValue.error(result.error!, StackTrace.current);
    }
  }

  /// Load next page of conversations (infinite scroll).
  Future<void> loadMore() async {
    if (_isLoadingMore || !_hasMore) return;
    _isLoadingMore = true;
    try {
      final result = await _repo.getConversations(
        spaceId: _spaceId,
        limit: _pageSize,
        offset: _currentOffset,
      );
      if (result.isSuccess && mounted) {
        final newData = result.data!;
        _hasMore = newData.length >= _pageSize;
        _currentOffset += newData.length;
        final current = state.valueOrNull ?? [];
        // Deduplicate by id
        final existingIds = current.map((c) => c.id).toSet();
        final unique = newData.where((c) => !existingIds.contains(c.id)).toList();
        state = AsyncValue.data(_withUnreadCounts([...current, ...unique]));
      }
    } catch (_) {
      // Silently ignore errors during loadMore
    } finally {
      _isLoadingMore = false;
    }
  }

  /// Silent refresh — doesn't show loading state, just updates the loaded conversations.
  /// Used by auto-refresh timer. Refreshes all loaded conversations (not just first page).
  Future<void> _silentRefresh() async {
    try {
      final totalLoaded = _currentOffset > 0 ? _currentOffset : _pageSize;
      final result = await _repo.getConversations(
        spaceId: _spaceId,
        limit: totalLoaded,
        offset: 0,
      );
      if (result.isSuccess && mounted) {
        final data = result.data!;
        _hasMore = data.length >= totalLoaded;
        _currentOffset = data.length;
        state = AsyncValue.data(_withUnreadCounts(data));
      }
    } catch (_) {
      // Silently ignore errors during auto-refresh
    }
  }

  /// Create a new conversation and add to list.
  Future<Conversation?> create({String? title, List<int>? participantIds}) async {
    final result = await _repo.createConversation(title: title, participantIds: participantIds);
    if (result.isSuccess) {
      final conv = result.data!;
      final current = state.valueOrNull ?? [];
      state = AsyncValue.data([conv, ...current]);
      return conv;
    }
    return null;
  }

  /// Rename a conversation. Returns null on success, error string on failure.
  Future<String?> rename(int id, String newTitle) async {
    final result = await _repo.updateConversationTitle(id, newTitle);
    if (result.isSuccess) {
      // Update local state
      final current = state.valueOrNull ?? [];
      final updated = current.map((c) {
        if (c.id == id) {
          return Conversation(
            id: c.id,
            title: newTitle,
            lastMessage: c.lastMessage,
            lastMessageAt: c.lastMessageAt,
            messageCount: c.messageCount,
            unreadCount: c.unreadCount,
            createdAt: c.createdAt,
            participants: c.participants,
          );
        }
        return c;
      }).toList();
      state = AsyncValue.data(updated);
      return null; // success
    }
    return result.error ?? 'Unknown error';
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    super.dispose();
  }
}

/// Single conversation detail provider (with messages).
final conversationDetailProvider =
    FutureProvider.family<ConversationDetail?, int>((ref, id) async {
  final repo = ref.watch(chatRepositoryProvider);
  final result = await repo.getConversation(id);
  return result.isSuccess ? result.data : null;
});

/// Tickets list provider — filters by selected space and resolves relations.
final ticketsProvider =
    StateNotifierProvider<TicketsNotifier, AsyncValue<List<Ticket>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  final spaceId = ref.watch(selectedSpaceProvider);
  return TicketsNotifier(repo, spaceId);
});

class TicketsNotifier extends StateNotifier<AsyncValue<List<Ticket>>> {
  final ChatRepository _repo;
  final int? _spaceId;

  TicketsNotifier(this._repo, this._spaceId) : super(const AsyncValue.loading()) {
    load();
  }

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repo.getTickets(spaceId: _spaceId);
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!);
      } else {
        print('[Tickets] Failed to load: ${result.error}');
        state = const AsyncValue.data([]);
      }
    } catch (e) {
      print('[Tickets] Exception: $e');
      state = const AsyncValue.data([]);
    }
  }

  Future<void> refresh() async => load();
}

/// Dynamic ticket statuses from CRM relation table.
final ticketStatusesProvider =
    StateNotifierProvider<TicketStatusesNotifier, AsyncValue<List<TicketStatus>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  final spaceId = ref.watch(selectedSpaceProvider);
  return TicketStatusesNotifier(repo, spaceId);
});

class TicketStatusesNotifier extends StateNotifier<AsyncValue<List<TicketStatus>>> {
  final ChatRepository _repo;
  final int? _spaceId;

  TicketStatusesNotifier(this._repo, this._spaceId) : super(const AsyncValue.loading()) {
    load();
  }

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repo.getTicketStatuses(spaceId: _spaceId);
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!);
      } else {
        state = AsyncValue.data(List<TicketStatus>.from(defaultTicketStatuses));
      }
    } catch (e) {
      state = AsyncValue.data(List<TicketStatus>.from(defaultTicketStatuses));
    }
  }

  Future<void> refresh() async => load();
}

/// Dynamic ticket priorities from CRM relation table.
final ticketPrioritiesProvider =
    StateNotifierProvider<TicketPrioritiesNotifier, AsyncValue<List<TicketPriority>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  final spaceId = ref.watch(selectedSpaceProvider);
  return TicketPrioritiesNotifier(repo, spaceId);
});

class TicketPrioritiesNotifier extends StateNotifier<AsyncValue<List<TicketPriority>>> {
  final ChatRepository _repo;
  final int? _spaceId;

  TicketPrioritiesNotifier(this._repo, this._spaceId) : super(const AsyncValue.loading()) {
    load();
  }

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repo.getTicketPriorities(spaceId: _spaceId);
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!);
      } else {
        state = AsyncValue.data(List<TicketPriority>.from(defaultTicketPriorities));
      }
    } catch (e) {
      state = AsyncValue.data(List<TicketPriority>.from(defaultTicketPriorities));
    }
  }

  Future<void> refresh() async => load();
}

/// Contacts list provider.
final contactsProvider =
    StateNotifierProvider<ContactsNotifier, AsyncValue<List<Contact>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  return ContactsNotifier(repo);
});

class ContactsNotifier extends StateNotifier<AsyncValue<List<Contact>>> {
  final ChatRepository _repo;

  ContactsNotifier(this._repo) : super(const AsyncValue.loading()) {
    load();
  }

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repo.getContacts();
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!);
      } else {
        print('[Contacts] Failed to load: ${result.error}');
        state = const AsyncValue.data([]);
      }
    } catch (e) {
      print('[Contacts] Exception: $e');
      state = const AsyncValue.data([]);
    }
  }

  Future<void> refresh() async => load();
}

/// Agents list provider (for @mentions in chat) — filters by selected space.
final agentsProvider =
    StateNotifierProvider<AgentsNotifier, AsyncValue<List<Agent>>>((ref) {
  final repo = ref.watch(chatRepositoryProvider);
  final spaceId = ref.watch(selectedSpaceProvider);
  return AgentsNotifier(repo, spaceId);
});

class AgentsNotifier extends StateNotifier<AsyncValue<List<Agent>>> {
  final ChatRepository _repo;
  final int? _spaceId;

  AgentsNotifier(this._repo, this._spaceId) : super(const AsyncValue.loading()) {
    load();
  }

  Future<void> load() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repo.getAgents(spaceId: _spaceId);
      if (result.isSuccess && result.data != null) {
        state = AsyncValue.data(result.data!);
      } else {
        print('[Agents] Failed to load: ${result.error}');
        state = const AsyncValue.data([]);
      }
    } catch (e) {
      print('[Agents] Exception: $e');
      state = const AsyncValue.data([]);
    }
  }

  Future<void> refresh() async => load();
}

/// Mentionable users provider — merges agents + contacts into MentionableUser list.
/// Agents come first, then contacts.
final mentionableUsersProvider =
    FutureProvider<List<MentionableUser>>((ref) async {
  final agents = ref.watch(agentsProvider).valueOrNull ?? [];
  final contacts = ref.watch(contactsProvider).valueOrNull ?? [];

  final mentionableUsers = <MentionableUser>[];

  // Agents first
  for (final agent in agents) {
    mentionableUsers.add(MentionableUser.fromAgent(agent));
  }

  // Then contacts (skip duplicates by name if agent shares a name)
  final agentNames = agents.map((a) => a.name.toLowerCase()).toSet();
  for (final contact in contacts) {
    if (!agentNames.contains(contact.name.toLowerCase())) {
      mentionableUsers.add(MentionableUser.fromContact(contact));
    }
  }

  return mentionableUsers;
});

/// Tables list provider (for link-row-to-chat feature).
final tablesProvider =
    FutureProvider<List<CrmTable>>((ref) async {
  final repo = ref.watch(chatRepositoryProvider);
  final result = await repo.getTables();
  return result.isSuccess ? result.data! : [];
});

/// Projects provider — optionally filtered by spaceId.
final projectsForSpaceProvider =
    FutureProvider.family<List<CrmProject>, int?>((ref, spaceId) async {
  final repo = ref.watch(chatRepositoryProvider);
  final result = await repo.getProjects(spaceId: spaceId);
  return result.isSuccess ? result.data! : [];
});

/// Tables provider — optionally filtered by spaceId and/or projectId.
final tablesForProjectProvider =
    FutureProvider.family<List<CrmTable>, ({int? spaceId, int? projectId})>((ref, params) async {
  final repo = ref.watch(chatRepositoryProvider);
  final result = await repo.getTables(spaceId: params.spaceId, projectId: params.projectId);
  return result.isSuccess ? result.data! : [];
});

/// Table rows provider (for a specific table).
final tableRowsProvider =
    FutureProvider.family<List<CrmTableRow>, int>((ref, tableId) async {
  final repo = ref.watch(chatRepositoryProvider);
  final result = await repo.getTableRows(tableId);
  return result.isSuccess ? result.data! : [];
});
