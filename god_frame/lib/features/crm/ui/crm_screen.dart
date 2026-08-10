import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme.dart';
import '../../chat/data/models.dart';
import '../../chat/providers/conversations_provider.dart';
import '../../../shared/utils/api_client.dart';

/// CRM screen — Tickets + Contacts in a tab bar.
class CrmScreen extends ConsumerStatefulWidget {
  const CrmScreen({super.key});

  @override
  ConsumerState<CrmScreen> createState() => _CrmScreenState();
}

class _CrmScreenState extends ConsumerState<CrmScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('CRM'),
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.assignment), text: 'Tickets'),
            Tab(icon: Icon(Icons.people), text: 'Contacts'),
          ],
          indicatorColor: GodTheme.primary,
          labelColor: GodTheme.primary,
          unselectedLabelColor: GodTheme.textMuted,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.read(ticketsProvider.notifier).refresh();
              ref.read(contactsProvider.notifier).refresh();
            },
          ),
        ],
      ),
      body: TabBarView(
        controller: _tabController,
        children: const [
          _TicketsTab(),
          _ContactsTab(),
        ],
      ),
    );
  }
}

/// Icon for a status name (UI preference).
IconData _iconForStatus(String status) {
  switch (status.toLowerCase().replaceAll('_', ' ')) {
    case 'done':
    case 'completed':
      return Icons.check_circle_outline;
    case 'in progress':
      return Icons.play_circle_outline;
    case 'review':
      return Icons.rate_review_outlined;
    case 'control':
      return Icons.verified_outlined;
    case 'rejected':
      return Icons.cancel_outlined;
    case 'assigned':
      return Icons.person_add_outlined;
    case 'on hold':
      return Icons.pause_circle_outline;
    default:
      return Icons.radio_button_unchecked;
  }
}

/// Tickets tab content.
class _TicketsTab extends ConsumerWidget {
  const _TicketsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ticketsAsync = ref.watch(ticketsProvider);

    return ticketsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: GodTheme.error),
            const SizedBox(height: 12),
            Text(err.toString(), style: const TextStyle(color: GodTheme.textSecondary)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => ref.read(ticketsProvider.notifier).refresh(),
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (tickets) {
        if (tickets.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.assignment_outlined, size: 64,
                    color: GodTheme.textMuted.withOpacity(0.3)),
                const SizedBox(height: 16),
                const Text('No tickets found',
                    style: TextStyle(color: GodTheme.textSecondary)),
                const SizedBox(height: 8),
                const Text('Tickets from your CRM will appear here',
                    style: TextStyle(color: GodTheme.textMuted, fontSize: 13)),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: () => ref.read(ticketsProvider.notifier).refresh(),
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 4),
            itemCount: tickets.length,
            separatorBuilder: (_, __) => const Divider(height: 1, indent: 16, endIndent: 16),
            itemBuilder: (context, index) {
              final ticket = tickets[index];
              return _TicketTile(ticket: ticket);
            },
          ),
        );
      },
    );
  }
}

/// Single ticket tile with status change and chat button.
class _TicketTile extends ConsumerWidget {
  final Ticket ticket;

  const _TicketTile({required this.ticket});

  Color _dynStatusColor(WidgetRef ref) {
    final statuses = ref.read(ticketStatusesProvider).valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);
    return statusColorFromList(ticket.status, statuses);
  }

  Color _dynPriorityColor(String priority, WidgetRef ref) {
    final priorities = ref.read(ticketPrioritiesProvider).valueOrNull ?? List<TicketPriority>.from(defaultTicketPriorities);
    return priorityColorFromList(priority, priorities);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sColor = _dynStatusColor(ref);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: GestureDetector(
        onTap: () => _showStatusPicker(context, ref),
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: sColor.withOpacity(0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(
            _iconForStatus(ticket.status),
            color: sColor,
            size: 20,
          ),
        ),
      ),
      title: Text(
        ticket.title,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              // Tappable status badge
              GestureDetector(
                onTap: () => _showStatusPicker(context, ref),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: sColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: sColor.withOpacity(0.3), width: 0.5),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        ticket.status.replaceAll('_', ' '),
                        style: TextStyle(
                          color: sColor,
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 2),
                      Icon(Icons.arrow_drop_down, size: 12, color: sColor),
                    ],
                  ),
                ),
              ),
              if (ticket.type != null)
                _buildChip(ticket.type!, const Color(0xFF6366F1)),
              if (ticket.priority != null)
                _buildChip(ticket.priority!, _dynPriorityColor(ticket.priority!, ref)),
              if (ticket.phase != null)
                _buildChip(ticket.phase!, const Color(0xFF14B8A6)),
            ],
          ),
          if (ticket.assignee != null || ticket.adrRef != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  if (ticket.assignee != null) ...[
                    const Icon(Icons.person_outline, size: 12, color: GodTheme.textMuted),
                    const SizedBox(width: 3),
                    Flexible(
                      child: Text(
                        ticket.assignee!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: GodTheme.textSecondary, fontSize: 11),
                      ),
                    ),
                  ],
                  if (ticket.adrRef != null) ...[
                    const SizedBox(width: 8),
                    Icon(Icons.link, size: 12, color: GodTheme.primary.withOpacity(0.7)),
                    const SizedBox(width: 3),
                    Flexible(
                      child: Text(
                        ticket.adrRef!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: GodTheme.primary.withOpacity(0.7), fontSize: 11),
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
      trailing: IconButton(
        icon: const Icon(Icons.chat_bubble_outline, size: 18),
        color: GodTheme.primary,
        tooltip: 'Open chat',
        onPressed: () => _openTicketChat(context, ref),
        constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
        padding: EdgeInsets.zero,
      ),
      onTap: () => _showTicketDetail(context),
    );
  }

  /// Build a labeled field for ticket detail view.
  Widget _detailField(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.2), width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(color: color.withOpacity(0.6), fontSize: 9, fontWeight: FontWeight.w600)),
          Text(value, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  /// Build a small colored chip for field values.
  Widget _buildChip(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Text(
        label,
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w500),
      ),
    );
  }

  /// Show status picker bottom sheet (dynamic from CRM).
  void _showStatusPicker(BuildContext context, WidgetRef ref) {
    final statuses = ref.read(ticketStatusesProvider).valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: const Text(
                'Change Status',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                  color: GodTheme.textPrimary,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                ticket.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: GodTheme.textMuted, fontSize: 13),
              ),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            ...statuses.map((s) {
              final isSelected = s.name.toLowerCase() ==
                  ticket.status.toLowerCase().replaceAll('_', ' ');
              return ListTile(
                leading: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: s.color.withOpacity(isSelected ? 0.25 : 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    _iconForStatus(s.name),
                    color: s.color,
                    size: 18,
                  ),
                ),
                title: Text(
                  s.name.replaceAll('_', ' ').toUpperCase(),
                  style: TextStyle(
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    color: isSelected ? s.color : GodTheme.textPrimary,
                    fontSize: 14,
                  ),
                ),
                trailing: isSelected
                    ? Icon(Icons.check_circle, color: s.color, size: 20)
                    : null,
                onTap: () {
                  Navigator.pop(ctx);
                  if (!isSelected) {
                    _updateTicketStatus(context, ref, s.name);
                  }
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// Update ticket status via API.
  Future<void> _updateTicketStatus(BuildContext context, WidgetRef ref, String newStatus) async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final tableId = ticket.tableId ?? 1708;

      await apiClient.put(
        '/tables/$tableId/rows/${ticket.id}',
        data: {
          'data': {'status': newStatus},
        },
      );

      // Refresh tickets list
      ref.read(ticketsProvider.notifier).refresh();

      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Status updated to ${newStatus.replaceAll('_', ' ')}'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to update status: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  /// Open or create a chat for this ticket.
  Future<void> _openTicketChat(BuildContext context, WidgetRef ref) async {
    try {
      final conv = await ref.read(conversationsProvider.notifier).create(
        title: '#${ticket.id}: ${ticket.title}',
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

  /// Show ticket detail (title + description) with dynamic colors.
  void _showTicketDetail(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.4,
        minChildSize: 0.2,
        maxChildSize: 0.8,
        expand: false,
        builder: (_, scrollController) => Consumer(builder: (_, ref, __) {
          final statuses = ref.read(ticketStatusesProvider).valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);
          final priorities = ref.read(ticketPrioritiesProvider).valueOrNull ?? List<TicketPriority>.from(defaultTicketPriorities);
          final sColor = statusColorFromList(ticket.status, statuses);

          return SingleChildScrollView(
            controller: scrollController,
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: GodTheme.textMuted.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: sColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        ticket.status.replaceAll('_', ' ').toUpperCase(),
                        style: TextStyle(color: sColor, fontSize: 11, fontWeight: FontWeight.w700),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text('#${ticket.id}', style: const TextStyle(color: GodTheme.textMuted, fontSize: 13)),
                    const Spacer(),
                    if (ticket.priority != null)
                      Text(ticket.priority!, style: const TextStyle(color: GodTheme.textMuted, fontSize: 12)),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  ticket.title,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: GodTheme.textPrimary),
                ),
                const SizedBox(height: 12),
                // Metadata row: type, priority, phase
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    if (ticket.type != null)
                      _detailField('Type', ticket.type!, const Color(0xFF6366F1)),
                    if (ticket.priority != null)
                      _detailField('Priority', ticket.priority!, priorityColorFromList(ticket.priority!, priorities)),
                    if (ticket.phase != null)
                      _detailField('Phase', ticket.phase!, const Color(0xFF14B8A6)),
                    if (ticket.adrRef != null)
                      _detailField('ADR', ticket.adrRef!, GodTheme.primary),
                  ],
                ),
                if (ticket.assignee != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.person_outline, size: 16, color: GodTheme.textMuted),
                      const SizedBox(width: 6),
                      Text('Assigned: ${ticket.assignee!}',
                          style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13)),
                    ],
                  ),
                ],
                if (ticket.description != null) ...[
                  const SizedBox(height: 16),
                  const Divider(height: 1),
                  const SizedBox(height: 12),
                  Text(
                    ticket.description!,
                    style: const TextStyle(color: GodTheme.textSecondary, fontSize: 14, height: 1.5),
                  ),
                ],
                const SizedBox(height: 20),
              ],
            ),
          );
        }),
      ),
    );
  }
}

/// Contacts tab content.
class _ContactsTab extends ConsumerWidget {
  const _ContactsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final contactsAsync = ref.watch(contactsProvider);

    return contactsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: GodTheme.error),
            const SizedBox(height: 12),
            Text(err.toString(), style: const TextStyle(color: GodTheme.textSecondary)),
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

        return RefreshIndicator(
          onRefresh: () => ref.read(contactsProvider.notifier).refresh(),
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 4),
            itemCount: contacts.length,
            separatorBuilder: (_, __) => const Divider(height: 1, indent: 72),
            itemBuilder: (context, index) {
              final contact = contacts[index];
              return _ContactTile(contact: contact);
            },
          ),
        );
      },
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
          // New chat button
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            color: GodTheme.primary,
            tooltip: 'New chat',
            onPressed: () => _startNewChat(context, ref),
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            padding: EdgeInsets.zero,
          ),
          if (contact.phone != null)
            IconButton(
              icon: const Icon(Icons.phone_outlined, size: 18),
              color: GodTheme.success,
              onPressed: () {},
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              padding: EdgeInsets.zero,
            ),
        ],
      ),
    );
  }

  /// Create a new conversation with this contact.
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
