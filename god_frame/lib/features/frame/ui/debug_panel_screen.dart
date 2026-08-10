import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../../../shared/services/ble_debug_logger.dart';
import '../../../shared/utils/api_client.dart';
import '../data/frame_repository.dart';
import '../providers/frame_connection_provider.dart';

/// Debug Panel screen showing live BLE logs, stats, and controls.
class DebugPanelScreen extends ConsumerStatefulWidget {
  const DebugPanelScreen({super.key});

  @override
  ConsumerState<DebugPanelScreen> createState() => _DebugPanelScreenState();
}

class _DebugPanelScreenState extends ConsumerState<DebugPanelScreen> {
  final _logger = BleDebugLogger.instance;
  final _scrollController = ScrollController();
  StreamSubscription<BleLogEntry>? _logSub;
  bool _autoScroll = true;
  BleLogLevel? _filterLevel;
  String? _filterCategory;
  bool _showStats = true;

  // Cached filtered entries — recomputed only when filter or log count changes
  final _logVersion = ValueNotifier<int>(0);
  List<BleLogEntry> _cachedEntries = [];
  int _lastEntryCount = 0;
  BleLogLevel? _lastFilterLevel;
  String? _lastFilterCategory;

  @override
  void initState() {
    super.initState();
    // Set up API client for remote uploads
    try {
      final dio = ref.read(apiClientProvider);
      _logger.setApiClient(dio);
    } catch (_) {}

    // Listen for new log entries — bump version notifier instead of setState
    _logSub = _logger.stream.listen((_) {
      _logVersion.value++;
      if (_autoScroll && _scrollController.hasClients) {
        Future.delayed(const Duration(milliseconds: 50), () {
          if (_scrollController.hasClients) {
            _scrollController.animateTo(
              _scrollController.position.maxScrollExtent,
              duration: const Duration(milliseconds: 150),
              curve: Curves.easeOut,
            );
          }
        });
      }
    });
  }

  @override
  void dispose() {
    _logSub?.cancel();
    _logVersion.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  List<BleLogEntry> _computeFilteredEntries() {
    final count = _logger.entryCount;
    // Only recompute if data or filter actually changed
    if (count == _lastEntryCount &&
        _filterLevel == _lastFilterLevel &&
        _filterCategory == _lastFilterCategory) {
      return _cachedEntries;
    }
    _lastEntryCount = count;
    _lastFilterLevel = _filterLevel;
    _lastFilterCategory = _filterCategory;

    var entries = _logger.entries;
    if (_filterLevel != null) {
      entries = entries.where((e) => e.level == _filterLevel).toList();
    }
    if (_filterCategory != null) {
      entries = entries.where((e) => e.category == _filterCategory).toList();
    }
    _cachedEntries = entries;
    return entries;
  }

  @override
  Widget build(BuildContext context) {
    final frameState = ref.watch(frameConnectionProvider);
    final stats = _logger.stats;

    return Scaffold(
      appBar: AppBar(
        title: const Text('BLE Debug'),
        actions: [
          // Auto-scroll toggle
          IconButton(
            icon: Icon(
              _autoScroll ? Icons.vertical_align_bottom : Icons.vertical_align_center,
              color: _autoScroll ? GodTheme.primary : GodTheme.textMuted,
            ),
            tooltip: 'Auto-scroll',
            onPressed: () => setState(() => _autoScroll = !_autoScroll),
          ),
          // Upload logs
          IconButton(
            icon: const Icon(Icons.cloud_upload_outlined),
            tooltip: 'Upload logs to CRM',
            onPressed: _uploadLogs,
          ),
          // More actions
          PopupMenuButton<String>(
            onSelected: _handleMenuAction,
            itemBuilder: (context) => [
              PopupMenuItem(
                value: 'copy',
                child: const Row(
                  children: [
                    Icon(Icons.copy, size: 18),
                    SizedBox(width: 8),
                    Text('Copy logs'),
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'clear',
                child: const Row(
                  children: [
                    Icon(Icons.delete_outline, size: 18, color: GodTheme.error),
                    SizedBox(width: 8),
                    Text('Clear logs', style: TextStyle(color: GodTheme.error)),
                  ],
                ),
              ),
              PopupMenuItem(
                value: _logger.autoUploadEnabled ? 'stop_auto' : 'start_auto',
                child: Row(
                  children: [
                    Icon(
                      _logger.autoUploadEnabled ? Icons.cloud_off : Icons.cloud_sync,
                      size: 18,
                    ),
                    const SizedBox(width: 8),
                    Text(_logger.autoUploadEnabled ? 'Stop auto-upload' : 'Start auto-upload (30s)'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // ─── Stats section (collapsible) ──────────────────────
          _StatsHeader(
            stats: stats,
            frameState: frameState,
            isExpanded: _showStats,
            onToggle: () => setState(() => _showStats = !_showStats),
          ),

          // ─── Filter chips + Log entries (rebuild on log changes only) ───
          ValueListenableBuilder<int>(
            valueListenable: _logVersion,
            builder: (context, _, __) {
              final entries = _computeFilteredEntries();
              return _FilterBar(
                selectedLevel: _filterLevel,
                selectedCategory: _filterCategory,
                onLevelChanged: (level) {
                  _filterLevel = level;
                  _logVersion.value++; // trigger rebuild of log section only
                },
                onCategoryChanged: (cat) {
                  _filterCategory = cat;
                  _logVersion.value++;
                },
                entryCount: entries.length,
                totalCount: _logger.entryCount,
              );
            },
          ),

          Expanded(
            child: ValueListenableBuilder<int>(
              valueListenable: _logVersion,
              builder: (context, _, __) {
                final entries = _computeFilteredEntries();
                if (entries.isEmpty) {
                  return const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.bug_report_outlined, size: 48, color: GodTheme.textMuted),
                        SizedBox(height: 12),
                        Text('No BLE events yet',
                            style: TextStyle(color: GodTheme.textMuted)),
                        Text('Connect Frame glasses to see debug logs',
                            style: TextStyle(color: GodTheme.textMuted, fontSize: 12)),
                      ],
                    ),
                  );
                }
                return ListView.builder(
                  controller: _scrollController,
                  itemCount: entries.length,
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  itemBuilder: (context, index) {
                    return _LogEntryTile(key: ValueKey('log_$index'), entry: entries[index]);
                  },
                );
              },
            ),
          ),

          // ─── Action buttons ───────────────────────────────────
          _ActionBar(
            frameState: frameState,
            onForceReconnect: _forceReconnect,
            onResetBle: _resetBle,
            onSendHold: _sendHold,
          ),

          // ─── Upload status bar ────────────────────────────────
          if (_logger.lastUploadTime != null || _logger.lastUploadError != null)
            _UploadStatusBar(
              lastUploadTime: _logger.lastUploadTime,
              lastUploadCount: _logger.lastUploadCount,
              lastUploadError: _logger.lastUploadError,
              autoUploadEnabled: _logger.autoUploadEnabled,
            ),
        ],
      ),
    );
  }

  void _handleMenuAction(String action) {
    switch (action) {
      case 'copy':
        final text = _logger.exportAsText();
        Clipboard.setData(ClipboardData(text: text));
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Logs copied to clipboard')),
        );
        break;
      case 'clear':
        _logger.clear();
        _logVersion.value++;
        break;
      case 'start_auto':
        _logger.startAutoUpload();
        _logVersion.value++;
        break;
      case 'stop_auto':
        _logger.stopAutoUpload();
        _logVersion.value++;
        break;
    }
  }

  Future<void> _uploadLogs() async {
    final success = await _logger.uploadLogs();
    if (mounted) {
      _logVersion.value++;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(success
              ? 'Uploaded ${_logger.lastUploadCount} log entries'
              : 'Upload failed: ${_logger.lastUploadError}'),
          backgroundColor: success ? GodTheme.success : GodTheme.error,
        ),
      );
    }
  }

  void _forceReconnect() {
    _logger.info('ACTION', 'Force reconnect triggered by user');
    ref.read(frameConnectionProvider.notifier).scanAndConnect();
  }

  void _resetBle() async {
    _logger.info('ACTION', 'BLE reset triggered by user');
    await ref.read(frameConnectionProvider.notifier).forgetDevice();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('BLE cache cleared. Device forgotten.')),
      );
    }
  }

  void _sendHold() async {
    _logger.info('ACTION', 'Manual hold/keepalive sent by user');
    try {
      final repo = ref.read(frameRepositoryProvider);
      await repo.sendHold();
    } catch (e) {
      _logger.error('ACTION', 'Hold failed: $e');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Stats Header
// ═══════════════════════════════════════════════════════════════

class _StatsHeader extends StatelessWidget {
  final BleStats stats;
  final FrameState frameState;
  final bool isExpanded;
  final VoidCallback onToggle;

  const _StatsHeader({
    required this.stats,
    required this.frameState,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final stateColor = _connectionColor(frameState.connectionState);

    return GestureDetector(
      onTap: onToggle,
      child: Container(
        color: GodTheme.surfaceLight,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Column(
          children: [
            // Connection status bar (always visible)
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: stateColor,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  stats.connectionState.toUpperCase(),
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: stateColor,
                    fontSize: 13,
                  ),
                ),
                if (stats.deviceName != null) ...[
                  const SizedBox(width: 8),
                  Text(
                    stats.deviceName!,
                    style: const TextStyle(fontSize: 12, color: GodTheme.textSecondary),
                  ),
                ],
                if (stats.rssi != null) ...[
                  const SizedBox(width: 8),
                  Icon(
                    _rssiIcon(stats.rssi!),
                    size: 14,
                    color: _rssiColor(stats.rssi!),
                  ),
                  Text(
                    ' ${stats.rssi} dBm',
                    style: TextStyle(fontSize: 11, color: _rssiColor(stats.rssi!)),
                  ),
                ],
                const Spacer(),
                if (stats.foregroundServiceRunning)
                  const Padding(
                    padding: EdgeInsets.only(right: 4),
                    child: Icon(Icons.notifications_active, size: 14, color: GodTheme.primary),
                  ),
                Icon(
                  isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                  size: 18,
                  color: GodTheme.textMuted,
                ),
              ],
            ),

            // Expanded stats grid
            if (isExpanded) ...[
              const SizedBox(height: 8),
              const Divider(height: 1),
              const SizedBox(height: 8),
              Row(
                children: [
                  _StatCell(label: 'TX', value: '${stats.messagesSent}', sub: '${stats.bytesSent}B'),
                  _StatCell(label: 'RX', value: '${stats.messagesReceived}', sub: '${stats.bytesReceived}B'),
                  _StatCell(label: 'Taps', value: '${stats.tapEvents}'),
                  _StatCell(label: 'Holds', value: '${stats.holdsSent}'),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  _StatCell(label: 'Audio', value: '${stats.audioChunks}'),
                  _StatCell(label: 'Photo', value: '${stats.photoChunks}'),
                  _StatCell(label: 'Reconn', value: '${stats.reconnectAttempts}'),
                  _StatCell(
                    label: 'Errors',
                    value: '${stats.errors}',
                    valueColor: stats.errors > 0 ? GodTheme.error : null,
                  ),
                ],
              ),
              if (stats.mtu != null || stats.connectedSince != null) ...[
                const SizedBox(height: 4),
                Row(
                  children: [
                    if (stats.mtu != null)
                      _StatCell(label: 'MTU', value: '${stats.mtu}'),
                    if (stats.connectedSince != null)
                      Expanded(
                        child: Text(
                          'Connected: ${_duration(stats.connectedSince!)}',
                          style: const TextStyle(fontSize: 11, color: GodTheme.textMuted),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    if (stats.lastRxTime != null)
                      Expanded(
                        child: Text(
                          'Last RX: ${_ago(stats.lastRxTime!)}',
                          style: const TextStyle(fontSize: 11, color: GodTheme.textMuted),
                          textAlign: TextAlign.center,
                        ),
                      ),
                  ],
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Color _connectionColor(FrameConnectionState state) {
    switch (state) {
      case FrameConnectionState.connected:
        return GodTheme.success;
      case FrameConnectionState.connecting:
      case FrameConnectionState.scanning:
      case FrameConnectionState.found:
        return Colors.orange;
      case FrameConnectionState.error:
        return GodTheme.error;
      case FrameConnectionState.disconnected:
      default:
        return GodTheme.textMuted;
    }
  }

  IconData _rssiIcon(int rssi) {
    if (rssi >= -50) return Icons.signal_cellular_4_bar;
    if (rssi >= -65) return Icons.signal_cellular_alt;
    if (rssi >= -80) return Icons.signal_cellular_alt_2_bar;
    return Icons.signal_cellular_alt_1_bar;
  }

  Color _rssiColor(int rssi) {
    if (rssi >= -50) return GodTheme.success;
    if (rssi >= -65) return Colors.orange;
    if (rssi >= -80) return Colors.deepOrange;
    return GodTheme.error;
  }

  String _duration(DateTime since) {
    final diff = DateTime.now().difference(since);
    if (diff.inHours > 0) return '${diff.inHours}h ${diff.inMinutes % 60}m';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m ${diff.inSeconds % 60}s';
    return '${diff.inSeconds}s';
  }

  String _ago(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inSeconds < 2) return 'now';
    if (diff.inSeconds < 60) return '${diff.inSeconds}s ago';
    return '${diff.inMinutes}m ago';
  }
}

class _StatCell extends StatelessWidget {
  final String label;
  final String value;
  final String? sub;
  final Color? valueColor;

  const _StatCell({required this.label, required this.value, this.sub, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 15,
              fontFamily: 'monospace',
              color: valueColor,
            ),
          ),
          Text(
            sub != null ? '$label ($sub)' : label,
            style: const TextStyle(fontSize: 10, color: GodTheme.textMuted),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Filter Bar
// ═══════════════════════════════════════════════════════════════

class _FilterBar extends StatelessWidget {
  final BleLogLevel? selectedLevel;
  final String? selectedCategory;
  final ValueChanged<BleLogLevel?> onLevelChanged;
  final ValueChanged<String?> onCategoryChanged;
  final int entryCount;
  final int totalCount;

  const _FilterBar({
    required this.selectedLevel,
    required this.selectedCategory,
    required this.onLevelChanged,
    required this.onCategoryChanged,
    required this.entryCount,
    required this.totalCount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: GodTheme.border, width: 0.5)),
      ),
      child: Row(
        children: [
          // Level filters
          _FilterChip(
            label: 'ALL',
            selected: selectedLevel == null,
            onTap: () => onLevelChanged(null),
          ),
          _FilterChip(
            label: 'ERR',
            selected: selectedLevel == BleLogLevel.error,
            color: GodTheme.error,
            onTap: () => onLevelChanged(
                selectedLevel == BleLogLevel.error ? null : BleLogLevel.error),
          ),
          _FilterChip(
            label: 'WRN',
            selected: selectedLevel == BleLogLevel.warning,
            color: Colors.orange,
            onTap: () => onLevelChanged(
                selectedLevel == BleLogLevel.warning ? null : BleLogLevel.warning),
          ),
          _FilterChip(
            label: 'INF',
            selected: selectedLevel == BleLogLevel.info,
            color: Colors.blue,
            onTap: () => onLevelChanged(
                selectedLevel == BleLogLevel.info ? null : BleLogLevel.info),
          ),
          const Spacer(),
          Text(
            '$entryCount${entryCount != totalCount ? "/$totalCount" : ""}',
            style: const TextStyle(fontSize: 11, color: GodTheme.textMuted, fontFamily: 'monospace'),
          ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color? color;
  final VoidCallback onTap;

  const _FilterChip({
    required this.label,
    required this.selected,
    this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final chipColor = color ?? GodTheme.primary;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: selected ? chipColor.withOpacity(0.15) : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected ? chipColor : GodTheme.border,
            width: selected ? 1.5 : 0.5,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10,
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
            color: selected ? chipColor : GodTheme.textMuted,
            fontFamily: 'monospace',
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Log Entry Tile
// ═══════════════════════════════════════════════════════════════

class _LogEntryTile extends StatelessWidget {
  final BleLogEntry entry;

  const _LogEntryTile({super.key, required this.entry});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Timestamp
          Text(
            entry.timeStr,
            style: const TextStyle(
              fontSize: 10,
              fontFamily: 'monospace',
              color: GodTheme.textMuted,
            ),
          ),
          const SizedBox(width: 4),
          // Level indicator
          Container(
            width: 4,
            height: 4,
            margin: const EdgeInsets.only(top: 5),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _levelColor(entry.level),
            ),
          ),
          const SizedBox(width: 4),
          // Category tag
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 0),
            decoration: BoxDecoration(
              color: _categoryColor(entry.category).withOpacity(0.1),
              borderRadius: BorderRadius.circular(3),
            ),
            child: Text(
              entry.category,
              style: TextStyle(
                fontSize: 9,
                fontFamily: 'monospace',
                fontWeight: FontWeight.bold,
                color: _categoryColor(entry.category),
              ),
            ),
          ),
          const SizedBox(width: 4),
          // Message
          Expanded(
            child: Text(
              entry.message,
              style: TextStyle(
                fontSize: 11,
                fontFamily: 'monospace',
                color: entry.level == BleLogLevel.error
                    ? GodTheme.error
                    : entry.level == BleLogLevel.warning
                        ? Colors.orange
                        : GodTheme.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _levelColor(BleLogLevel level) {
    switch (level) {
      case BleLogLevel.debug:
        return GodTheme.textMuted;
      case BleLogLevel.info:
        return Colors.blue;
      case BleLogLevel.warning:
        return Colors.orange;
      case BleLogLevel.error:
        return GodTheme.error;
    }
  }

  Color _categoryColor(String category) {
    switch (category) {
      case 'BLE':
        return Colors.blue;
      case 'TX':
        return Colors.green;
      case 'RX':
        return Colors.teal;
      case 'TAP':
        return Colors.purple;
      case 'AUDIO':
        return Colors.indigo;
      case 'PHOTO':
        return Colors.cyan;
      case 'SCAN':
        return Colors.amber;
      case 'RECONNECT':
        return Colors.orange;
      case 'SERVICES':
        return Colors.deepPurple;
      case 'MTU':
        return Colors.blueGrey;
      case 'DEVICE':
        return Colors.lightBlue;
      case 'FG_SVC':
        return Colors.brown;
      case 'ACTION':
        return Colors.pink;
      case 'UPLOAD':
        return Colors.deepOrange;
      case 'SYSTEM':
        return GodTheme.textMuted;
      default:
        return GodTheme.textSecondary;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Action Bar (bottom)
// ═══════════════════════════════════════════════════════════════

class _ActionBar extends StatelessWidget {
  final FrameState frameState;
  final VoidCallback onForceReconnect;
  final VoidCallback onResetBle;
  final VoidCallback onSendHold;

  const _ActionBar({
    required this.frameState,
    required this.onForceReconnect,
    required this.onResetBle,
    required this.onSendHold,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: const BoxDecoration(
        color: GodTheme.surfaceLight,
        border: Border(top: BorderSide(color: GodTheme.border, width: 0.5)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _ActionButton(
            icon: Icons.refresh,
            label: 'Reconnect',
            onTap: onForceReconnect,
            enabled: !frameState.isConnected && !frameState.isScanning && !frameState.isConnecting,
          ),
          _ActionButton(
            icon: Icons.bluetooth_disabled,
            label: 'Reset BLE',
            onTap: onResetBle,
            color: GodTheme.error,
          ),
          _ActionButton(
            icon: Icons.favorite_border,
            label: 'Send Hold',
            onTap: onSendHold,
            enabled: frameState.isConnected,
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool enabled;
  final Color? color;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    this.enabled = true,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final btnColor = enabled ? (color ?? GodTheme.primary) : GodTheme.textMuted;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 20, color: btnColor),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(fontSize: 10, color: btnColor),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Upload Status Bar
// ═══════════════════════════════════════════════════════════════

class _UploadStatusBar extends StatelessWidget {
  final DateTime? lastUploadTime;
  final int lastUploadCount;
  final String? lastUploadError;
  final bool autoUploadEnabled;

  const _UploadStatusBar({
    required this.lastUploadTime,
    required this.lastUploadCount,
    required this.lastUploadError,
    required this.autoUploadEnabled,
  });

  @override
  Widget build(BuildContext context) {
    final hasError = lastUploadError != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      color: hasError
          ? GodTheme.error.withOpacity(0.1)
          : GodTheme.success.withOpacity(0.05),
      child: Row(
        children: [
          Icon(
            hasError ? Icons.cloud_off : Icons.cloud_done,
            size: 14,
            color: hasError ? GodTheme.error : GodTheme.success,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              hasError
                  ? 'Upload failed'
                  : 'Uploaded $lastUploadCount entries',
              style: TextStyle(
                fontSize: 11,
                color: hasError ? GodTheme.error : GodTheme.textSecondary,
              ),
            ),
          ),
          if (autoUploadEnabled)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
              decoration: BoxDecoration(
                color: GodTheme.primary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                'AUTO',
                style: TextStyle(fontSize: 9, color: GodTheme.primary, fontWeight: FontWeight.bold),
              ),
            ),
        ],
      ),
    );
  }
}
