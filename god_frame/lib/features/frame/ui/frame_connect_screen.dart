import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../../core/router.dart';
import '../../../core/theme.dart';
import '../data/frame_repository.dart';
import '../providers/frame_connection_provider.dart';
import '../../chat/providers/conversations_provider.dart';
import '../../chat/data/models.dart';

/// Frame BLE connection management screen.
class FrameConnectScreen extends ConsumerWidget {
  const FrameConnectScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final frameState = ref.watch(frameConnectionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Frame'),
        actions: [
          IconButton(
            icon: const Icon(Icons.bug_report_outlined),
            tooltip: 'BLE Debug Panel',
            onPressed: () => context.push(Routes.debug),
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const SizedBox(height: 24),
                // Frame icon with status ring
                _FrameStatusIcon(state: frameState),
                const SizedBox(height: 24),

                // Status text
                Text(
                  _statusTitle(frameState),
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  _statusSubtitle(frameState),
                  style: const TextStyle(color: GodTheme.textSecondary),
                  textAlign: TextAlign.center,
                ),

                if (frameState.error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: GodTheme.error.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: GodTheme.error.withOpacity(0.3)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.error_outline, color: GodTheme.error, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                frameState.error!,
                                style: const TextStyle(color: GodTheme.error, fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                        // Show "Open Settings" button if permission error
                        if (frameState.error!.contains('Settings')) ...[
                          const SizedBox(height: 8),
                          Align(
                            alignment: Alignment.centerRight,
                            child: TextButton.icon(
                              onPressed: () => openAppSettings(),
                              icon: const Icon(Icons.settings, size: 16),
                              label: const Text('Open Settings'),
                              style: TextButton.styleFrom(
                                foregroundColor: GodTheme.primary,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: 32),

                // Action buttons
                if (!frameState.isConnected) ...[
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: frameState.isScanning || frameState.isConnecting
                          ? null
                          : () => ref.read(frameConnectionProvider.notifier).scanAndConnect(),
                      icon: frameState.isScanning
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Icon(Icons.bluetooth_searching),
                      label: Text(
                        frameState.isScanning
                            ? 'Scanning...'
                            : frameState.isConnecting
                                ? 'Connecting...'
                                : 'Connect Frame',
                      ),
                    ),
                  ),
                ] else ...[
                // Connected — show device info
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: GodTheme.surfaceLight,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: GodTheme.frameBle.withOpacity(0.3)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: GodTheme.frameBle.withOpacity(0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.bluetooth_connected, color: GodTheme.frameBle, size: 24),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              frameState.device?.name ?? 'Brilliant Frame',
                              style: const TextStyle(fontWeight: FontWeight.w600),
                            ),
                            Text(
                              'Connected via BLE',
                              style: TextStyle(color: GodTheme.frameBle, fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        '${frameState.device?.rssi ?? 0} dBm',
                        style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: OutlinedButton.icon(
                    onPressed: () => ref.read(frameConnectionProvider.notifier).disconnect(),
                    icon: const Icon(Icons.bluetooth_disabled, color: GodTheme.error),
                    label: const Text('Disconnect', style: TextStyle(color: GodTheme.error)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: GodTheme.error),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  height: 40,
                  child: TextButton.icon(
                    onPressed: () async {
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('Forget Device?'),
                          content: const Text(
                            'This will disconnect and remove the saved device. '
                            'You will need to scan and connect again manually.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(ctx, false),
                              child: const Text('Cancel'),
                            ),
                            TextButton(
                              onPressed: () => Navigator.pop(ctx, true),
                              child: const Text('Forget', style: TextStyle(color: GodTheme.error)),
                            ),
                          ],
                        ),
                      );
                      if (confirmed == true) {
                        ref.read(frameConnectionProvider.notifier).forgetDevice();
                      }
                    },
                    icon: const Icon(Icons.link_off, size: 16, color: GodTheme.textMuted),
                    label: const Text(
                      'Forget this device',
                      style: TextStyle(color: GodTheme.textMuted, fontSize: 13),
                    ),
                  ),
                ),
              ],

              // Upcoming events — show when connected
              if (frameState.isConnected) ...[
                const SizedBox(height: 24),
                _UpcomingEventsWidget(),
              ],

              const SizedBox(height: 48),

              // Help section
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: GodTheme.surfaceLight,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Column(
                  children: [
                    _HelpItem(
                      icon: Icons.power_settings_new,
                      title: 'Turn on Frame',
                      subtitle: 'Open the hinge to power on',
                    ),
                    SizedBox(height: 12),
                    _HelpItem(
                      icon: Icons.bluetooth,
                      title: 'Enable Bluetooth',
                      subtitle: 'Make sure Bluetooth is on in phone settings',
                    ),
                    SizedBox(height: 12),
                    _HelpItem(
                      icon: Icons.touch_app,
                      title: 'Tap to interact',
                      subtitle: 'Single tap to start/stop, double tap to cancel',
                    ),
                  ],
                ),
              ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _statusTitle(FrameState state) {
    switch (state.connectionState) {
      case FrameConnectionState.disconnected:
        return 'Not Connected';
      case FrameConnectionState.scanning:
        return 'Scanning...';
      case FrameConnectionState.found:
        return 'Frame Found!';
      case FrameConnectionState.connecting:
        return 'Connecting...';
      case FrameConnectionState.connected:
        return 'Connected';
      case FrameConnectionState.error:
        return 'Connection Error';
    }
  }

  String _statusSubtitle(FrameState state) {
    switch (state.connectionState) {
      case FrameConnectionState.disconnected:
        return 'Tap below to scan for your Brilliant Frame glasses';
      case FrameConnectionState.scanning:
        return 'Looking for nearby Frame glasses...';
      case FrameConnectionState.found:
        return 'Found ${state.device?.name ?? "Frame"} — connecting...';
      case FrameConnectionState.connecting:
        return 'Establishing BLE connection...';
      case FrameConnectionState.connected:
        return 'Your Frame glasses are ready. Go to Voice tab to start!';
      case FrameConnectionState.error:
        return 'Something went wrong. Try again.';
    }
  }
}

/// Widget showing upcoming events with "Send to Frame" button.
class _UpcomingEventsWidget extends ConsumerStatefulWidget {
  @override
  ConsumerState<_UpcomingEventsWidget> createState() => _UpcomingEventsWidgetState();
}

class _UpcomingEventsWidgetState extends ConsumerState<_UpcomingEventsWidget> {
  Timer? _autoDisplayTimer;

  @override
  void initState() {
    super.initState();
    // Auto-display events on Frame every 5 minutes when connected
    _autoDisplayTimer = Timer.periodic(const Duration(minutes: 5), (_) {
      _sendEventsToFrame();
    });
    // Send events on first load after a short delay
    Future.delayed(const Duration(seconds: 3), () {
      if (mounted) _sendEventsToFrame();
    });
  }

  @override
  void dispose() {
    _autoDisplayTimer?.cancel();
    super.dispose();
  }

  /// Get upcoming events sorted by deadline.
  List<Ticket> _getUpcomingEvents(List<Ticket> tickets) {
    final upcoming = tickets.where((t) {
      // Skip completed/done tickets
      final status = t.status.toLowerCase();
      if (status == 'done' || status == 'completed' || status == 'closed') {
        return false;
      }
      // Include tickets with deadlines (future or overdue)
      if (t.deadlineFrom != null || t.deadlineTo != null) return true;
      return false;
    }).toList();

    // Sort: closest deadline first, overdue first
    upcoming.sort((a, b) {
      final aDate = a.deadlineFrom ?? a.deadlineTo ?? DateTime(2099);
      final bDate = b.deadlineFrom ?? b.deadlineTo ?? DateTime(2099);
      return aDate.compareTo(bDate);
    });

    return upcoming.take(3).toList();
  }

  /// Format events for Frame display (3 lines max).
  /// Format: "HH:MM Title" per line (max ~40 chars)
  String _formatForFrame(List<Ticket> events) {
    if (events.isEmpty) return 'No upcoming events';
    final now = DateTime.now();
    final lines = <String>[];

    for (final event in events.take(3)) {
      final deadline = event.deadlineTo ?? event.deadlineFrom;
      final isOverdue = deadline != null && deadline.isBefore(now);

      String dateStr;
      if (deadline != null) {
        // Show time if today, otherwise date
        final isToday = deadline.year == now.year &&
            deadline.month == now.month &&
            deadline.day == now.day;
        if (isToday) {
          dateStr = '${deadline.hour.toString().padLeft(2, '0')}:${deadline.minute.toString().padLeft(2, '0')}';
        } else {
          dateStr = DateFormat('dd.MM HH:mm').format(deadline);
        }
      } else {
        dateStr = '--:--';
      }

      final prefix = isOverdue ? '!' : ' ';
      // Frame has ~40 chars per line → date takes ~11 chars + prefix
      final maxTitleLen = 40 - dateStr.length - 2;
      final title = event.title.length > maxTitleLen
          ? '${event.title.substring(0, maxTitleLen - 3)}...'
          : event.title;
      lines.add('$prefix$dateStr $title');
    }
    return lines.join('\n');
  }

  void _sendEventsToFrame() {
    final ticketsAsync = ref.read(ticketsProvider);
    final tickets = ticketsAsync.valueOrNull ?? [];
    final events = _getUpcomingEvents(tickets);
    if (events.isEmpty) return;

    final frameRepo = ref.read(frameRepositoryProvider);
    final text = _formatForFrame(events);
    print('[Events] Sending to Frame: $text');
    frameRepo.displayText(text);
  }

  @override
  Widget build(BuildContext context) {
    final ticketsAsync = ref.watch(ticketsProvider);

    return ticketsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (tickets) {
        final events = _getUpcomingEvents(tickets);
        if (events.isEmpty) {
          return Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: GodTheme.surfaceLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              children: [
                Icon(Icons.event_available, color: GodTheme.textMuted, size: 20),
                SizedBox(width: 8),
                Text('No upcoming events', style: TextStyle(color: GodTheme.textMuted)),
              ],
            ),
          );
        }

        final now = DateTime.now();
        return Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: GodTheme.surfaceLight,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: GodTheme.primary.withOpacity(0.2)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.event, color: GodTheme.primary, size: 20),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text(
                      'Upcoming Events',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                    ),
                  ),
                  // Send to Frame button
                  IconButton(
                    icon: const Icon(Icons.visibility, size: 20),
                    tooltip: 'Show on Frame',
                    color: GodTheme.frameBle,
                    onPressed: _sendEventsToFrame,
                    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                    padding: EdgeInsets.zero,
                  ),
                ],
              ),
              const Divider(height: 12),
              ...events.map((event) {
                final deadline = event.deadlineTo ?? event.deadlineFrom;
                final isOverdue = deadline != null && deadline.isBefore(now);
                final dateStr = deadline != null
                    ? DateFormat('dd MMM, HH:mm').format(deadline)
                    : 'No date';
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Row(
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isOverdue ? GodTheme.error : GodTheme.primary,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          event.title,
                          style: const TextStyle(fontSize: 13),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        dateStr,
                        style: TextStyle(
                          fontSize: 11,
                          color: isOverdue ? GodTheme.error : GodTheme.textMuted,
                          fontWeight: isOverdue ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }
}

class _FrameStatusIcon extends StatelessWidget {
  final FrameState state;

  const _FrameStatusIcon({required this.state});

  @override
  Widget build(BuildContext context) {
    final isConnected = state.isConnected;
    final isAnimating = state.isScanning || state.isConnecting;

    return Stack(
      alignment: Alignment.center,
      children: [
        // Animated ring
        if (isAnimating)
          SizedBox(
            width: 120,
            height: 120,
            child: CircularProgressIndicator(
              strokeWidth: 3,
              color: GodTheme.primary.withOpacity(0.5),
            ),
          ),
        // Status circle
        Container(
          width: 100,
          height: 100,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isConnected
                ? GodTheme.frameBle.withOpacity(0.1)
                : GodTheme.surfaceLight,
            border: Border.all(
              color: isConnected ? GodTheme.frameBle : GodTheme.border,
              width: 3,
            ),
          ),
          child: Icon(
            isConnected ? Icons.visibility : Icons.visibility_off,
            size: 40,
            color: isConnected ? GodTheme.frameBle : GodTheme.textMuted,
          ),
        ),
      ],
    );
  }
}

class _HelpItem extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;

  const _HelpItem({required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 20, color: GodTheme.textSecondary),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
              Text(subtitle, style: const TextStyle(color: GodTheme.textMuted, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }
}
