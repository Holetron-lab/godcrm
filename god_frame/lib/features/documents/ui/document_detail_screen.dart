import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/theme.dart';
import '../../chat/providers/conversations_provider.dart';
import '../data/documents_repository.dart';
import '../providers/documents_provider.dart';

/// Document detail screen — loads content from doc_* content table.
class DocumentDetailScreen extends ConsumerWidget {
  final int documentId;
  final String title;

  const DocumentDetailScreen({
    super.key,
    required this.documentId,
    required this.title,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final docAsync = ref.watch(documentProvider(documentId));
    final contentAsync = ref.watch(documentContentProvider(documentId));
    final atomsAsync = ref.watch(documentAtomsProvider(documentId));

    return Scaffold(
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.chat_bubble_outline, size: 20),
            tooltip: 'Открыть чат',
            onPressed: () async {
              try {
                final conv = await ref.read(conversationsProvider.notifier).create(
                  title: 'Документ: $title',
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
          ),
        ],
      ),
      body: docAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Text('Ошибка: $e', style: const TextStyle(color: GodTheme.error)),
        ),
        data: (doc) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Title
              Text(
                doc.title,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  color: GodTheme.textPrimary,
                ),
              ),

              // Meta row
              if (doc.status != null || doc.displayType != null || doc.category != null) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    if (doc.category != null)
                      Chip(
                        label: Text(doc.category!),
                        visualDensity: VisualDensity.compact,
                        backgroundColor: const Color(0xFF6366F1).withOpacity(0.15),
                      ),
                    if (doc.type != null)
                      Chip(
                        label: Text(doc.type!),
                        visualDensity: VisualDensity.compact,
                      ),
                    if (doc.status != null)
                      GestureDetector(
                        onTap: () => _showStatusPicker(context, ref, doc),
                        child: Chip(
                          label: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(doc.status!),
                              const SizedBox(width: 4),
                              const Icon(Icons.arrow_drop_down, size: 16),
                            ],
                          ),
                          visualDensity: VisualDensity.compact,
                          backgroundColor: _statusColor(doc.status!).withOpacity(0.15),
                        ),
                      ),
                    if (doc.tags != null && doc.tags!.isNotEmpty)
                      ...doc.tags!.split(',').map((t) => Chip(
                            label: Text(t.trim()),
                            visualDensity: VisualDensity.compact,
                          )),
                  ],
                ),
              ],

              // Description
              if (doc.description != null && doc.description!.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(
                  doc.description!,
                  style: const TextStyle(color: GodTheme.textSecondary, fontSize: 15),
                ),
              ],

              // Content from doc_* content table (primary source)
              contentAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (_, __) => _buildFallbackContent(doc, atomsAsync),
                data: (docContent) {
                  if (docContent != null && docContent.count > 0) {
                    return _buildContentTree(docContent);
                  }
                  return _buildFallbackContent(doc, atomsAsync);
                },
              ),

              const SizedBox(height: 32),
            ],
          );
        },
      ),
    );
  }

  /// Fallback content when doc_* content table is not available.
  Widget _buildFallbackContent(Document doc, AsyncValue<List<DocumentAtom>> atomsAsync) {
    // 1. Inline content from registry row
    if (doc.content != null && doc.content!.isNotEmpty) {
      return _buildMarkdownContent(doc.content!);
    }

    // 2. Atoms from atoms table
    return atomsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.only(top: 24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => _buildRawOrEmpty(doc),
      data: (atoms) {
        if (atoms.isNotEmpty) {
          return _buildAtoms(atoms);
        }
        return _buildRawOrEmpty(doc);
      },
    );
  }

  /// Show raw data or empty state.
  Widget _buildRawOrEmpty(Document doc) {
    if (doc.rawData != null && doc.rawData!.isNotEmpty) {
      // Check if rawData has any meaningful content fields beyond metadata
      final contentKeys = doc.rawData!.entries.where((e) =>
          !{'id', 'order', 'order_index', 'table_id', 'icon', 'title', 'Title',
            'name', 'Name', 'slug', 'status', 'Status',
            'type', 'Type', 'category', 'Category', 'tags', 'Tags'}.contains(e.key) &&
          e.value != null && e.value.toString().isNotEmpty);
      if (contentKeys.isNotEmpty) {
        return _buildRawDataView(doc);
      }
    }
    return _buildEmptyState();
  }

  /// Build content tree from doc_* content table items.
  Widget _buildContentTree(DocumentContent content) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 20),
        const Divider(color: GodTheme.border),
        const SizedBox(height: 12),
        ...content.tree.map(_buildContentNode),
      ],
    );
  }

  /// Recursively render a content tree node.
  Widget _buildContentNode(DocumentContentItem item) {
    final widgets = <Widget>[];

    if (item.isDivider) {
      widgets.add(const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Divider(color: GodTheme.border),
      ));
    } else {
      final text = item.displayContent;
      if (text.isNotEmpty) {
        if (item.isHeading) {
          final fontSize = item.level == 'h1' ? 22.0 : item.level == 'h2' ? 19.0 : 16.0;
          widgets.add(Padding(
            padding: EdgeInsets.only(
              top: item.level == 'h1' ? 20 : 14,
              bottom: 8,
            ),
            child: Text(
              text,
              style: TextStyle(
                fontSize: fontSize,
                fontWeight: FontWeight.w700,
                color: GodTheme.textPrimary,
              ),
            ),
          ));
        } else {
          widgets.add(Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: MarkdownBody(
              data: text,
              styleSheet: _markdownStyle(),
            ),
          ));
        }
      }

      if (item.imageUrl != null && item.imageUrl!.isNotEmpty) {
        widgets.add(Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.network(
              item.imageUrl!,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
          ),
        ));
      }
    }

    // Render children
    if (item.children.isNotEmpty) {
      widgets.addAll(item.children.map(_buildContentNode));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widgets,
    );
  }

  /// Build markdown content from raw content string.
  Widget _buildMarkdownContent(String content) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 20),
        const Divider(color: GodTheme.border),
        const SizedBox(height: 12),
        MarkdownBody(
          data: content,
          styleSheet: _markdownStyle(),
        ),
      ],
    );
  }

  /// Build atoms list.
  Widget _buildAtoms(List<DocumentAtom> atoms) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 24),
        const Divider(color: GodTheme.border),
        const SizedBox(height: 12),
        const Text(
          'Разделы',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: GodTheme.textPrimary,
          ),
        ),
        const SizedBox(height: 12),
        ...atoms.map((atom) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (atom.heading != null)
                      Text(
                        atom.heading!,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                          color: GodTheme.textPrimary,
                        ),
                      ),
                    if (atom.content != null) ...[
                      const SizedBox(height: 8),
                      MarkdownBody(
                        data: atom.content!,
                        styleSheet: MarkdownStyleSheet(
                          p: const TextStyle(
                            color: GodTheme.textPrimary,
                            fontSize: 14,
                            height: 1.5,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            )),
      ],
    );
  }

  MarkdownStyleSheet _markdownStyle() {
    return MarkdownStyleSheet(
      p: const TextStyle(color: GodTheme.textPrimary, fontSize: 15, height: 1.6),
      h1: const TextStyle(color: GodTheme.textPrimary, fontSize: 22, fontWeight: FontWeight.w700),
      h2: const TextStyle(color: GodTheme.textPrimary, fontSize: 19, fontWeight: FontWeight.w600),
      h3: const TextStyle(color: GodTheme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600),
      code: TextStyle(
        color: GodTheme.accent,
        backgroundColor: GodTheme.surfaceLight,
        fontSize: 13,
      ),
      codeblockDecoration: BoxDecoration(
        color: GodTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: GodTheme.primary, width: 3)),
      ),
      listBullet: const TextStyle(color: GodTheme.textSecondary),
      tableHead: const TextStyle(color: GodTheme.textPrimary, fontWeight: FontWeight.w600, fontSize: 13),
      tableBody: const TextStyle(color: GodTheme.textPrimary, fontSize: 13),
      tableBorder: TableBorder.all(color: GodTheme.border, width: 0.5),
      tableCellsPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
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
        return GodTheme.primary;
    }
  }

  void _showStatusPicker(BuildContext context, WidgetRef ref, Document doc) {
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
                trailing: isSelected ? Icon(Icons.check_circle, color: color, size: 20) : null,
                onTap: () async {
                  Navigator.pop(ctx);
                  if (!isSelected) {
                    try {
                      final repo = ref.read(documentsRepositoryProvider);
                      await repo.updateDocument(doc.id, {'status': s});
                      ref.invalidate(documentProvider(documentId));
                      ref.invalidate(filteredDocumentsProvider);
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Статус изменён на $s'),
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
                },
              );
            }),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Padding(
      padding: const EdgeInsets.only(top: 40),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.article_outlined, size: 56,
                color: GodTheme.textMuted.withOpacity(0.3)),
            const SizedBox(height: 16),
            const Text('Контент не найден',
                style: TextStyle(color: GodTheme.textMuted, fontSize: 16, fontWeight: FontWeight.w500)),
            const SizedBox(height: 6),
            const Text('Документ ещё не заполнен или контент-таблица не создана',
                style: TextStyle(color: GodTheme.textMuted, fontSize: 13),
                textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }

  Widget _buildRawDataView(Document doc) {
    if (doc.rawData == null || doc.rawData!.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 20),
        const Divider(color: GodTheme.border),
        const SizedBox(height: 12),
        ...doc.rawData!.entries
            .where((e) => !{'id', 'title', 'Title', 'name', 'Name', 'slug',
                'icon', 'order', 'order_index', 'table_id',
                'status', 'Status', 'type', 'Type', 'category', 'Category',
                'tags', 'Tags'}.contains(e.key) &&
                e.value != null && e.value.toString().isNotEmpty)
            .map((e) {
          final value = e.value.toString();
          final looksLikeMarkdown = value.contains('#') ||
              value.contains('```') ||
              value.contains('- ') ||
              value.length > 200;

          return Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    e.key.replaceAll('_', ' ').toUpperCase(),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: GodTheme.primary.withOpacity(0.7),
                      letterSpacing: 0.5,
                    ),
                  ),
                  const SizedBox(height: 6),
                  if (looksLikeMarkdown)
                    MarkdownBody(
                      data: value,
                      styleSheet: MarkdownStyleSheet(
                        p: const TextStyle(
                          color: GodTheme.textPrimary,
                          fontSize: 14,
                          height: 1.5,
                        ),
                      ),
                    )
                  else
                    Text(
                      value,
                      style: const TextStyle(
                        color: GodTheme.textPrimary,
                        fontSize: 14,
                        height: 1.5,
                      ),
                    ),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }
}
