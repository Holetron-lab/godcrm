import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme.dart';
import '../../chat/data/models.dart';
import '../../chat/providers/call_provider.dart';
import '../../chat/providers/conversations_provider.dart';
import '../../chat/ui/call_screen.dart';

/// Standalone Contacts screen with search.
class ContactsScreen extends ConsumerStatefulWidget {
  const ContactsScreen({super.key});

  @override
  ConsumerState<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends ConsumerState<ContactsScreen> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  bool _showSearch = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Contact> _applySearch(List<Contact> contacts) {
    if (_searchQuery.isEmpty) return contacts;
    final q = _searchQuery.toLowerCase();
    return contacts.where((c) {
      return c.name.toLowerCase().contains(q) ||
          (c.email?.toLowerCase().contains(q) ?? false) ||
          (c.role?.toLowerCase().contains(q) ?? false) ||
          (c.company?.toLowerCase().contains(q) ?? false) ||
          (c.phone?.contains(q) ?? false);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final contactsAsync = ref.watch(contactsProvider);

    return Scaffold(
      appBar: AppBar(
        title: _showSearch
            ? TextField(
                controller: _searchController,
                autofocus: true,
                style: const TextStyle(color: GodTheme.textPrimary, fontSize: 16),
                decoration: const InputDecoration(
                  hintText: 'Search contacts...',
                  hintStyle: TextStyle(color: GodTheme.textMuted),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _searchQuery = v),
              )
            : const Text('Contacts'),
        actions: [
          IconButton(
            icon: Icon(_showSearch ? Icons.close : Icons.search),
            onPressed: () {
              setState(() {
                _showSearch = !_showSearch;
                if (!_showSearch) {
                  _searchController.clear();
                  _searchQuery = '';
                }
              });
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(contactsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: contactsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, size: 48, color: GodTheme.error),
              const SizedBox(height: 12),
              Text(err.toString(),
                  style: const TextStyle(color: GodTheme.textSecondary)),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => ref.read(contactsProvider.notifier).refresh(),
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (contacts) {
          final filtered = _applySearch(contacts);

          if (contacts.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.people_outline, size: 64,
                      color: GodTheme.textMuted.withOpacity(0.3)),
                  const SizedBox(height: 16),
                  const Text('No contacts found',
                      style: TextStyle(color: GodTheme.textSecondary)),
                  const SizedBox(height: 8),
                  const Text('Users from your CRM will appear here',
                      style: TextStyle(color: GodTheme.textMuted, fontSize: 13)),
                ],
              ),
            );
          }

          if (filtered.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.search_off, size: 64,
                      color: GodTheme.textMuted.withOpacity(0.3)),
                  const SizedBox(height: 16),
                  const Text('No matching contacts',
                      style: TextStyle(color: GodTheme.textSecondary)),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => setState(() {
                      _searchController.clear();
                      _searchQuery = '';
                    }),
                    child: const Text('Clear search'),
                  ),
                ],
              ),
            );
          }

          return RefreshIndicator(
            onRefresh: () => ref.read(contactsProvider.notifier).refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemCount: filtered.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
              itemBuilder: (context, index) {
                final contact = filtered[index];
                return _ContactTile(contact: contact);
              },
            ),
          );
        },
      ),
    );
  }
}

/// Single contact tile with new chat button.
class _ContactTile extends ConsumerWidget {
  final Contact contact;

  const _ContactTile({required this.contact});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      leading: CircleAvatar(
        radius: 22,
        backgroundColor: _colorForName(contact.name).withOpacity(0.15),
        child: Text(
          contact.initials,
          style: TextStyle(
            color: _colorForName(contact.name),
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
      ),
      title: Text(
        contact.name,
        style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 15),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (contact.email != null)
            Text(
              contact.email!,
              style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          if (contact.role != null || contact.company != null)
            Text(
              [contact.role, contact.company].whereType<String>().join(' @ '),
              style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
        ],
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            color: GodTheme.primary,
            tooltip: 'New chat',
            onPressed: () => _startNewChat(context, ref),
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            padding: EdgeInsets.zero,
          ),
          // Call without recording (simple call, no chat)
          IconButton(
            icon: const Icon(Icons.phone_outlined, size: 18),
            color: GodTheme.success,
            tooltip: 'Звонок (без записи)',
            onPressed: () => _startDirectCall(context, ref, withRecording: false),
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            padding: EdgeInsets.zero,
          ),
          // Call with recording (creates chat + transcription)
          IconButton(
            icon: const Icon(Icons.fiber_manual_record, size: 14),
            color: const Color(0xFFEF4444),
            tooltip: 'Звонок с записью',
            onPressed: () => _startDirectCall(context, ref, withRecording: true),
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            padding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }

  Future<void> _startDirectCall(BuildContext context, WidgetRef ref, {required bool withRecording}) async {
    try {
      if (withRecording) {
        // Create a chat first, then start call with recording
        final conv = await ref.read(conversationsProvider.notifier).create(
          title: 'Call: ${contact.name}',
          participantIds: [contact.id],
        );
        if (conv != null && context.mounted) {
          ref.read(callProvider.notifier).startCall(conv.id, withRecording: true);
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => CallScreen(
              conversationId: conv.id,
              title: contact.name,
              participantNames: [contact.name],
              withRecording: true,
            )),
          );
        }
      } else {
        // Simple call without recording — create temp conversation
        final conv = await ref.read(conversationsProvider.notifier).create(
          title: 'Call: ${contact.name}',
          participantIds: [contact.id],
        );
        if (conv != null && context.mounted) {
          ref.read(callProvider.notifier).startCall(conv.id, withRecording: false);
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => CallScreen(
              conversationId: conv.id,
              title: contact.name,
              participantNames: [contact.name],
              withRecording: false,
            )),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Не удалось начать звонок: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _startNewChat(BuildContext context, WidgetRef ref) async {
    try {
      final conv = await ref.read(conversationsProvider.notifier).create(
        title: 'Chat with ${contact.name}',
        participantIds: [contact.id],
      );
      if (conv != null && context.mounted) {
        context.go('/chat/${conv.id}');
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to create chat: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  Color _colorForName(String name) {
    final colors = [
      GodTheme.primary,
      GodTheme.accent,
      GodTheme.success,
      GodTheme.warning,
      GodTheme.info,
      const Color(0xFFA855F7),
      const Color(0xFFF43F5E),
      const Color(0xFF14B8A6),
    ];
    final hash = name.codeUnits.fold(0, (prev, c) => prev + c);
    return colors[hash % colors.length];
  }
}
