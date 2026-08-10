import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme.dart';
import '../data/models.dart';
import '../providers/conversations_provider.dart';

/// Chat screen — list of conversations with space selector in AppBar.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      final notifier = ref.read(conversationsProvider.notifier);
      if (notifier.hasMore && !notifier.isLoadingMore) {
        notifier.loadMore();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final conversationsAsync = ref.watch(conversationsProvider);
    final spacesAsync = ref.watch(spacesProvider);
    final selectedSpace = ref.watch(selectedSpaceProvider);

    // Get current space name for AppBar title
    final currentSpaceName = spacesAsync.whenOrNull(
      data: (spaces) {
        if (selectedSpace == null) return null;
        final found = spaces.where((s) => s.id == selectedSpace);
        return found.isNotEmpty ? found.first.name : null;
      },
    );

    return Scaffold(
      appBar: AppBar(
        title: _SpaceDropdownTitle(
          currentSpaceName: currentSpaceName ?? 'All Spaces',
          onTap: () => _showSpacePicker(context, ref, spacesAsync, selectedSpace),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'New Conversation',
            onPressed: () async {
              final conv = await ref.read(conversationsProvider.notifier).create();
              if (conv != null && context.mounted) {
                context.go('/chat/${conv.id}');
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () => ref.read(conversationsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: conversationsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorView(
          message: err.toString(),
          onRetry: () => ref.read(conversationsProvider.notifier).refresh(),
        ),
        data: (conversations) {
          if (conversations.isEmpty) {
            return const _EmptyView();
          }
          final notifier = ref.read(conversationsProvider.notifier);
          final hasMore = notifier.hasMore;
          final itemCount = conversations.length + (hasMore ? 1 : 0);
          return RefreshIndicator(
            onRefresh: () => ref.read(conversationsProvider.notifier).refresh(),
            child: ListView.separated(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemCount: itemCount,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
              itemBuilder: (context, index) {
                if (index >= conversations.length) {
                  return const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                  );
                }
                final conv = conversations[index];
                return _ConversationTile(
                  key: ValueKey('conv_${conv.id}'),
                  conversation: conv,
                  onTap: () {
                    // Mark as read when opening
                    ref.read(conversationsProvider.notifier).markAsRead(conv.id);
                    context.go('/chat/${conv.id}');
                  },
                  onRename: () => _showRenameDialog(context, ref, conv),
                );
              },
            ),
          );
        },
      ),
    );
  }

  /// Show bottom sheet space picker — draggable and scrollable.
  void _showSpacePicker(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<Space>> spacesAsync,
    int? selectedSpaceId,
  ) {
    final spaces = spacesAsync.valueOrNull ?? [];

    HapticFeedback.selectionClick();
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) {
        // Initial size: min of needed content or 50% of screen
        final itemCount = spaces.length + 1;
        final screenHeight = MediaQuery.sizeOf(ctx).height;
        final neededFraction = ((80.0 + (itemCount * 60.0) + 32) / screenHeight).clamp(0.3, 0.85);
        final initialFraction = neededFraction.clamp(0.3, 0.5);

        return DraggableScrollableSheet(
          initialChildSize: initialFraction,
          minChildSize: 0.25,
          maxChildSize: 0.85,
          builder: (dragCtx, scrollController) {
            return Container(
              decoration: const BoxDecoration(
                color: GodTheme.surface,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Handle bar (drag indicator)
                  Center(
                    child: Container(
                      margin: const EdgeInsets.only(top: 12, bottom: 8),
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: GodTheme.textMuted.withOpacity(0.3),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Text(
                      'Select Space',
                      style: TextStyle(
                        color: GodTheme.textPrimary,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  const Divider(height: 1, color: GodTheme.border),
                  // Scrollable list of spaces — uses the scrollController from DraggableScrollableSheet
                  Expanded(
                    child: ListView.builder(
                      controller: scrollController,
                      padding: const EdgeInsets.only(bottom: 16),
                      itemCount: itemCount,
                      itemBuilder: (listCtx, index) {
                        // First item = "All Spaces"
                        if (index == 0) {
                          return ListTile(
                            key: const ValueKey('space_all'),
                            leading: Icon(
                              Icons.grid_view_rounded,
                              color: selectedSpaceId == null ? GodTheme.primary : GodTheme.textMuted,
                            ),
                            title: Text(
                              'All Spaces',
                              style: TextStyle(
                                color: selectedSpaceId == null ? GodTheme.primary : GodTheme.textPrimary,
                                fontWeight: selectedSpaceId == null ? FontWeight.w600 : FontWeight.w400,
                              ),
                            ),
                            trailing: selectedSpaceId == null
                                ? const Icon(Icons.check_circle, color: GodTheme.primary, size: 20)
                                : null,
                            onTap: () {
                              ref.read(selectedSpaceProvider.notifier).state = null;
                              Navigator.pop(ctx);
                            },
                          );
                        }

                        // Individual spaces
                        final space = spaces[index - 1];
                        final isSelected = selectedSpaceId == space.id;
                        return ListTile(
                          key: ValueKey('space_${space.id}'),
                          leading: Icon(
                            _iconForType(space.type),
                            color: isSelected ? GodTheme.primary : GodTheme.textMuted,
                          ),
                          title: Text(
                            space.name,
                            style: TextStyle(
                              color: isSelected ? GodTheme.primary : GodTheme.textPrimary,
                              fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                          subtitle: space.description != null && space.description!.isNotEmpty
                              ? Text(
                                  space.description!,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                                )
                              : null,
                          trailing: isSelected
                              ? const Icon(Icons.check_circle, color: GodTheme.primary, size: 20)
                              : null,
                          onTap: () {
                            ref.read(selectedSpaceProvider.notifier).state = space.id;
                            Navigator.pop(ctx);
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// Show rename dialog for a conversation.
  void _showRenameDialog(BuildContext context, WidgetRef ref, Conversation conv) {
    final controller = TextEditingController(text: conv.title);

    HapticFeedback.mediumImpact();
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
            if (value.trim().isNotEmpty && value.trim() != conv.title) {
              Navigator.pop(ctx);
              final error = await ref.read(conversationsProvider.notifier).rename(conv.id, value.trim());
              if (error != null && context.mounted) {
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
              if (value.isNotEmpty && value != conv.title) {
                Navigator.pop(ctx);
                final error = await ref.read(conversationsProvider.notifier).rename(conv.id, value);
                if (error != null && context.mounted) {
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

  IconData _iconForType(String type) {
    switch (type) {
      case 'business':
        return Icons.business;
      case 'ai':
        return Icons.smart_toy;
      case 'custom':
        return Icons.dashboard_customize;
      default:
        return Icons.person;
    }
  }
}

/// AppBar title — shows current space name with dropdown arrow.
class _SpaceDropdownTitle extends StatelessWidget {
  final String currentSpaceName;
  final VoidCallback onTap;

  const _SpaceDropdownTitle({
    required this.currentSpaceName,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.space_dashboard_outlined, size: 20, color: GodTheme.primary),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              currentSpaceName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: GodTheme.textPrimary,
              ),
            ),
          ),
          const SizedBox(width: 4),
          const Icon(Icons.arrow_drop_down_rounded, size: 24, color: GodTheme.textSecondary),
        ],
      ),
    );
  }
}

/// Conversation tile with participants and long-press to rename.
class _ConversationTile extends StatelessWidget {
  final Conversation conversation;
  final VoidCallback onTap;
  final VoidCallback onRename;

  const _ConversationTile({
    super.key,
    required this.conversation,
    required this.onTap,
    required this.onRename,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      onLongPress: onRename,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Avatar or multi-avatar
            _buildLeadingAvatar(),
            const SizedBox(width: 12),
            // Content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title row with edit icon + time
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversation.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      GestureDetector(
                        onTap: onRename,
                        child: const Padding(
                          padding: EdgeInsets.all(4),
                          child: Icon(Icons.edit_outlined, size: 14, color: GodTheme.textMuted),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        conversation.timeAgo,
                        style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                      ),
                    ],
                  ),
                  // Bound row indicator
                  if (conversation.boundRowId != null) ...[
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        const Icon(Icons.link, size: 11, color: Color(0xFF60A5FA)),
                        const SizedBox(width: 3),
                        Expanded(
                          child: Text(
                            '${conversation.boundTableIcon ?? ''}${conversation.boundTableIcon != null ? ' ' : ''}'
                            '${conversation.boundTableName != null ? '${conversation.boundTableName}: ' : ''}'
                            '${conversation.boundRowTitle ?? '#${conversation.boundRowId}'}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: Color(0xFF60A5FA), fontSize: 11),
                          ),
                        ),
                      ],
                    ),
                  ],
                  // Last message preview
                  if (conversation.lastMessage != null) ...[
                    const SizedBox(height: 3),
                    Text(
                      conversation.lastMessage!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                    ),
                  ],
                  // Participants row
                  if (conversation.participants.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    _ParticipantsRow(participants: conversation.participants),
                  ],
                ],
              ),
            ),
            // Unread message count badge (only show if unread > 0)
            if (conversation.unreadCount > 0) ...[
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: GodTheme.primary,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    conversation.unreadCount > 99
                        ? '99+'
                        : '${conversation.unreadCount}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildLeadingAvatar() {
    final participants = conversation.participants;

    if (participants.isEmpty) {
      return CircleAvatar(
        radius: 22,
        backgroundColor: GodTheme.primary.withValues(alpha: 0.15),
        child: const Icon(Icons.chat_bubble_outline, color: GodTheme.primary, size: 20),
      );
    }

    if (participants.length == 1) {
      return _buildSingleAvatar(participants.first, 22);
    }

    // Stacked avatars for 2+ participants
    return SizedBox(
      width: 48,
      height: 44,
      child: Stack(
        children: [
          Positioned(
            right: 0,
            bottom: 0,
            child: _buildSingleAvatar(
              participants.length > 1 ? participants[1] : participants[0],
              16,
            ),
          ),
          Positioned(
            left: 0,
            top: 0,
            child: Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: GodTheme.background, width: 2),
              ),
              child: _buildSingleAvatar(participants[0], 16),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSingleAvatar(Participant p, double radius) {
    final initials = _getInitials(p.name);
    final color = _colorForName(p.name);

    return CircleAvatar(
      radius: radius,
      backgroundColor: color.withValues(alpha: 0.2),
      child: Text(
        initials,
        style: TextStyle(
          color: color,
          fontSize: radius * 0.7,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  String _getInitials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }

  Color _colorForName(String name) {
    final colors = [
      GodTheme.primary,
      GodTheme.accent,
      GodTheme.success,
      GodTheme.warning,
      GodTheme.info,
      const Color(0xFFA855F7), // purple
      const Color(0xFFF43F5E), // rose
      const Color(0xFF14B8A6), // teal
    ];
    final hash = name.codeUnits.fold(0, (prev, c) => prev + c);
    return colors[hash % colors.length];
  }
}

/// Compact row of participant names with avatars.
class _ParticipantsRow extends StatelessWidget {
  final List<Participant> participants;

  const _ParticipantsRow({required this.participants});

  @override
  Widget build(BuildContext context) {
    final maxShow = 4;
    final shown = participants.take(maxShow).toList();
    final remaining = participants.length - maxShow;

    return Row(
      children: [
        // Small stacked avatars
        SizedBox(
          width: (shown.length * 18.0) + 2, // overlap offset
          height: 20,
          child: Stack(
            children: List.generate(shown.length, (i) {
              final p = shown[i];
              final initials = _getInitials(p.name);
              final color = _colorForName(p.name);
              return Positioned(
                left: i * 15.0,
                child: Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: GodTheme.background, width: 1.5),
                  ),
                  child: CircleAvatar(
                    radius: 9,
                    backgroundColor: color.withValues(alpha: 0.25),
                    child: Text(
                      initials,
                      style: TextStyle(
                        color: color,
                        fontSize: 8,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
        const SizedBox(width: 4),
        // Names text
        Expanded(
          child: Text(
            _buildNamesText(shown, remaining),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: GodTheme.textMuted,
              fontSize: 11,
            ),
          ),
        ),
      ],
    );
  }

  String _buildNamesText(List<Participant> shown, int remaining) {
    final names = shown.map((p) {
      final parts = p.name.split(' ');
      return parts.isNotEmpty ? parts.first : p.name;
    }).join(', ');
    if (remaining > 0) {
      return '$names +$remaining';
    }
    return names;
  }

  String _getInitials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
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

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.chat_bubble_outline, size: 64, color: GodTheme.textMuted.withValues(alpha: 0.3)),
          const SizedBox(height: 16),
          const Text('No conversations yet', style: TextStyle(color: GodTheme.textSecondary)),
          const SizedBox(height: 8),
          const Text('Tap + to start a new chat', style: TextStyle(color: GodTheme.textMuted, fontSize: 13)),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: GodTheme.error),
            const SizedBox(height: 16),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: GodTheme.textSecondary)),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
