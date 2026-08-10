import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/theme.dart';
import '../../../shared/utils/api_client.dart';
import '../../chat/providers/conversations_provider.dart';
import '../data/documents_repository.dart';
import '../providers/documents_provider.dart';
import 'document_detail_screen.dart';

/// Documents list screen.
class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  final _searchCtrl = TextEditingController();
  bool _showSearch = false;

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  bool get _hasActiveFilters =>
      ref.read(documentsStatusFilterProvider) != null ||
      ref.read(documentsTypeFilterProvider) != null ||
      ref.read(documentsSpaceFilterProvider) != null;

  void _showFilterSheet(BuildContext context) {
    final statusesAsync = ref.read(documentStatusesProvider);
    final typesAsync = ref.read(documentTypesProvider);
    final spacesAsync = ref.read(spacesProvider);
    final currentStatus = ref.read(documentsStatusFilterProvider);
    final currentType = ref.read(documentsTypeFilterProvider);
    final currentSpace = ref.read(documentsSpaceFilterProvider);

    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.8,
        expand: false,
        builder: (ctx, scrollController) => SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40, height: 4,
                  decoration: BoxDecoration(
                    color: GodTheme.textMuted.withOpacity(0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  const Text('Фильтры документов',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18,
                          color: GodTheme.textPrimary)),
                  const Spacer(),
                  if (_hasActiveFilters)
                    TextButton(
                      onPressed: () {
                        ref.read(documentsStatusFilterProvider.notifier).state = null;
                        ref.read(documentsTypeFilterProvider.notifier).state = null;
                        ref.read(documentsSpaceFilterProvider.notifier).state = null;
                        Navigator.pop(ctx);
                      },
                      child: const Text('Сбросить',
                          style: TextStyle(color: GodTheme.primary, fontSize: 13)),
                    ),
                ],
              ),
              const SizedBox(height: 16),

              // Space filter
              const Text('Пространство', style: TextStyle(color: GodTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              spacesAsync.when(
                loading: () => const SizedBox(height: 32, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                error: (_, __) => const Text('Ошибка загрузки', style: TextStyle(color: GodTheme.error)),
                data: (spaces) => Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _buildFilterChip(null, 'Все', GodTheme.textMuted,
                        isSelected: currentSpace == null,
                        onTap: () {
                          ref.read(documentsSpaceFilterProvider.notifier).state = null;
                          Navigator.pop(ctx);
                        }),
                    ...spaces.map((s) => _buildFilterChip(
                      s.id, s.name, GodTheme.primary,
                      isSelected: currentSpace == s.id,
                      onTap: () {
                        ref.read(documentsSpaceFilterProvider.notifier).state = s.id;
                        Navigator.pop(ctx);
                      },
                    )),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Status filter
              const Text('Статус', style: TextStyle(color: GodTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              statusesAsync.when(
                loading: () => const SizedBox(height: 32, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                error: (_, __) => const Text('Ошибка загрузки', style: TextStyle(color: GodTheme.error)),
                data: (statuses) => Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _buildFilterChip(null, 'Все', GodTheme.textMuted,
                        isSelected: currentStatus == null,
                        onTap: () {
                          ref.read(documentsStatusFilterProvider.notifier).state = null;
                          Navigator.pop(ctx);
                        }),
                    ...statuses.map((s) => _buildFilterChip(
                      s, s, _statusColor(s),
                      isSelected: currentStatus == s,
                      onTap: () {
                        ref.read(documentsStatusFilterProvider.notifier).state = s;
                        Navigator.pop(ctx);
                      },
                    )),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Type filter
              const Text('Тип', style: TextStyle(color: GodTheme.textSecondary,
                  fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              typesAsync.when(
                loading: () => const SizedBox(height: 32, child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
                error: (_, __) => const Text('Ошибка загрузки', style: TextStyle(color: GodTheme.error)),
                data: (types) {
                  if (types.isEmpty) {
                    return const Text('Нет типов', style: TextStyle(color: GodTheme.textMuted, fontSize: 13));
                  }
                  return Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      _buildFilterChip(null, 'Все', GodTheme.textMuted,
                          isSelected: currentType == null,
                          onTap: () {
                            ref.read(documentsTypeFilterProvider.notifier).state = null;
                            Navigator.pop(ctx);
                          }),
                      ...types.map((t) => _buildFilterChip(
                        t, t, const Color(0xFF6366F1),
                        isSelected: currentType == t,
                        onTap: () {
                          ref.read(documentsTypeFilterProvider.notifier).state = t;
                          Navigator.pop(ctx);
                        },
                      )),
                    ],
                  );
                },
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterChip(dynamic value, String label, Color color,
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

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'active':
      case 'published':
        return const Color(0xFF10B981);
      case 'draft':
        return const Color(0xFFF59E0B);
      case 'archived':
      case 'deprecated':
        return const Color(0xFF6B7280);
      default:
        return GodTheme.textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final docsAsync = ref.watch(filteredDocumentsProvider);
    final statusFilter = ref.watch(documentsStatusFilterProvider);
    final typeFilter = ref.watch(documentsTypeFilterProvider);
    final spaceFilter = ref.watch(documentsSpaceFilterProvider);
    final hasFilters = statusFilter != null || typeFilter != null || spaceFilter != null;

    return Scaffold(
      appBar: AppBar(
        title: _showSearch
            ? TextField(
                controller: _searchCtrl,
                autofocus: true,
                style: const TextStyle(color: GodTheme.textPrimary),
                decoration: const InputDecoration(
                  hintText: 'Поиск документов...',
                  hintStyle: TextStyle(color: GodTheme.textMuted),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
                onChanged: (q) {
                  ref.read(documentsSearchProvider.notifier).state = q;
                },
              )
            : const Text('Документы'),
        actions: [
          IconButton(
            icon: Icon(_showSearch ? Icons.close : Icons.search),
            onPressed: () {
              setState(() {
                _showSearch = !_showSearch;
                if (!_showSearch) {
                  _searchCtrl.clear();
                  ref.read(documentsSearchProvider.notifier).state = '';
                }
              });
            },
          ),
          IconButton(
            icon: Badge(
              isLabelVisible: hasFilters,
              smallSize: 8,
              child: const Icon(Icons.filter_list),
            ),
            onPressed: () => _showFilterSheet(context),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(filteredDocumentsProvider);
              ref.invalidate(documentStatusesProvider);
              ref.invalidate(documentTypesProvider);
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Active filter chips
          if (hasFilters)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              color: GodTheme.surfaceLight,
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  if (statusFilter != null)
                    _ActiveFilterChip(
                      label: statusFilter,
                      color: _statusColor(statusFilter),
                      onRemove: () =>
                          ref.read(documentsStatusFilterProvider.notifier).state = null,
                    ),
                  if (typeFilter != null)
                    _ActiveFilterChip(
                      label: typeFilter,
                      color: const Color(0xFF6366F1),
                      onRemove: () =>
                          ref.read(documentsTypeFilterProvider.notifier).state = null,
                    ),
                  if (spaceFilter != null)
                    Builder(builder: (_) {
                      final spaces = ref.watch(spacesProvider).valueOrNull ?? [];
                      final name = spaces
                          .where((s) => s.id == spaceFilter)
                          .map((s) => s.name)
                          .firstOrNull ?? 'Space #$spaceFilter';
                      return _ActiveFilterChip(
                        label: name,
                        color: GodTheme.primary,
                        onRemove: () =>
                            ref.read(documentsSpaceFilterProvider.notifier).state = null,
                      );
                    }),
                  GestureDetector(
                    onTap: () {
                      ref.read(documentsStatusFilterProvider.notifier).state = null;
                      ref.read(documentsTypeFilterProvider.notifier).state = null;
                      ref.read(documentsSpaceFilterProvider.notifier).state = null;
                    },
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                      child: Text('Сбросить',
                          style: TextStyle(color: GodTheme.primary, fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ),
          // Documents list
          Expanded(
            child: docsAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48, color: GodTheme.error),
                    const SizedBox(height: 12),
                    Text('Ошибка загрузки: $e',
                        style: const TextStyle(color: GodTheme.textSecondary),
                        textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    TextButton(
                      onPressed: () => ref.invalidate(filteredDocumentsProvider),
                      child: const Text('Повторить'),
                    ),
                  ],
                ),
              ),
              data: (docs) {
                if (docs.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.description_outlined, size: 64,
                            color: GodTheme.textMuted.withOpacity(0.5)),
                        const SizedBox(height: 16),
                        Text(
                          hasFilters ? 'Нет документов по фильтру' : 'Документов пока нет',
                          style: const TextStyle(color: GodTheme.textSecondary, fontSize: 16),
                        ),
                        if (hasFilters) ...[
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: () {
                              ref.read(documentsStatusFilterProvider.notifier).state = null;
                              ref.read(documentsTypeFilterProvider.notifier).state = null;
                              ref.read(documentsSpaceFilterProvider.notifier).state = null;
                            },
                            child: const Text('Сбросить фильтры'),
                          ),
                        ],
                      ],
                    ),
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async => ref.invalidate(filteredDocumentsProvider),
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: docs.length,
                    itemBuilder: (context, i) => _DocumentCard(key: ValueKey('doc_${docs[i].id}'), doc: docs[i]),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Active filter chip with remove button.
class _ActiveFilterChip extends StatelessWidget {
  final String label;
  final Color color;
  final VoidCallback onRemove;

  const _ActiveFilterChip({
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

class _DocumentCard extends ConsumerWidget {
  final Document doc;

  const _DocumentCard({super.key, required this.doc});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dateStr = doc.updatedAt != null
        ? DateFormat('dd.MM.yyyy HH:mm').format(doc.updatedAt!)
        : doc.createdAt != null
            ? DateFormat('dd.MM.yyyy HH:mm').format(doc.createdAt!)
            : null;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => DocumentDetailScreen(documentId: doc.id, title: doc.title),
            ),
          );
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: GodTheme.primary.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: doc.icon != null && doc.icon!.isNotEmpty
                    ? Center(
                        child: Text(doc.icon!, style: const TextStyle(fontSize: 22)),
                      )
                    : Icon(
                        _iconForType(doc.type),
                        color: GodTheme.primary,
                        size: 22,
                      ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      doc.title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                        color: GodTheme.textPrimary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (doc.description != null && doc.description!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        doc.description!,
                        style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    if (dateStr != null || doc.status != null || doc.displayType != null) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          if (doc.status != null) ...[
                            GestureDetector(
                              onTap: () => _showStatusPicker(context, ref),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: _statusColor(doc.status!).withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: _statusColor(doc.status!).withOpacity(0.3), width: 0.5),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      doc.status!,
                                      style: TextStyle(fontSize: 11, color: _statusColor(doc.status!), fontWeight: FontWeight.w600),
                                    ),
                                    const SizedBox(width: 2),
                                    Icon(Icons.arrow_drop_down, size: 14, color: _statusColor(doc.status!)),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                          ],
                          if (doc.displayType != null) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFF6366F1).withOpacity(0.1),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                doc.displayType!,
                                style: const TextStyle(fontSize: 10, color: Color(0xFF6366F1)),
                              ),
                            ),
                            const SizedBox(width: 8),
                          ],
                          if (dateStr != null)
                            Flexible(
                              child: Text(
                                dateStr,
                                style: const TextStyle(fontSize: 11, color: GodTheme.textMuted),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: () async {
                      try {
                        final conv = await ref.read(conversationsProvider.notifier).create(
                          title: 'Документ: ${doc.title}',
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
                    child: Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: GodTheme.primary.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.chat_bubble_outline, size: 16, color: GodTheme.primary),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'active':
      case 'published':
        return const Color(0xFF10B981);
      case 'draft':
        return const Color(0xFFF59E0B);
      case 'archived':
      case 'deprecated':
        return const Color(0xFF6B7280);
      default:
        return GodTheme.textMuted;
    }
  }

  void _showStatusPicker(BuildContext context, WidgetRef ref) {
    final statuses = ['active', 'draft', 'published', 'archived', 'deprecated'];
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
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text('Изменить статус',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16,
                      color: GodTheme.textPrimary)),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(doc.title,
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: GodTheme.textMuted, fontSize: 13)),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1),
            ...statuses.map((s) {
              final isSelected = s == (doc.status?.toLowerCase() ?? '');
              final color = _statusColor(s);
              return ListTile(
                leading: Container(
                  width: 32, height: 32,
                  decoration: BoxDecoration(
                    color: color.withOpacity(isSelected ? 0.25 : 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    s == 'active' ? Icons.check_circle_outline
                        : s == 'draft' ? Icons.edit_outlined
                        : s == 'published' ? Icons.publish_outlined
                        : s == 'archived' ? Icons.archive_outlined
                        : Icons.delete_outline,
                    color: color, size: 18,
                  ),
                ),
                title: Text(s.toUpperCase(),
                    style: TextStyle(
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                      color: isSelected ? color : GodTheme.textPrimary,
                      fontSize: 14,
                    )),
                trailing: isSelected
                    ? Icon(Icons.check_circle, color: color, size: 20)
                    : null,
                onTap: () {
                  Navigator.pop(ctx);
                  if (!isSelected) _updateDocumentStatus(context, ref, s);
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Future<void> _updateDocumentStatus(BuildContext context, WidgetRef ref, String newStatus) async {
    try {
      final repo = ref.read(documentsRepositoryProvider);
      await repo.updateDocument(doc.id, {'status': newStatus});
      ref.invalidate(filteredDocumentsProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Статус изменён на $newStatus'),
              duration: const Duration(seconds: 2)),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Ошибка: $e'), backgroundColor: GodTheme.error),
        );
      }
    }
  }

  IconData _iconForType(String? type) {
    switch (type?.toLowerCase()) {
      case 'manual':
      case 'guide':
        return Icons.menu_book_outlined;
      case 'report':
        return Icons.assessment_outlined;
      case 'template':
        return Icons.copy_outlined;
      case 'note':
        return Icons.sticky_note_2_outlined;
      case 'operations':
      case 'ops':
        return Icons.settings_outlined;
      default:
        return Icons.description_outlined;
    }
  }
}
