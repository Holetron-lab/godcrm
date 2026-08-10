import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/theme.dart';
import '../../chat/data/models.dart';
import '../../chat/providers/conversations_provider.dart';
import '../../../shared/utils/api_client.dart';
import '../../settings/providers/todo_view_provider.dart';

// Pre-calculated color constants to avoid .withOpacity() allocations
const _kTextMutedOp03 = Color(0x4D64748B); // GodTheme.textMuted (0xFF64748B) at 0.3
const _kTextMutedOp01 = Color(0x1A64748B); // GodTheme.textMuted at 0.1
const _kPrimaryOp07 = Color(0xB36366F1);   // GodTheme.primary (0xFF6366F1) at 0.7
const _kPrimaryOp04 = Color(0x666366F1);   // GodTheme.primary at 0.4
const _kPrimaryOp03 = Color(0x4D6366F1);   // GodTheme.primary at 0.3
const _kPrimaryOp015 = Color(0x266366F1);  // GodTheme.primary at 0.15
const _kPrimaryOp01 = Color(0x1A6366F1);   // GodTheme.primary at 0.1
const _kSuccessOp09 = Color(0xE622C55E);   // GodTheme.success (0xFF22C55E) at 0.9
const _kSuccessOp07 = Color(0xB322C55E);   // GodTheme.success at 0.7
const _kSuccessOp04 = Color(0x6622C55E);   // GodTheme.success at 0.4
const _kSuccessOp03 = Color(0x4D22C55E);   // GodTheme.success at 0.3
const _kSuccessOp02 = Color(0x3322C55E);   // GodTheme.success at 0.2
const _kSuccessOp005 = Color(0x0D22C55E);  // GodTheme.success at 0.05
const _kSkyOp008 = Color(0x140EA5E9);      // Color(0xFF0EA5E9) at 0.08
const _kSkyOp03 = Color(0x4D0EA5E9);       // Color(0xFF0EA5E9) at 0.3

/// Icon for a status name (UI preference, not data-driven).
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

/// Sort options for tickets.
enum TicketSortField { created, deadlineFrom, deadlineTo, priority, status }
enum TicketSortOrder { asc, desc }

/// View modes for tickets.
enum TicketViewMode { list, calendar, todo }

/// Standalone Tickets screen with search, filters, deadlines, sort, and calendar.
class TicketsScreen extends ConsumerStatefulWidget {
  const TicketsScreen({super.key});

  @override
  ConsumerState<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends ConsumerState<TicketsScreen> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  String? _statusFilter;
  String? _priorityFilter;
  bool _showSearch = false;

  // Deadline filter
  DateTime? _deadlineFromFilter;
  DateTime? _deadlineToFilter;

  // Sort
  TicketSortField _sortField = TicketSortField.created;
  TicketSortOrder _sortOrder = TicketSortOrder.desc;

  // View mode
  TicketViewMode _viewMode = TicketViewMode.list;
  bool _userSwitchedMode = false; // prevent auto-switch overriding user choice

  // Calendar
  DateTime _calendarMonth = DateTime(DateTime.now().year, DateTime.now().month);

  // Filter cache
  List<Ticket>? _cachedFilteredTickets;
  List<Ticket>? _lastRawTickets;
  int _lastFilterHash = 0;

  int _filterParamsHash() {
    return Object.hash(_searchQuery, _statusFilter, _priorityFilter,
        _deadlineFromFilter, _deadlineToFilter, _sortField, _sortOrder);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<Ticket> _applyFilters(List<Ticket> tickets) {
    var filtered = tickets;

    // Search filter
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      filtered = filtered.where((t) {
        return t.title.toLowerCase().contains(q) ||
            (t.description?.toLowerCase().contains(q) ?? false) ||
            (t.assignee?.toLowerCase().contains(q) ?? false) ||
            (t.type?.toLowerCase().contains(q) ?? false) ||
            '#${t.id}'.contains(q);
      }).toList();
    }

    // Status filter
    if (_statusFilter != null) {
      filtered = filtered.where((t) =>
          t.status.toLowerCase() == _statusFilter!.toLowerCase()).toList();
    }

    // Priority filter
    if (_priorityFilter != null) {
      filtered = filtered.where((t) =>
          t.priority?.toLowerCase() == _priorityFilter!.toLowerCase()).toList();
    }

    // Deadline from filter
    if (_deadlineFromFilter != null) {
      filtered = filtered.where((t) {
        if (t.deadlineTo != null) {
          return !t.deadlineTo!.isBefore(_deadlineFromFilter!);
        }
        if (t.deadlineFrom != null) {
          return !t.deadlineFrom!.isBefore(_deadlineFromFilter!);
        }
        return false;
      }).toList();
    }

    // Deadline to filter
    if (_deadlineToFilter != null) {
      filtered = filtered.where((t) {
        if (t.deadlineFrom != null) {
          return !t.deadlineFrom!.isAfter(_deadlineToFilter!);
        }
        if (t.deadlineTo != null) {
          return !t.deadlineTo!.isAfter(_deadlineToFilter!);
        }
        return false;
      }).toList();
    }

    // Sort
    filtered = List.from(filtered);
    filtered.sort((a, b) {
      int cmp = 0;
      switch (_sortField) {
        case TicketSortField.created:
          cmp = a.createdAt.compareTo(b.createdAt);
          break;
        case TicketSortField.deadlineFrom:
          final aDate = a.deadlineFrom;
          final bDate = b.deadlineFrom;
          if (aDate == null && bDate == null) {
            cmp = 0;
          } else if (aDate == null) {
            cmp = 1;
          } else if (bDate == null) {
            cmp = -1;
          } else {
            cmp = aDate.compareTo(bDate);
          }
          break;
        case TicketSortField.deadlineTo:
          final aDate = a.deadlineTo;
          final bDate = b.deadlineTo;
          if (aDate == null && bDate == null) {
            cmp = 0;
          } else if (aDate == null) {
            cmp = 1;
          } else if (bDate == null) {
            cmp = -1;
          } else {
            cmp = aDate.compareTo(bDate);
          }
          break;
        case TicketSortField.priority:
          cmp = _priorityRank(a.priority).compareTo(_priorityRank(b.priority));
          break;
        case TicketSortField.status:
          cmp = _statusRank(a.status).compareTo(_statusRank(b.status));
          break;
      }
      return _sortOrder == TicketSortOrder.asc ? cmp : -cmp;
    });

    return filtered;
  }

  /// Get dynamic statuses list (from provider or fallback).
  List<TicketStatus> _getStatuses() {
    return ref.read(ticketStatusesProvider).valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);
  }

  /// Get dynamic priorities list (from provider or fallback).
  List<TicketPriority> _getPriorities() {
    return ref.read(ticketPrioritiesProvider).valueOrNull ?? List<TicketPriority>.from(defaultTicketPriorities);
  }

  /// Get status color dynamically.
  Color _statusColor(String status) {
    return statusColorFromList(status, _getStatuses());
  }

  /// Get priority color dynamically.
  Color _priorityColor(String priority) {
    return priorityColorFromList(priority, _getPriorities());
  }

  int _priorityRank(String? p) {
    if (p == null) return 999;
    final priorities = _getPriorities();
    final lower = p.toLowerCase();
    // Higher level = higher priority = lower rank (sort first)
    for (int i = 0; i < priorities.length; i++) {
      if (priorities[i].name.toLowerCase() == lower) {
        return priorities.length - priorities[i].level;
      }
    }
    return 999;
  }

  int _statusRank(String s) {
    final statuses = _getStatuses();
    final lower = s.toLowerCase().replaceAll('_', ' ');
    for (int i = 0; i < statuses.length; i++) {
      if (statuses[i].name.toLowerCase() == lower) return statuses[i].order;
    }
    // Aliases
    if (lower == 'completed') {
      for (int i = 0; i < statuses.length; i++) {
        if (statuses[i].name.toLowerCase() == 'done') return statuses[i].order;
      }
    }
    return 999;
  }

  bool get _hasActiveFilters =>
      _statusFilter != null ||
      _priorityFilter != null ||
      _deadlineFromFilter != null ||
      _deadlineToFilter != null;

  /// Show space picker bottom sheet.
  void _showSpacePicker(BuildContext context) {
    final spacesAsync = ref.read(spacesProvider);
    final currentSpaceId = ref.read(selectedSpaceProvider);

    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return spacesAsync.when(
          data: (spaces) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 12),
              Container(
                width: 40, height: 4,
                decoration: BoxDecoration(
                  color: GodTheme.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 12),
              const Text('Select Space',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: GodTheme.textPrimary)),
              const SizedBox(height: 8),
              ListTile(
                leading: Icon(Icons.grid_view_rounded,
                    color: currentSpaceId == null ? GodTheme.primary : GodTheme.textMuted),
                title: Text('All Spaces',
                    style: TextStyle(
                      color: currentSpaceId == null ? GodTheme.primary : GodTheme.textPrimary,
                      fontWeight: currentSpaceId == null ? FontWeight.w600 : FontWeight.w400,
                    )),
                trailing: currentSpaceId == null
                    ? const Icon(Icons.check_circle, color: GodTheme.primary, size: 20)
                    : null,
                onTap: () {
                  ref.read(selectedSpaceProvider.notifier).state = null;
                  Navigator.pop(ctx);
                },
              ),
              ...spaces.map((space) {
                final isSelected = currentSpaceId == space.id;
                return ListTile(
                  leading: Icon(Icons.workspaces_outlined,
                      color: isSelected ? GodTheme.primary : GodTheme.textMuted),
                  title: Text(space.name,
                      style: TextStyle(
                        color: isSelected ? GodTheme.primary : GodTheme.textPrimary,
                        fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                      )),
                  trailing: isSelected
                      ? const Icon(Icons.check_circle, color: GodTheme.primary, size: 20)
                      : null,
                  onTap: () {
                    ref.read(selectedSpaceProvider.notifier).state = space.id;
                    Navigator.pop(ctx);
                  },
                );
              }),
              const SizedBox(height: 16),
            ],
          ),
          loading: () => const SizedBox(height: 100, child: Center(child: CircularProgressIndicator())),
          error: (e, _) => SizedBox(height: 100, child: Center(child: Text('Error: $e'))),
        );
      },
    );
  }

  /// Get the current space name for display.
  String _currentSpaceName() {
    final spaceId = ref.watch(selectedSpaceProvider);
    if (spaceId == null) return 'All Spaces';
    final spaces = ref.watch(spacesProvider).valueOrNull ?? [];
    for (final s in spaces) {
      if (s.id == spaceId) return s.name;
    }
    return 'Space #$spaceId';
  }

  @override
  Widget build(BuildContext context) {
    final ticketsAsync = ref.watch(ticketsProvider);
    final selectedSpaceId = ref.watch(selectedSpaceProvider);
    final todoSettings = ref.watch(todoViewProvider);

    // Auto-switch to todo mode on first load if enabled in settings
    // (only once — don't override manual user selection)
    if (todoSettings.enabled && _viewMode == TicketViewMode.list && !_userSwitchedMode) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _viewMode == TicketViewMode.list && !_userSwitchedMode) {
          setState(() => _viewMode = TicketViewMode.todo);
        }
      });
    }

    return Scaffold(
      appBar: AppBar(
        title: _showSearch
            ? TextField(
                controller: _searchController,
                autofocus: true,
                style: const TextStyle(color: GodTheme.textPrimary, fontSize: 16),
                decoration: const InputDecoration(
                  hintText: 'Search tickets...',
                  hintStyle: TextStyle(color: GodTheme.textMuted),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _searchQuery = v),
              )
            : GestureDetector(
                onTap: () => _showSpacePicker(context),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (selectedSpaceId != null) ...[
                      Icon(Icons.workspaces_outlined,
                          size: 18, color: GodTheme.primary),
                      const SizedBox(width: 6),
                    ],
                    Flexible(
                      child: Text(
                        selectedSpaceId != null ? _currentSpaceName() : 'Tickets',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(Icons.arrow_drop_down, size: 20),
                  ],
                ),
              ),
        actions: [
          // Search toggle
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
          // Sort button
          IconButton(
            icon: const Icon(Icons.sort, size: 22),
            tooltip: 'Sort',
            onPressed: () => _showSortSheet(context),
          ),
          // Filter button
          IconButton(
            icon: Badge(
              isLabelVisible: _hasActiveFilters,
              smallSize: 8,
              child: const Icon(Icons.filter_list),
            ),
            onPressed: () => _showFilterSheet(context),
          ),
          // Refresh
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(ticketsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: Column(
        children: [
          // View mode segmented switcher
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            color: GodTheme.surface,
            child: Row(
              children: [
                _ViewModeButton(
                  icon: Icons.list,
                  label: 'Список',
                  isSelected: _viewMode == TicketViewMode.list,
                  onTap: () => setState(() { _viewMode = TicketViewMode.list; _userSwitchedMode = true; }),
                ),
                const SizedBox(width: 6),
                _ViewModeButton(
                  icon: Icons.checklist_rounded,
                  label: 'Задачи',
                  isSelected: _viewMode == TicketViewMode.todo,
                  onTap: () => setState(() { _viewMode = TicketViewMode.todo; _userSwitchedMode = true; }),
                ),
                const SizedBox(width: 6),
                _ViewModeButton(
                  icon: Icons.calendar_month_outlined,
                  label: 'Календарь',
                  isSelected: _viewMode == TicketViewMode.calendar,
                  onTap: () => setState(() { _viewMode = TicketViewMode.calendar; _userSwitchedMode = true; }),
                ),
              ],
            ),
          ),
          // Active filters chips
          if (_hasActiveFilters)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              color: GodTheme.surfaceLight,
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  if (_statusFilter != null)
                    _FilterChip(
                      label: _statusFilter!.replaceAll('_', ' '),
                      color: _statusColor(_statusFilter!),
                      onRemove: () => setState(() => _statusFilter = null),
                    ),
                  if (_priorityFilter != null)
                    _FilterChip(
                      label: _priorityFilter!,
                      color: _priorityColor(_priorityFilter!),
                      onRemove: () => setState(() => _priorityFilter = null),
                    ),
                  if (_deadlineFromFilter != null)
                    _FilterChip(
                      label: 'From: ${DateFormat('dd.MM').format(_deadlineFromFilter!)}',
                      color: const Color(0xFF0EA5E9),
                      onRemove: () => setState(() => _deadlineFromFilter = null),
                    ),
                  if (_deadlineToFilter != null)
                    _FilterChip(
                      label: 'To: ${DateFormat('dd.MM').format(_deadlineToFilter!)}',
                      color: const Color(0xFF0EA5E9),
                      onRemove: () => setState(() => _deadlineToFilter = null),
                    ),
                  GestureDetector(
                    onTap: () => setState(() {
                      _statusFilter = null;
                      _priorityFilter = null;
                      _deadlineFromFilter = null;
                      _deadlineToFilter = null;
                    }),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                      child: Text('Clear all',
                          style: TextStyle(color: GodTheme.primary, fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ),
          // Tickets content (list or calendar)
          Expanded(
            child: ticketsAsync.when(
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
                      onPressed: () => ref.read(ticketsProvider.notifier).refresh(),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (tickets) {
                final filterHash = _filterParamsHash();
                if (!identical(tickets, _lastRawTickets) || filterHash != _lastFilterHash) {
                  _cachedFilteredTickets = _applyFilters(tickets);
                  _lastRawTickets = tickets;
                  _lastFilterHash = filterHash;
                }
                final filtered = _cachedFilteredTickets!;

                if (tickets.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.assignment_outlined, size: 64,
                            color: _kTextMutedOp03),
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

                if (_viewMode == TicketViewMode.todo) {
                  return _TodoView(
                    tickets: filtered,
                    statuses: _getStatuses(),
                    priorities: _getPriorities(),
                    todoSettings: todoSettings,
                    onTicketTap: (t) => _showTicketDetail(context, t),
                    onTicketChat: (t) => _openTicketChat(context, t),
                  );
                }

                if (_viewMode == TicketViewMode.calendar) {
                  return _CalendarView(
                    tickets: filtered,
                    allTickets: tickets,
                    currentMonth: _calendarMonth,
                    onMonthChanged: (m) => setState(() => _calendarMonth = m),
                    onTicketTap: (t) => _showTicketDetail(context, t),
                    statuses: _getStatuses(),
                    priorities: _getPriorities(),
                  );
                }

                if (filtered.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.search_off, size: 64,
                            color: _kTextMutedOp03),
                        const SizedBox(height: 16),
                        const Text('No matching tickets',
                            style: TextStyle(color: GodTheme.textSecondary)),
                        const SizedBox(height: 8),
                        TextButton(
                          onPressed: () => setState(() {
                            _searchController.clear();
                            _searchQuery = '';
                            _statusFilter = null;
                            _priorityFilter = null;
                            _deadlineFromFilter = null;
                            _deadlineToFilter = null;
                          }),
                          child: const Text('Clear filters'),
                        ),
                      ],
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () => ref.read(ticketsProvider.notifier).refresh(),
                  child: ListView.separated(
                    padding: const EdgeInsets.only(top: 4, bottom: 80),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) =>
                        const Divider(height: 1, indent: 16, endIndent: 16),
                    itemBuilder: (context, index) {
                      final ticket = filtered[index];
                      return _TicketTile(key: ValueKey(ticket.id), ticket: ticket);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
      // FAB to create ticket
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCreateTicketDialog(context),
        backgroundColor: GodTheme.primary,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  /// Show sort bottom sheet.
  void _showSortSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40, height: 4,
                  decoration: BoxDecoration(
                    color: _kTextMutedOp03,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text('Sort Tickets',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18,
                      color: GodTheme.textPrimary)),
              const SizedBox(height: 16),

              // Sort field options
              _buildSortOption(ctx, setSheetState, 'Created date', TicketSortField.created, Icons.access_time),
              _buildSortOption(ctx, setSheetState, 'Deadline start', TicketSortField.deadlineFrom, Icons.event),
              _buildSortOption(ctx, setSheetState, 'Deadline end', TicketSortField.deadlineTo, Icons.event_available),
              _buildSortOption(ctx, setSheetState, 'Priority', TicketSortField.priority, Icons.flag),
              _buildSortOption(ctx, setSheetState, 'Status', TicketSortField.status, Icons.circle),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSortOption(BuildContext ctx, StateSetter setSheetState,
      String label, TicketSortField field, IconData icon) {
    final isSelected = _sortField == field;
    return ListTile(
      leading: Icon(icon, color: isSelected ? GodTheme.primary : GodTheme.textMuted, size: 20),
      title: Text(label,
          style: TextStyle(
            color: isSelected ? GodTheme.primary : GodTheme.textPrimary,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
            fontSize: 14,
          )),
      trailing: isSelected
          ? Icon(
              _sortOrder == TicketSortOrder.asc
                  ? Icons.arrow_upward
                  : Icons.arrow_downward,
              color: GodTheme.primary,
              size: 18,
            )
          : null,
      dense: true,
      onTap: () {
        setState(() {
          if (_sortField == field) {
            _sortOrder = _sortOrder == TicketSortOrder.asc
                ? TicketSortOrder.desc
                : TicketSortOrder.asc;
          } else {
            _sortField = field;
            _sortOrder = TicketSortOrder.desc;
          }
        });
        setSheetState(() {});
        Navigator.pop(ctx);
      },
    );
  }

  /// Show filter bottom sheet.
  void _showFilterSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.55,
        minChildSize: 0.3,
        maxChildSize: 0.85,
        expand: false,
        builder: (ctx, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40, height: 4,
                  decoration: BoxDecoration(
                    color: _kTextMutedOp03,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              const Text('Filter Tickets',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18,
                      color: GodTheme.textPrimary)),
              const SizedBox(height: 16),

              // Status filter (dynamic from CRM)
              const Text('Status', style: TextStyle(color: GodTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _buildFilterOption(null, 'All', GodTheme.textMuted,
                      isSelected: _statusFilter == null,
                      onTap: () { setState(() => _statusFilter = null); Navigator.pop(ctx); }),
                  ..._getStatuses().map((s) => _buildFilterOption(
                    s.name, s.name.replaceAll('_', ' '), s.color,
                    isSelected: _statusFilter == s.name,
                    onTap: () { setState(() => _statusFilter = s.name); Navigator.pop(ctx); },
                  )),
                ],
              ),
              const SizedBox(height: 16),

              // Priority filter (dynamic from CRM)
              const Text('Priority', style: TextStyle(color: GodTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  _buildFilterOption(null, 'All', GodTheme.textMuted,
                      isSelected: _priorityFilter == null,
                      onTap: () { setState(() => _priorityFilter = null); Navigator.pop(ctx); }),
                  ..._getPriorities().reversed.map((p) => _buildFilterOption(
                    p.name, p.name, p.color,
                    isSelected: _priorityFilter == p.name,
                    onTap: () { setState(() => _priorityFilter = p.name); Navigator.pop(ctx); },
                  )),
                ],
              ),
              const SizedBox(height: 16),

              // Deadline range filter
              const Text('Deadline Range', style: TextStyle(color: GodTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _DatePickerButton(
                      label: 'From',
                      date: _deadlineFromFilter,
                      onPicked: (d) {
                        setState(() => _deadlineFromFilter = d);
                        Navigator.pop(ctx);
                      },
                      onClear: () {
                        setState(() => _deadlineFromFilter = null);
                        Navigator.pop(ctx);
                      },
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _DatePickerButton(
                      label: 'To',
                      date: _deadlineToFilter,
                      onPicked: (d) {
                        setState(() => _deadlineToFilter = d);
                        Navigator.pop(ctx);
                      },
                      onClear: () {
                        setState(() => _deadlineToFilter = null);
                        Navigator.pop(ctx);
                      },
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterOption(String? value, String label, Color color,
      {required bool isSelected, required VoidCallback onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? color.withOpacity(0.2) : GodTheme.surfaceLight,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isSelected ? color : GodTheme.border,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            color: isSelected ? color : GodTheme.textSecondary,
            fontSize: 11,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }

  /// Show create ticket dialog with space selector.
  void _showEmojiPicker(BuildContext context, ValueChanged<String> onSelected) {
    const emojis = [
      '🎯', '🐛', '🔥', '🚀', '💡', '📝', '🔧', '⚡', '🎨', '📦',
      '🔒', '🌟', '📊', '🎪', '🏗️', '💎', '🎵', '📱', '🖥️', '🌐',
      '✅', '❌', '⚠️', '🔴', '🟢', '🔵', '🟡', '🟣', '⬛', '⬜',
      '🐕', '🦊', '🐱', '🐸', '🦁', '🐙', '🦄', '🐬', '🎲', '🎮',
    ];
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Pick Emoji', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16, color: GodTheme.textPrimary)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: emojis.map((e) => GestureDetector(
                onTap: () {
                  Navigator.pop(ctx);
                  onSelected(e);
                },
                child: Container(
                  width: 40, height: 40,
                  decoration: BoxDecoration(
                    color: GodTheme.surfaceLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Center(child: Text(e, style: const TextStyle(fontSize: 22))),
                ),
              )).toList(),
            ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
  }

  void _showCreateTicketDialog(BuildContext context) {
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    String selectedStatus = 'backlog';
    String selectedPriority = 'medium';
    DateTime? deadlineFrom;
    DateTime? deadlineTo;
    String? selectedEmoji;
    String? selectedColor;

    // Auto-select current space if one is active
    final currentSpaceId = ref.read(selectedSpaceProvider);
    int? selectedSpaceId = currentSpaceId;

    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20, right: 20, top: 16,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: StatefulBuilder(
          builder: (ctx, setSheetState) {
            final spacesAsync = ref.watch(spacesProvider);

            return SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40, height: 4,
                      decoration: BoxDecoration(
                        color: _kTextMutedOp03,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('Create Ticket',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18,
                          color: GodTheme.textPrimary)),
                  const SizedBox(height: 16),

                  // Space selector
                  const Text('Space', style: TextStyle(
                      color: GodTheme.textSecondary, fontSize: 12)),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      color: GodTheme.surfaceLight,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: GodTheme.border),
                    ),
                    child: spacesAsync.when(
                      loading: () => const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                      error: (_, __) => const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: Text('Failed to load spaces',
                            style: TextStyle(color: GodTheme.error, fontSize: 13)),
                      ),
                      data: (spaces) => DropdownButton<int?>(
                        value: selectedSpaceId,
                        isExpanded: true,
                        underline: const SizedBox.shrink(),
                        dropdownColor: GodTheme.surface,
                        hint: const Text('Select space...',
                            style: TextStyle(color: GodTheme.textMuted, fontSize: 13)),
                        style: const TextStyle(color: GodTheme.textPrimary, fontSize: 13),
                        items: spaces.map((s) => DropdownMenuItem<int?>(
                          value: s.id,
                          child: Row(
                            children: [
                              Icon(Icons.workspaces_outlined, size: 16,
                                  color: _kPrimaryOp07),
                              const SizedBox(width: 8),
                              Flexible(child: Text(s.name, overflow: TextOverflow.ellipsis)),
                            ],
                          ),
                        )).toList(),
                        onChanged: (v) {
                          setSheetState(() => selectedSpaceId = v);
                        },
                      ),
                    ),
                  ),
                  if (currentSpaceId != null && selectedSpaceId == currentSpaceId)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        children: [
                          Icon(Icons.auto_fix_high, size: 12, color: _kSuccessOp07),
                          const SizedBox(width: 4),
                          Text('Auto-selected from current space',
                              style: TextStyle(color: _kSuccessOp07, fontSize: 11)),
                        ],
                      ),
                    ),
                  const SizedBox(height: 12),

                  // Title
                  TextField(
                    controller: titleCtrl,
                    style: const TextStyle(color: GodTheme.textPrimary),
                    decoration: const InputDecoration(
                      labelText: 'Title *',
                      hintText: 'Ticket title...',
                    ),
                    autofocus: true,
                  ),
                  const SizedBox(height: 12),

                  // Description
                  TextField(
                    controller: descCtrl,
                    style: const TextStyle(color: GodTheme.textPrimary),
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      hintText: 'Optional description...',
                    ),
                    maxLines: 3,
                    minLines: 1,
                  ),
                  const SizedBox(height: 12),

                  // Status + Priority row (dynamic from CRM)
                  Builder(builder: (_) {
                    final statuses = _getStatuses();
                    final priorities = _getPriorities();
                    // Ensure selected values exist in dynamic lists
                    if (!statuses.any((s) => s.name == selectedStatus)) {
                      selectedStatus = statuses.isNotEmpty ? statuses.first.name : 'backlog';
                    }
                    if (!priorities.any((p) => p.name == selectedPriority)) {
                      selectedPriority = priorities.isNotEmpty
                          ? priorities[priorities.length > 1 ? 1 : 0].name
                          : 'medium';
                    }
                    return Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Status', style: TextStyle(
                                  color: GodTheme.textSecondary, fontSize: 12)),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                                decoration: BoxDecoration(
                                  color: GodTheme.surfaceLight,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: GodTheme.border),
                                ),
                                child: DropdownButton<String>(
                                  value: selectedStatus,
                                  isExpanded: true,
                                  underline: const SizedBox.shrink(),
                                  dropdownColor: GodTheme.surface,
                                  style: const TextStyle(color: GodTheme.textPrimary, fontSize: 13),
                                  items: statuses.map((s) => DropdownMenuItem(
                                    value: s.name,
                                    child: Row(
                                      children: [
                                        Container(
                                          width: 8, height: 8,
                                          decoration: BoxDecoration(
                                            color: s.color,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Flexible(child: Text(s.name.replaceAll('_', ' '),
                                            overflow: TextOverflow.ellipsis)),
                                      ],
                                    ),
                                  )).toList(),
                                  onChanged: (v) {
                                    if (v != null) setSheetState(() => selectedStatus = v);
                                  },
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('Priority', style: TextStyle(
                                  color: GodTheme.textSecondary, fontSize: 12)),
                              const SizedBox(height: 4),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                                decoration: BoxDecoration(
                                  color: GodTheme.surfaceLight,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: GodTheme.border),
                                ),
                                child: DropdownButton<String>(
                                  value: selectedPriority,
                                  isExpanded: true,
                                  underline: const SizedBox.shrink(),
                                  dropdownColor: GodTheme.surface,
                                  style: const TextStyle(color: GodTheme.textPrimary, fontSize: 13),
                                  items: priorities.map((p) => DropdownMenuItem(
                                    value: p.name,
                                    child: Row(
                                      children: [
                                        Container(
                                          width: 8, height: 8,
                                          decoration: BoxDecoration(
                                            color: p.color,
                                            shape: BoxShape.circle,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Text(p.name),
                                      ],
                                    ),
                                  )).toList(),
                                  onChanged: (v) {
                                    if (v != null) setSheetState(() => selectedPriority = v);
                                  },
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    );
                  }),
                  const SizedBox(height: 12),

                  // Emoji + Color row
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Emoji', style: TextStyle(
                                color: GodTheme.textSecondary, fontSize: 12)),
                            const SizedBox(height: 4),
                            GestureDetector(
                              onTap: () {
                                _showEmojiPicker(ctx, (emoji) {
                                  setSheetState(() => selectedEmoji = emoji);
                                });
                              },
                              child: Container(
                                height: 44,
                                decoration: BoxDecoration(
                                  color: GodTheme.surfaceLight,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: GodTheme.border),
                                ),
                                child: Center(
                                  child: selectedEmoji != null
                                      ? Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            Text(selectedEmoji!, style: const TextStyle(fontSize: 20)),
                                            const SizedBox(width: 4),
                                            GestureDetector(
                                              onTap: () => setSheetState(() => selectedEmoji = null),
                                              child: const Icon(Icons.close, size: 14, color: GodTheme.textMuted),
                                            ),
                                          ],
                                        )
                                      : const Text('Pick...', style: TextStyle(color: GodTheme.textMuted, fontSize: 13)),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Color', style: TextStyle(
                                color: GodTheme.textSecondary, fontSize: 12)),
                            const SizedBox(height: 4),
                            Container(
                              height: 44,
                              decoration: BoxDecoration(
                                color: GodTheme.surfaceLight,
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: GodTheme.border),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                children: [
                                  for (final c in const [
                                    '#EF4444', '#F59E0B', '#10B981', '#3B82F6',
                                    '#8B5CF6', '#EC4899', '#6B7280',
                                  ])
                                    GestureDetector(
                                      onTap: () => setSheetState(() =>
                                          selectedColor = selectedColor == c ? null : c),
                                      child: Container(
                                        width: 22, height: 22,
                                        decoration: BoxDecoration(
                                          color: Color(int.parse('FF${c.substring(1)}', radix: 16)),
                                          shape: BoxShape.circle,
                                          border: selectedColor == c
                                              ? Border.all(color: Colors.white, width: 2)
                                              : null,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Deadline from / to
                  const Text('Deadline', style: TextStyle(
                      color: GodTheme.textSecondary, fontSize: 12)),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Expanded(
                        child: _DatePickerButton(
                          label: 'Start',
                          date: deadlineFrom,
                          compact: true,
                          onPicked: (d) => setSheetState(() => deadlineFrom = d),
                          onClear: () => setSheetState(() => deadlineFrom = null),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _DatePickerButton(
                          label: 'Due',
                          date: deadlineTo,
                          compact: true,
                          onPicked: (d) => setSheetState(() => deadlineTo = d),
                          onClear: () => setSheetState(() => deadlineTo = null),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Create button
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        if (titleCtrl.text.trim().isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Title is required')),
                          );
                          return;
                        }
                        Navigator.pop(ctx);
                        _createTicket(
                          context,
                          title: titleCtrl.text.trim(),
                          description: descCtrl.text.trim().isEmpty
                              ? null : descCtrl.text.trim(),
                          status: selectedStatus,
                          priority: selectedPriority,
                          spaceId: selectedSpaceId,
                          deadlineFrom: deadlineFrom,
                          deadlineTo: deadlineTo,
                          emoji: selectedEmoji,
                          color: selectedColor,
                        );
                      },
                      icon: const Icon(Icons.add),
                      label: const Text('Create Ticket'),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  /// Create ticket via API.
  Future<void> _createTicket(
    BuildContext context, {
    required String title,
    String? description,
    required String status,
    required String priority,
    int? spaceId,
    DateTime? deadlineFrom,
    DateTime? deadlineTo,
    String? emoji,
    String? color,
  }) async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final effectiveSpaceId = spaceId ?? ref.read(selectedSpaceProvider);

      // Find the right table for the selected space
      final repo = ref.read(chatRepositoryProvider);
      final tablesResult = await repo.getTables(spaceId: effectiveSpaceId);
      int tableId = 1708; // default

      if (tablesResult.isSuccess && tablesResult.data != null) {
        for (final t in tablesResult.data!) {
          final name = t.name.toLowerCase();
          if (name.contains('ticket') || name == 'my tasks data' || name.contains('task')) {
            tableId = t.id;
            break;
          }
        }
      }

      final data = <String, dynamic>{
        'title': title,
        'status': status,
        'priority': priority,
      };
      if (description != null) data['description'] = description;
      if (emoji != null) data['emoji'] = emoji;
      if (color != null) data['color'] = color;
      if (deadlineFrom != null) {
        data['deadline_from'] = deadlineFrom.toIso8601String().split('T')[0];
      }
      if (deadlineTo != null) {
        data['deadline_to'] = deadlineTo.toIso8601String().split('T')[0];
      }

      await apiClient.post(
        '/tables/$tableId/rows',
        data: {'data': data},
      );

      // Refresh tickets list
      ref.read(ticketsProvider.notifier).refresh();

      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Ticket "$title" created'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to create ticket: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  /// Open chat for a ticket.
  Future<void> _openTicketChat(BuildContext context, Ticket ticket) async {
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
          SnackBar(content: Text('Failed to create chat: $e'),
              backgroundColor: GodTheme.error),
        );
      }
    }
  }

  /// Show ticket detail bottom sheet.
  void _showTicketDetail(BuildContext context, Ticket ticket) {
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.45,
        minChildSize: 0.2,
        maxChildSize: 0.8,
        expand: false,
        builder: (_, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(20),
          child: _TicketDetailContent(ticket: ticket),
        ),
      ),
    );
  }
}

/// Active filter chip with remove button.
class _FilterChip extends StatelessWidget {
  final String label;
  final Color color;
  final VoidCallback onRemove;

  const _FilterChip({
    required this.label,
    required this.color,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.only(left: 8, right: 4, top: 3, bottom: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.3), width: 0.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label.toUpperCase(),
              style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w600)),
          const SizedBox(width: 2),
          GestureDetector(
            onTap: onRemove,
            child: Icon(Icons.close, size: 14, color: color),
          ),
        ],
      ),
    );
  }
}

/// View mode button for segmented switcher.
class _ViewModeButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;

  const _ViewModeButton({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 7),
          decoration: BoxDecoration(
            color: isSelected
                ? _kPrimaryOp015
                : GodTheme.surfaceLight,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: isSelected
                  ? _kPrimaryOp04
                  : GodTheme.border,
              width: isSelected ? 1.5 : 0.5,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16,
                  color: isSelected ? GodTheme.primary : GodTheme.textMuted),
              const SizedBox(width: 4),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                  color: isSelected ? GodTheme.primary : GodTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Date picker button for filter/create forms.
class _DatePickerButton extends StatelessWidget {
  final String label;
  final DateTime? date;
  final ValueChanged<DateTime> onPicked;
  final VoidCallback onClear;
  final bool compact;

  const _DatePickerButton({
    required this.label,
    this.date,
    required this.onPicked,
    required this.onClear,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: date ?? DateTime.now(),
          firstDate: DateTime(2020),
          lastDate: DateTime(2030),
          builder: (context, child) {
            return Theme(
              data: Theme.of(context).copyWith(
                colorScheme: const ColorScheme.dark(
                  primary: GodTheme.primary,
                  surface: GodTheme.surface,
                  onSurface: GodTheme.textPrimary,
                ),
              ),
              child: child!,
            );
          },
        );
        if (picked != null) onPicked(picked);
      },
      onLongPress: date != null ? onClear : null,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 12,
          vertical: compact ? 8 : 10,
        ),
        decoration: BoxDecoration(
          color: date != null
              ? _kSkyOp008
              : GodTheme.surfaceLight,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: date != null
                ? _kSkyOp03
                : GodTheme.border,
          ),
        ),
        child: Row(
          children: [
            Icon(Icons.calendar_today, size: compact ? 14 : 16,
                color: date != null ? const Color(0xFF0EA5E9) : GodTheme.textMuted),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                date != null
                    ? DateFormat('dd.MM.yyyy').format(date!)
                    : label,
                style: TextStyle(
                  color: date != null ? const Color(0xFF0EA5E9) : GodTheme.textMuted,
                  fontSize: compact ? 12 : 13,
                  fontWeight: date != null ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
            if (date != null)
              GestureDetector(
                onTap: onClear,
                child: const Icon(Icons.close, size: 14, color: Color(0xFF0EA5E9)),
              ),
          ],
        ),
      ),
    );
  }
}

/// Calendar view showing tickets by deadline.
class _CalendarView extends StatelessWidget {
  final List<Ticket> tickets;
  final List<Ticket> allTickets;
  final DateTime currentMonth;
  final ValueChanged<DateTime> onMonthChanged;
  final ValueChanged<Ticket> onTicketTap;
  final List<TicketStatus> statuses;
  final List<TicketPriority> priorities;

  const _CalendarView({
    required this.tickets,
    required this.allTickets,
    required this.currentMonth,
    required this.onMonthChanged,
    required this.onTicketTap,
    required this.statuses,
    required this.priorities,
  });

  @override
  Widget build(BuildContext context) {
    final year = currentMonth.year;
    final month = currentMonth.month;
    final firstDay = DateTime(year, month, 1);
    final lastDay = DateTime(year, month + 1, 0);
    final startWeekday = firstDay.weekday; // 1=Mon, 7=Sun
    final daysInMonth = lastDay.day;
    final today = DateTime.now();

    // Build a map of date -> tickets
    final dateTickets = <int, List<Ticket>>{};
    for (final t in tickets) {
      if (t.deadlineFrom != null &&
          t.deadlineFrom!.year == year && t.deadlineFrom!.month == month) {
        dateTickets.putIfAbsent(t.deadlineFrom!.day, () => []).add(t);
      }
      if (t.deadlineTo != null &&
          t.deadlineTo!.year == year && t.deadlineTo!.month == month) {
        final dayTo = t.deadlineTo!.day;
        if (t.deadlineFrom == null ||
            t.deadlineFrom!.day != dayTo ||
            t.deadlineFrom!.month != month ||
            t.deadlineFrom!.year != year) {
          dateTickets.putIfAbsent(dayTo, () => []).add(t);
        }
      }
      if (t.deadlineFrom != null && t.deadlineTo != null &&
          t.deadlineFrom!.isBefore(firstDay) && t.deadlineTo!.isAfter(lastDay)) {
        dateTickets.putIfAbsent(1, () => []).add(t);
      }
    }

    return Column(
      children: [
        // Month header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left, color: GodTheme.textPrimary),
                onPressed: () => onMonthChanged(DateTime(year, month - 1)),
              ),
              GestureDetector(
                onTap: () => onMonthChanged(DateTime(today.year, today.month)),
                child: Text(
                  DateFormat('MMMM yyyy').format(currentMonth),
                  style: const TextStyle(
                    color: GodTheme.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right, color: GodTheme.textPrimary),
                onPressed: () => onMonthChanged(DateTime(year, month + 1)),
              ),
            ],
          ),
        ),

        // Day headers
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Row(
            children: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
                .map((d) => Expanded(
                      child: Center(
                        child: Text(d,
                            style: const TextStyle(
                              color: GodTheme.textMuted,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            )),
                      ),
                    ))
                .toList(),
          ),
        ),
        const SizedBox(height: 4),

        // Calendar grid
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              childAspectRatio: 0.7,
              mainAxisSpacing: 2,
              crossAxisSpacing: 2,
            ),
            // Pad to complete weeks (rows of 7)
            itemCount: (((startWeekday - 1) + daysInMonth + 6) ~/ 7) * 7,
            itemBuilder: (context, index) {
              if (index < startWeekday - 1) {
                return const SizedBox.shrink();
              }

              final day = index - (startWeekday - 1) + 1;
              if (day > daysInMonth) return const SizedBox.shrink();

              final isToday = today.year == year && today.month == month && today.day == day;
              final dayTicketList = dateTickets[day] ?? [];

              return GestureDetector(
                onTap: dayTicketList.isNotEmpty
                    ? () => _showDayTickets(context, day, dayTicketList)
                    : null,
                child: Container(
                  margin: const EdgeInsets.all(1),
                  decoration: BoxDecoration(
                    color: isToday
                        ? _kPrimaryOp01
                        : dayTicketList.isNotEmpty
                            ? GodTheme.surfaceLight
                            : null,
                    borderRadius: BorderRadius.circular(6),
                    border: isToday
                        ? Border.all(color: _kPrimaryOp03)
                        : null,
                  ),
                  child: Column(
                    children: [
                      const SizedBox(height: 2),
                      Text(
                        '$day',
                        style: TextStyle(
                          color: isToday ? GodTheme.primary : GodTheme.textPrimary,
                          fontSize: 12,
                          fontWeight: isToday ? FontWeight.w700 : FontWeight.w400,
                        ),
                      ),
                      const SizedBox(height: 2),
                      ...dayTicketList.take(3).map((t) {
                        final sc = statusColorFromList(t.status, statuses);
                        return Container(
                          width: double.infinity,
                          margin: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
                          padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
                          decoration: BoxDecoration(
                            color: sc.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(2),
                          ),
                          child: Text(
                            t.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: sc,
                              fontSize: 7,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        );
                      }),
                      if (dayTicketList.length > 3)
                        Text(
                          '+${dayTicketList.length - 3}',
                          style: const TextStyle(
                            color: GodTheme.textMuted,
                            fontSize: 8,
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  void _showDayTickets(BuildContext context, int day, List<Ticket> dayTickets) {
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
            Center(
              child: Container(
                width: 40, height: 4,
                decoration: BoxDecoration(
                  color: _kTextMutedOp03,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                '${DateFormat('MMMM').format(currentMonth)} $day — ${dayTickets.length} ticket${dayTickets.length != 1 ? 's' : ''}',
                style: const TextStyle(
                  fontWeight: FontWeight.w600, fontSize: 16,
                  color: GodTheme.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 8),
            ...dayTickets.map((t) {
              final sc = statusColorFromList(t.status, statuses);
              return ListTile(
                leading: Container(
                  width: 36, height: 36,
                  decoration: BoxDecoration(
                    color: sc.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(_iconForStatus(t.status), color: sc, size: 18),
                ),
                title: Text(t.title, maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, color: GodTheme.textPrimary)),
                subtitle: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: sc.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(3),
                      ),
                      child: Text(t.status.replaceAll('_', ' '),
                          style: TextStyle(color: sc, fontSize: 10, fontWeight: FontWeight.w600)),
                    ),
                    if (t.priority != null) ...[
                      const SizedBox(width: 4),
                      Builder(builder: (_) {
                        final pc = priorityColorFromList(t.priority!, priorities);
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: pc.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: Text(t.priority!,
                              style: TextStyle(color: pc, fontSize: 10)),
                        );
                      }),
                    ],
                  ],
                ),
                trailing: const Icon(Icons.info_outline, size: 18, color: GodTheme.textMuted),
                onTap: () {
                  Navigator.pop(ctx);
                  onTicketTap(t);
                },
              );
            }),
          ],
        ),
      ),
    );
  }
}

/// Single ticket tile with status change, deadline display, and chat button.
class _TicketTile extends ConsumerWidget {
  final Ticket ticket;

  const _TicketTile({super.key, required this.ticket});

  /// Get status color from dynamic list.
  Color _dynStatusColor(WidgetRef ref) {
    final statuses = ref.read(ticketStatusesProvider).valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);
    return statusColorFromList(ticket.status, statuses);
  }

  /// Get priority color from dynamic list.
  Color _dynPriorityColor(String priority, WidgetRef ref) {
    final priorities = ref.read(ticketPrioritiesProvider).valueOrNull ?? List<TicketPriority>.from(defaultTicketPriorities);
    return priorityColorFromList(priority, priorities);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasDeadline = ticket.deadlineFrom != null || ticket.deadlineTo != null;
    final sColor = _dynStatusColor(ref);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: GestureDetector(
        onTap: () => _showStatusPicker(context, ref),
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: ticket.color != null
                ? _parseHexColor(ticket.color!).withOpacity(0.15)
                : sColor.withOpacity(0.15),
            borderRadius: BorderRadius.circular(10),
            border: ticket.color != null
                ? Border.all(color: _parseHexColor(ticket.color!).withOpacity(0.3), width: 1)
                : null,
          ),
          child: ticket.emoji != null
              ? Center(child: Text(ticket.emoji!, style: const TextStyle(fontSize: 20)))
              : Icon(
                  _iconForStatus(ticket.status),
                  color: sColor,
                  size: 20,
                ),
        ),
      ),
      title: Row(
        children: [
          if (ticket.emoji != null) ...[
            Text(ticket.emoji!, style: const TextStyle(fontSize: 16)),
            const SizedBox(width: 6),
          ],
          Expanded(
            child: Text(
              ticket.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w500, fontSize: 14),
            ),
          ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
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
                GestureDetector(
                  onTap: () => _showPriorityPicker(context, ref),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                    decoration: BoxDecoration(
                      color: _dynPriorityColor(ticket.priority!, ref).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(3),
                      border: Border.all(color: _dynPriorityColor(ticket.priority!, ref).withOpacity(0.3), width: 0.5),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          ticket.priority!,
                          style: TextStyle(color: _dynPriorityColor(ticket.priority!, ref), fontSize: 10, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(width: 2),
                        Icon(Icons.arrow_drop_down, size: 12, color: _dynPriorityColor(ticket.priority!, ref)),
                      ],
                    ),
                  ),
                ),
              if (ticket.phase != null)
                _buildChip(ticket.phase!, const Color(0xFF14B8A6)),
            ],
          ),
          // Deadline display
          if (hasDeadline)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                children: [
                  Icon(Icons.schedule, size: 12,
                      color: _isOverdue(ticket)
                          ? const Color(0xFFEF4444)
                          : const Color(0xFF0EA5E9)),
                  const SizedBox(width: 3),
                  Text(
                    _formatDeadlineRange(ticket),
                    style: TextStyle(
                      color: _isOverdue(ticket)
                          ? const Color(0xFFEF4444)
                          : const Color(0xFF0EA5E9),
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
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
                    Icon(Icons.link, size: 12, color: _kPrimaryOp07),
                    const SizedBox(width: 3),
                    Flexible(
                      child: Text(
                        ticket.adrRef!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: _kPrimaryOp07, fontSize: 11),
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

  bool _isOverdue(Ticket t) {
    if (t.deadlineTo == null) return false;
    if (t.status.toLowerCase() == 'done' || t.status.toLowerCase() == 'completed') return false;
    return t.deadlineTo!.isBefore(DateTime.now());
  }

  String _formatDeadlineRange(Ticket t) {
    final df = DateFormat('dd.MM');
    if (t.deadlineFrom != null && t.deadlineTo != null) {
      return '${df.format(t.deadlineFrom!)} - ${df.format(t.deadlineTo!)}';
    }
    if (t.deadlineFrom != null) return 'Start: ${df.format(t.deadlineFrom!)}';
    if (t.deadlineTo != null) {
      if (_isOverdue(t)) return 'Overdue: ${df.format(t.deadlineTo!)}';
      return 'Due: ${df.format(t.deadlineTo!)}';
    }
    return '';
  }

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

  Color _parseHexColor(String hex) {
    final clean = hex.replaceAll('#', '');
    if (clean.length == 6) return Color(int.parse('FF$clean', radix: 16));
    if (clean.length == 8) return Color(int.parse(clean, radix: 16));
    return const Color(0xFF6B7280);
  }

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
              child: const Text('Change Status',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16,
                      color: GodTheme.textPrimary)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(ticket.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: GodTheme.textMuted, fontSize: 13)),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            ...statuses.map((s) {
              final isSelected = s.name.toLowerCase() ==
                  ticket.status.toLowerCase().replaceAll('_', ' ');
              return ListTile(
                leading: Container(
                  width: 32, height: 32,
                  decoration: BoxDecoration(
                    color: s.color.withOpacity(isSelected ? 0.25 : 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(_iconForStatus(s.name), color: s.color, size: 18),
                ),
                title: Text(s.name.replaceAll('_', ' ').toUpperCase(),
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? s.color : GodTheme.textPrimary,
                      fontSize: 14,
                    )),
                trailing: isSelected
                    ? Icon(Icons.check_circle, color: s.color, size: 20)
                    : null,
                onTap: () {
                  Navigator.pop(ctx);
                  if (!isSelected) _updateTicketStatus(context, ref, s.name);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _updateTicketStatus(BuildContext context, WidgetRef ref, String newStatus) async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final tableId = ticket.tableId ?? 1708;
      await apiClient.put('/tables/$tableId/rows/${ticket.id}',
          data: {'data': {'status': newStatus}});
      ref.read(ticketsProvider.notifier).refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Status updated to ${newStatus.replaceAll('_', ' ')}'),
              duration: const Duration(seconds: 2)),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update status: $e'),
              backgroundColor: GodTheme.error),
        );
      }
    }
  }

  void _showPriorityPicker(BuildContext context, WidgetRef ref) {
    final priorities = ref.read(ticketPrioritiesProvider).valueOrNull ?? List<TicketPriority>.from(defaultTicketPriorities);
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
              child: const Text('Change Priority',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16,
                      color: GodTheme.textPrimary)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(ticket.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: GodTheme.textMuted, fontSize: 13)),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            ...priorities.map((p) {
              final isSelected = p.name.toLowerCase() ==
                  (ticket.priority?.toLowerCase() ?? '');
              return ListTile(
                leading: Container(
                  width: 32, height: 32,
                  decoration: BoxDecoration(
                    color: p.color.withOpacity(isSelected ? 0.25 : 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.flag, color: p.color, size: 18),
                ),
                title: Text(p.name.toUpperCase(),
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? p.color : GodTheme.textPrimary,
                      fontSize: 14,
                    )),
                trailing: isSelected
                    ? Icon(Icons.check_circle, color: p.color, size: 20)
                    : null,
                onTap: () {
                  Navigator.pop(ctx);
                  if (!isSelected) _updateTicketPriority(context, ref, p.name);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _updateTicketPriority(BuildContext context, WidgetRef ref, String newPriority) async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final tableId = ticket.tableId ?? 1708;
      await apiClient.put('/tables/$tableId/rows/${ticket.id}',
          data: {'data': {'priority': newPriority}});
      ref.read(ticketsProvider.notifier).refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Priority updated to $newPriority'),
              duration: const Duration(seconds: 2)),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update priority: $e'),
              backgroundColor: GodTheme.error),
        );
      }
    }
  }

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
          SnackBar(content: Text('Failed to create chat: $e'),
              backgroundColor: GodTheme.error),
        );
      }
    }
  }

  void _showTicketDetail(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.45,
        minChildSize: 0.2,
        maxChildSize: 0.8,
        expand: false,
        builder: (_, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(20),
          child: _TicketDetailContent(ticket: ticket),
        ),
      ),
    );
  }
}

/// Ticket detail content (shared between tile and calendar tap).
class _TicketDetailContent extends ConsumerWidget {
  final Ticket ticket;

  const _TicketDetailContent({required this.ticket});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statuses = ref.read(ticketStatusesProvider).valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);
    final priorities = ref.read(ticketPrioritiesProvider).valueOrNull ?? List<TicketPriority>.from(defaultTicketPriorities);
    final sColor = statusColorFromList(ticket.status, statuses);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: Container(
            width: 40, height: 4,
            decoration: BoxDecoration(
              color: _kTextMutedOp03,
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
              child: Text(ticket.status.replaceAll('_', ' ').toUpperCase(),
                  style: TextStyle(color: sColor, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
            const SizedBox(width: 8),
            Text('#${ticket.id}', style: const TextStyle(color: GodTheme.textMuted, fontSize: 13)),
            const Spacer(),
            if (ticket.priority != null)
              Text(ticket.priority!, style: const TextStyle(color: GodTheme.textMuted, fontSize: 12)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            if (ticket.emoji != null) ...[
              Text(ticket.emoji!, style: const TextStyle(fontSize: 24)),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: Text(ticket.title,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: GodTheme.textPrimary)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8, runSpacing: 6,
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
        // Deadline section
        if (ticket.deadlineFrom != null || ticket.deadlineTo != null) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(Icons.schedule, size: 16, color: Color(0xFF0EA5E9)),
              const SizedBox(width: 6),
              if (ticket.deadlineFrom != null)
                Text('From: ${DateFormat('dd.MM.yyyy').format(ticket.deadlineFrom!)}  ',
                    style: const TextStyle(color: Color(0xFF0EA5E9), fontSize: 13)),
              if (ticket.deadlineTo != null)
                Text('To: ${DateFormat('dd.MM.yyyy').format(ticket.deadlineTo!)}',
                    style: const TextStyle(color: Color(0xFF0EA5E9), fontSize: 13)),
            ],
          ),
        ],
        if (ticket.assignee != null) ...[
          const SizedBox(height: 12),
          Row(children: [
            const Icon(Icons.person_outline, size: 16, color: GodTheme.textMuted),
            const SizedBox(width: 6),
            Text('Assigned: ${ticket.assignee!}',
                style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13)),
          ]),
        ],
        if (ticket.description != null) ...[
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Text(ticket.description!,
              style: const TextStyle(color: GodTheme.textSecondary, fontSize: 14, height: 1.5)),
        ],
        const SizedBox(height: 20),
        // Chat button
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: () async {
              Navigator.pop(context);
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
                    SnackBar(content: Text('Ошибка: $e'), backgroundColor: GodTheme.error),
                  );
                }
              }
            },
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            label: const Text('Открыть чат'),
            style: ElevatedButton.styleFrom(
              backgroundColor: GodTheme.primary,
              foregroundColor: Colors.white,
            ),
          ),
        ),
        const SizedBox(height: 12),
      ],
    );
  }

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
}

// ============================================================================
// Todo View — checklist mode with dopamine feedback
// ============================================================================

/// Todo view that shows tickets as a checklist with completion animations.
class _TodoView extends ConsumerStatefulWidget {
  final List<Ticket> tickets;
  final List<TicketStatus> statuses;
  final List<TicketPriority> priorities;
  final TodoViewSettings todoSettings;
  final ValueChanged<Ticket> onTicketTap;
  final ValueChanged<Ticket>? onTicketChat;

  const _TodoView({
    required this.tickets,
    required this.statuses,
    required this.priorities,
    required this.todoSettings,
    required this.onTicketTap,
    this.onTicketChat,
  });

  @override
  ConsumerState<_TodoView> createState() => _TodoViewState();
}

class _TodoViewState extends ConsumerState<_TodoView> {
  /// Tracks tickets that were just completed (for animation).
  final Set<int> _justCompleted = {};

  List<Ticket> _filterForTodoView(List<Ticket> tickets) {
    final visible = widget.todoSettings.visibleStatuses;
    if (visible.isEmpty) return tickets;
    return tickets.where((t) {
      final normalized = t.status.toLowerCase().replaceAll('_', ' ');
      return visible.any((v) => v.toLowerCase() == normalized);
    }).toList();
  }

  bool _isDone(Ticket t) {
    final doneStatus = widget.todoSettings.doneStatus.toLowerCase().replaceAll('_', ' ');
    final ticketStatus = t.status.toLowerCase().replaceAll('_', ' ');
    // Also match "done" and "completed" as final
    return ticketStatus == doneStatus ||
        ticketStatus == 'done' ||
        ticketStatus == 'completed' ||
        ticketStatus == 'rejected';
  }

  Future<void> _markDone(Ticket ticket) async {
    final doneStatus = widget.todoSettings.doneStatus;
    try {
      HapticFeedback.mediumImpact();
      setState(() => _justCompleted.add(ticket.id));

      final apiClient = ref.read(apiClientProvider);
      final tableId = ticket.tableId ?? 1708;
      await apiClient.put('/tables/$tableId/rows/${ticket.id}',
          data: {'data': {'status': doneStatus}});

      // Show dopamine snackbar
      if (mounted) {
        _showDopamineOverlay(context);
      }

      // Wait for animation then refresh
      await Future.delayed(const Duration(milliseconds: 800));
      ref.read(ticketsProvider.notifier).refresh();
    } catch (e) {
      setState(() => _justCompleted.remove(ticket.id));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Ошибка: $e'), backgroundColor: GodTheme.error),
        );
      }
    }
  }

  Future<void> _updateStatus(Ticket ticket, String newStatus) async {
    try {
      HapticFeedback.lightImpact();
      final apiClient = ref.read(apiClientProvider);
      final tableId = ticket.tableId ?? 1708;
      await apiClient.put('/tables/$tableId/rows/${ticket.id}',
          data: {'data': {'status': newStatus}});
      ref.read(ticketsProvider.notifier).refresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Статус: ${newStatus.replaceAll('_', ' ')}'),
            duration: const Duration(seconds: 1),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Ошибка: $e'), backgroundColor: GodTheme.error),
        );
      }
    }
  }

  void _showDopamineOverlay(BuildContext context) {
    final phrases = [
      'Отлично!',
      'Молодец!',
      'Супер!',
      'Красавчик!',
      'Так держать!',
      'Огонь!',
      'Круто!',
      'Мега!',
    ];
    final phrase = phrases[Random().nextInt(phrases.length)];

    final overlay = Overlay.of(context);
    late OverlayEntry entry;

    entry = OverlayEntry(
      builder: (ctx) => _DopamineOverlay(
        phrase: phrase,
        onDone: () => entry.remove(),
      ),
    );

    overlay.insert(entry);
  }

  void _showStatusPickerForTodo(BuildContext context, Ticket ticket) {
    HapticFeedback.lightImpact();
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
              child: const Text('Изменить статус',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16,
                      color: GodTheme.textPrimary)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(ticket.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: GodTheme.textMuted, fontSize: 13)),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            ...widget.statuses.map((s) {
              final isSelected = s.name.toLowerCase() ==
                  ticket.status.toLowerCase().replaceAll('_', ' ');
              return ListTile(
                leading: Container(
                  width: 32, height: 32,
                  decoration: BoxDecoration(
                    color: s.color.withOpacity(isSelected ? 0.25 : 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(_iconForStatus(s.name), color: s.color, size: 18),
                ),
                title: Text(s.name.replaceAll('_', ' ').toUpperCase(),
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? s.color : GodTheme.textPrimary,
                      fontSize: 14,
                    )),
                trailing: isSelected
                    ? Icon(Icons.check_circle, color: s.color, size: 20)
                    : null,
                onTap: () {
                  Navigator.pop(ctx);
                  if (!isSelected) _updateStatus(ticket, s.name);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filterForTodoView(widget.tickets);

    if (filtered.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.task_alt, size: 64,
                color: _kSuccessOp03),
            const SizedBox(height: 16),
            const Text('Все задачи выполнены!',
                style: TextStyle(color: GodTheme.textSecondary, fontSize: 16)),
            const SizedBox(height: 8),
            const Text('Или нет задач с выбранными статусами',
                style: TextStyle(color: GodTheme.textMuted, fontSize: 13)),
          ],
        ),
      );
    }

    // Separate done and not-done
    final pending = filtered.where((t) => !_isDone(t)).toList();
    final done = filtered.where((t) => _isDone(t)).toList();

    return RefreshIndicator(
      onRefresh: () => ref.read(ticketsProvider.notifier).refresh(),
      child: ListView(
        padding: const EdgeInsets.only(top: 8, bottom: 80),
        children: [
          // Pending count header
          if (pending.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(
                'Задачи (${pending.length})',
                style: const TextStyle(
                  color: GodTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ),
          // Pending tickets
          ...pending.map((t) => _TodoTicketTile(
            key: ValueKey('todo-${t.id}'),
            ticket: t,
            isDone: false,
            isAnimating: _justCompleted.contains(t.id),
            statuses: widget.statuses,
            onCheck: () => _markDone(t),
            onLongPressCheck: () => _showStatusPickerForTodo(context, t),
            onTap: () => widget.onTicketTap(t),
            onChat: widget.onTicketChat != null ? () => widget.onTicketChat!(t) : null,
          )),
          // Done section
          if (done.isNotEmpty) ...[
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(
                'Выполнено (${done.length})',
                style: const TextStyle(
                  color: GodTheme.success,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.5,
                ),
              ),
            ),
            ...done.map((t) => _TodoTicketTile(
              key: ValueKey('todo-done-${t.id}'),
              ticket: t,
              isDone: true,
              isAnimating: false,
              statuses: widget.statuses,
              onCheck: () {}, // Already done
              onLongPressCheck: () => _showStatusPickerForTodo(context, t),
              onTap: () => widget.onTicketTap(t),
              onChat: widget.onTicketChat != null ? () => widget.onTicketChat!(t) : null,
            )),
          ],
        ],
      ),
    );
  }
}

/// Single todo ticket tile with animated checkbox.
class _TodoTicketTile extends StatefulWidget {
  final Ticket ticket;
  final bool isDone;
  final bool isAnimating;
  final List<TicketStatus> statuses;
  final VoidCallback onCheck;
  final VoidCallback onLongPressCheck;
  final VoidCallback onTap;
  final VoidCallback? onChat;

  const _TodoTicketTile({
    super.key,
    required this.ticket,
    required this.isDone,
    required this.isAnimating,
    required this.statuses,
    required this.onCheck,
    required this.onLongPressCheck,
    required this.onTap,
    this.onChat,
  });

  @override
  State<_TodoTicketTile> createState() => _TodoTicketTileState();
}

class _TodoTicketTileState extends State<_TodoTicketTile>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnim;
  late Animation<double> _strikeAnim;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _scaleAnim = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.15), weight: 30),
      TweenSequenceItem(tween: Tween(begin: 1.15, end: 0.95), weight: 30),
      TweenSequenceItem(tween: Tween(begin: 0.95, end: 1.0), weight: 40),
    ]).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
    _strikeAnim = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: const Interval(0.2, 0.8)),
    );
  }

  @override
  void didUpdateWidget(_TodoTicketTile old) {
    super.didUpdateWidget(old);
    if (widget.isAnimating && !old.isAnimating) {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color _statusColor() {
    return statusColorFromList(widget.ticket.status, widget.statuses);
  }

  @override
  Widget build(BuildContext context) {
    final sColor = _statusColor();
    final isDone = widget.isDone || widget.isAnimating;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Transform.scale(
          scale: widget.isAnimating ? _scaleAnim.value : 1.0,
          child: child,
        );
      },
      child: InkWell(
        onTap: widget.onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
          decoration: BoxDecoration(
            color: isDone
                ? _kSuccessOp005
                : GodTheme.surfaceLight,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isDone
                  ? _kSuccessOp02
                  : sColor.withOpacity(0.15),
              width: 0.5,
            ),
          ),
          child: Row(
            children: [
              // Checkbox
              GestureDetector(
                onTap: isDone ? null : widget.onCheck,
                onLongPress: widget.onLongPressCheck,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: isDone
                        ? GodTheme.success
                        : sColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: isDone ? GodTheme.success : sColor.withOpacity(0.4),
                      width: isDone ? 0 : 1.5,
                    ),
                  ),
                  child: isDone
                      ? const Icon(Icons.check_rounded, color: Colors.white, size: 18)
                      : null,
                ),
              ),
              const SizedBox(width: 12),
              // Content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title with strikethrough animation
                    AnimatedBuilder(
                      animation: _strikeAnim,
                      builder: (context, _) {
                        return Text(
                          widget.ticket.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                            color: isDone
                                ? GodTheme.textMuted
                                : GodTheme.textPrimary,
                            decoration: isDone
                                ? TextDecoration.lineThrough
                                : TextDecoration.none,
                            decorationColor: GodTheme.success,
                            decorationThickness: 2,
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 4),
                    // Meta row
                    Row(
                      children: [
                        // Status chip
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: sColor.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: Text(
                            widget.ticket.status.replaceAll('_', ' '),
                            style: TextStyle(color: sColor, fontSize: 9, fontWeight: FontWeight.w600),
                          ),
                        ),
                        if (widget.ticket.priority != null) ...[
                          const SizedBox(width: 4),
                          Builder(builder: (_) {
                            final pc = priorityColorFromList(
                                widget.ticket.priority!,
                                widget.statuses.isEmpty
                                    ? defaultTicketPriorities
                                    : // Use priorities from somewhere
                                    defaultTicketPriorities);
                            return Container(
                              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                              decoration: BoxDecoration(
                                color: pc.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(3),
                              ),
                              child: Text(widget.ticket.priority!,
                                  style: TextStyle(color: pc, fontSize: 9)),
                            );
                          }),
                        ],
                        if (widget.ticket.deadlineTo != null) ...[
                          const SizedBox(width: 4),
                          Icon(Icons.schedule, size: 10,
                              color: widget.ticket.deadlineTo!.isBefore(DateTime.now()) && !isDone
                                  ? const Color(0xFFEF4444)
                                  : GodTheme.textMuted),
                          const SizedBox(width: 2),
                          Text(
                            DateFormat('dd.MM').format(widget.ticket.deadlineTo!),
                            style: TextStyle(
                              fontSize: 10,
                              color: widget.ticket.deadlineTo!.isBefore(DateTime.now()) && !isDone
                                  ? const Color(0xFFEF4444)
                                  : GodTheme.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              // Action buttons
              const SizedBox(width: 4),
              // Info button
              GestureDetector(
                onTap: widget.onTap,
                child: Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: _kTextMutedOp01,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(Icons.info_outline, size: 16, color: GodTheme.textSecondary),
                ),
              ),
              const SizedBox(width: 4),
              // Chat button
              if (widget.onChat != null)
                GestureDetector(
                  onTap: widget.onChat,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: _kPrimaryOp01,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Icon(Icons.chat_bubble_outline, size: 16, color: GodTheme.primary),
                  ),
                ),
              const SizedBox(width: 4),
              // Status color indicator
              Container(
                width: 4,
                height: 36,
                decoration: BoxDecoration(
                  color: isDone ? GodTheme.success : sColor,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// AnimatedBuilder helper (since Flutter's is AnimatedBuilder).
/// This is just Flutter's AnimatedBuilder re-used for clarity.

/// Dopamine overlay — shows a congratulatory message with particles.
class _DopamineOverlay extends StatefulWidget {
  final String phrase;
  final VoidCallback onDone;

  const _DopamineOverlay({required this.phrase, required this.onDone});

  @override
  State<_DopamineOverlay> createState() => _DopamineOverlayState();
}

class _DopamineOverlayState extends State<_DopamineOverlay>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnim;
  late Animation<double> _opacityAnim;
  late List<_Particle> _particles;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );
    _scaleAnim = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 0.3, end: 1.2), weight: 25),
      TweenSequenceItem(tween: Tween(begin: 1.2, end: 1.0), weight: 15),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.0), weight: 30),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 0.0), weight: 30),
    ]).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOut));
    _opacityAnim = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 0.0, end: 1.0), weight: 15),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 1.0), weight: 55),
      TweenSequenceItem(tween: Tween(begin: 1.0, end: 0.0), weight: 30),
    ]).animate(_controller);

    final rng = Random();
    _particles = List.generate(12, (_) => _Particle(
      angle: rng.nextDouble() * 2 * pi,
      speed: 60 + rng.nextDouble() * 100,
      color: [
        GodTheme.success,
        GodTheme.primary,
        const Color(0xFFF59E0B),
        const Color(0xFFEF4444),
        const Color(0xFF8B5CF6),
        const Color(0xFF0EA5E9),
      ][rng.nextInt(6)],
      size: 4 + rng.nextDouble() * 6,
    ));

    _controller.forward().then((_) => widget.onDone());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final progress = _controller.value;
        return IgnorePointer(
          child: Stack(
            children: [
              // Center text
              Center(
                child: Opacity(
                  opacity: _opacityAnim.value,
                  child: Transform.scale(
                    scale: _scaleAnim.value,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      decoration: BoxDecoration(
                        color: _kSuccessOp09,
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: _kSuccessOp04,
                            blurRadius: 20,
                            spreadRadius: 5,
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.star_rounded, color: Colors.white, size: 24),
                          const SizedBox(width: 8),
                          Text(widget.phrase,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              // Particles
              ...(_particles.map((p) {
                final dx = cos(p.angle) * p.speed * progress;
                final dy = sin(p.angle) * p.speed * progress - 30 * progress;
                final size = MediaQuery.of(context).size;
                return Positioned(
                  left: size.width / 2 + dx - p.size / 2,
                  top: size.height / 2 + dy - p.size / 2,
                  child: Opacity(
                    opacity: (1 - progress).clamp(0.0, 1.0),
                    child: Container(
                      width: p.size,
                      height: p.size,
                      decoration: BoxDecoration(
                        color: p.color,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                );
              })),
            ],
          ),
        );
      },
    );
  }
}

class _Particle {
  final double angle;
  final double speed;
  final Color color;
  final double size;

  _Particle({
    required this.angle,
    required this.speed,
    required this.color,
    required this.size,
  });
}
