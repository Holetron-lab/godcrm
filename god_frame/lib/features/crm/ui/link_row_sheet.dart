import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../../chat/data/models.dart';
import '../../chat/providers/conversations_provider.dart';

/// Shows a bottom sheet to pick a CRM row through a hierarchy:
/// Space -> Project -> Table -> Row.
/// Returns the selected CrmTableRow or null if cancelled.
Future<CrmTableRow?> showLinkRowSheet(BuildContext context, WidgetRef ref) async {
  return showModalBottomSheet<CrmTableRow>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (ctx) => const _LinkRowSheetContent(),
  );
}

// Pre-computed colors
const _kMutedBg03 = Color(0x4D9E9E9E);
const _kPrimaryBg01 = Color(0x1A536DFE);
const _kOrangeBg005 = Color(0x0DFF9800);
const _kMutedBg04 = Color(0x669E9E9E);

/// Navigation steps for the hierarchical picker.
enum _PickerStep { space, project, table, row }

class _LinkRowSheetContent extends ConsumerStatefulWidget {
  const _LinkRowSheetContent();

  @override
  ConsumerState<_LinkRowSheetContent> createState() => _LinkRowSheetContentState();
}

class _LinkRowSheetContentState extends ConsumerState<_LinkRowSheetContent> {
  _PickerStep _step = _PickerStep.space;
  Space? _selectedSpace;
  CrmProject? _selectedProject;
  CrmTable? _selectedTable;

  /// Title for the current step.
  String get _title {
    switch (_step) {
      case _PickerStep.space:
        return 'Select Space';
      case _PickerStep.project:
        return _selectedSpace?.name ?? 'Select Project';
      case _PickerStep.table:
        return _selectedProject?.name ?? 'Select Table';
      case _PickerStep.row:
        return _selectedTable?.name ?? 'Select Row';
    }
  }

  /// Breadcrumb trail showing navigation path.
  String get _breadcrumb {
    final parts = <String>[];
    if (_selectedSpace != null) parts.add(_selectedSpace!.name);
    if (_selectedProject != null) parts.add(_selectedProject!.name);
    if (_selectedTable != null) parts.add(_selectedTable!.name);
    return parts.join(' > ');
  }

  /// Go back one step.
  void _goBack() {
    setState(() {
      switch (_step) {
        case _PickerStep.project:
          _step = _PickerStep.space;
          _selectedSpace = null;
          break;
        case _PickerStep.table:
          _step = _PickerStep.project;
          _selectedProject = null;
          break;
        case _PickerStep.row:
          _step = _PickerStep.table;
          _selectedTable = null;
          break;
        case _PickerStep.space:
          break; // Can't go back from first step
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.9,
      builder: (ctx, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: GodTheme.surface,
            borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 12, bottom: 8),
                  width: 40, height: 4,
                  decoration: BoxDecoration(
                    color: _kMutedBg03,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              // Title bar with back button and breadcrumb
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Row(
                  children: [
                    if (_step != _PickerStep.space)
                      IconButton(
                        icon: const Icon(Icons.arrow_back, size: 20, color: GodTheme.textPrimary),
                        onPressed: _goBack,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                      ),
                    if (_step != _PickerStep.space) const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _title,
                            style: const TextStyle(
                              color: GodTheme.textPrimary,
                              fontSize: 17,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (_breadcrumb.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(
                                _breadcrumb,
                                style: const TextStyle(
                                  color: GodTheme.textMuted,
                                  fontSize: 12,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                      ),
                    ),
                    // Step indicator
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: _kPrimaryBg01,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '${_step.index + 1}/4',
                        style: const TextStyle(
                          color: GodTheme.primary,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1, color: GodTheme.border),
              // Content for current step
              Expanded(
                child: _buildStepContent(scrollController),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStepContent(ScrollController controller) {
    switch (_step) {
      case _PickerStep.space:
        return _buildSpacesList(controller);
      case _PickerStep.project:
        return _buildProjectsList(controller);
      case _PickerStep.table:
        return _buildTablesList(controller);
      case _PickerStep.row:
        return _buildRowsList(controller);
    }
  }

  // ─── Step 1: Spaces ─────────────────────────────────────────────

  Widget _buildSpacesList(ScrollController controller) {
    final spacesAsync = ref.watch(spacesProvider);

    return spacesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _errorWidget('$err'),
      data: (spaces) {
        if (spaces.isEmpty) {
          return _emptyWidget('No spaces available');
        }
        return ListView.builder(
          controller: controller,
          padding: const EdgeInsets.only(bottom: 16),
          itemCount: spaces.length,
          itemBuilder: (ctx, index) {
            final space = spaces[index];
            return _buildListItem(
              key: ValueKey('space_${space.id}'),
              icon: Icons.workspaces_outlined,
              iconColor: GodTheme.primary,
              title: space.name,
              subtitle: space.description,
              onTap: () {
                setState(() {
                  _selectedSpace = space;
                  _step = _PickerStep.project;
                });
              },
            );
          },
        );
      },
    );
  }

  // ─── Step 2: Projects ───────────────────────────────────────────

  Widget _buildProjectsList(ScrollController controller) {
    final projectsAsync = ref.watch(
      projectsForSpaceProvider(_selectedSpace?.id),
    );

    return projectsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _errorWidget('$err'),
      data: (projects) {
        if (projects.isEmpty) {
          // If no projects found, skip directly to tables for this space
          return _buildTablesFallback(controller);
        }
        return ListView.builder(
          controller: controller,
          padding: const EdgeInsets.only(bottom: 16),
          itemCount: projects.length,
          itemBuilder: (ctx, index) {
            final project = projects[index];
            return _buildListItem(
              key: ValueKey('project_${project.id}'),
              icon: Icons.folder_outlined,
              iconColor: Colors.orange,
              title: project.name,
              subtitle: project.description,
              onTap: () {
                setState(() {
                  _selectedProject = project;
                  _step = _PickerStep.table;
                });
              },
            );
          },
        );
      },
    );
  }

  /// Fallback: if space has no projects, show tables directly.
  Widget _buildTablesFallback(ScrollController controller) {
    final tablesAsync = ref.watch(
      tablesForProjectProvider((spaceId: _selectedSpace?.id, projectId: null)),
    );

    return tablesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _errorWidget('$err'),
      data: (tables) {
        if (tables.isEmpty) {
          return _emptyWidget('No projects or tables in this space');
        }
        // Show tables directly (skip project step)
        return Column(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: _kOrangeBg005,
              child: const Row(
                children: [
                  Icon(Icons.info_outline, size: 14, color: GodTheme.textMuted),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'No projects found. Showing tables directly.',
                      style: TextStyle(color: GodTheme.textMuted, fontSize: 12),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                controller: controller,
                padding: const EdgeInsets.only(bottom: 16),
                itemCount: tables.length,
                itemBuilder: (ctx, index) {
                  final table = tables[index];
                  return _buildListItem(
                    key: ValueKey('table_${table.id}'),
                    icon: Icons.table_chart_outlined,
                    iconColor: GodTheme.accent,
                    title: table.name,
                    subtitle: table.description,
                    onTap: () {
                      setState(() {
                        _selectedTable = table;
                        _step = _PickerStep.row;
                      });
                    },
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }

  // ─── Step 3: Tables ─────────────────────────────────────────────

  Widget _buildTablesList(ScrollController controller) {
    final tablesAsync = ref.watch(
      tablesForProjectProvider((
        spaceId: _selectedSpace?.id,
        projectId: _selectedProject?.id,
      )),
    );

    return tablesAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _errorWidget('$err'),
      data: (tables) {
        if (tables.isEmpty) {
          return _emptyWidget('No tables in this project');
        }
        return ListView.builder(
          controller: controller,
          padding: const EdgeInsets.only(bottom: 16),
          itemCount: tables.length,
          itemBuilder: (ctx, index) {
            final table = tables[index];
            return _buildListItem(
              key: ValueKey('table_${table.id}'),
              icon: Icons.table_chart_outlined,
              iconColor: GodTheme.accent,
              title: table.name,
              subtitle: table.description,
              onTap: () {
                setState(() {
                  _selectedTable = table;
                  _step = _PickerStep.row;
                });
              },
            );
          },
        );
      },
    );
  }

  // ─── Step 4: Rows ───────────────────────────────────────────────

  Widget _buildRowsList(ScrollController controller) {
    final rowsAsync = ref.watch(tableRowsProvider(_selectedTable!.id));

    return rowsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _errorWidget('$err'),
      data: (rows) {
        if (rows.isEmpty) {
          return _emptyWidget('No rows in this table');
        }
        return ListView.builder(
          controller: controller,
          padding: const EdgeInsets.only(bottom: 16),
          itemCount: rows.length,
          itemBuilder: (ctx, index) {
            final row = rows[index];
            return ListTile(
              key: ValueKey('row_${row.id}'),
              leading: CircleAvatar(
                radius: 16,
                backgroundColor: _kPrimaryBg01,
                child: Text(
                  '${row.id}',
                  style: const TextStyle(
                    color: GodTheme.primary,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              title: Text(
                row.displayTitle ?? 'Row #${row.id}',
                style: const TextStyle(color: GodTheme.textPrimary, fontSize: 14),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: const Icon(Icons.check_circle_outline, color: GodTheme.success, size: 20),
              onTap: () => Navigator.pop(context, row),
            );
          },
        );
      },
    );
  }

  // ─── Shared Widgets ─────────────────────────────────────────────

  Widget _buildListItem({
    Key? key,
    required IconData icon,
    required Color iconColor,
    required String title,
    String? subtitle,
    required VoidCallback onTap,
  }) {
    return ListTile(
      key: key,
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: iconColor.withAlpha(25),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: iconColor, size: 20),
      ),
      title: Text(
        title,
        style: const TextStyle(color: GodTheme.textPrimary, fontSize: 15),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: subtitle != null
          ? Text(
              subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
            )
          : null,
      trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted, size: 20),
      onTap: onTap,
    );
  }

  Widget _emptyWidget(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inbox_outlined, size: 40, color: _kMutedBg04),
            const SizedBox(height: 12),
            Text(message, style: const TextStyle(color: GodTheme.textMuted)),
          ],
        ),
      ),
    );
  }

  Widget _errorWidget(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text('Error: $message', style: const TextStyle(color: GodTheme.error)),
      ),
    );
  }
}
