import 'package:flutter/material.dart';
import '../../../core/theme.dart';
import '../data/models.dart';

/// Bar showing pending scheduled messages above the chat input.
/// Actions: Send Now, Edit (reschedule), Cancel.
class ScheduledMessagesBar extends StatelessWidget {
  final List<ScheduledMessage> messages;
  final void Function(ScheduledMessage sm) onSendNow;
  final void Function(ScheduledMessage sm) onEdit;
  final void Function(ScheduledMessage sm) onCancel;

  const ScheduledMessagesBar({
    super.key,
    required this.messages,
    required this.onSendNow,
    required this.onEdit,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) return const SizedBox.shrink();

    return Container(
      decoration: const BoxDecoration(
        color: GodTheme.surface,
        border: Border(top: BorderSide(color: GodTheme.border, width: 1)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Row(
              children: [
                const Icon(Icons.schedule, color: Color(0xFFF59E0B), size: 16),
                const SizedBox(width: 6),
                Text(
                  'Запланировано (${messages.length})',
                  style: const TextStyle(
                    color: Color(0xFFF59E0B),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          // Message cards
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 180),
            child: ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              itemCount: messages.length,
              itemBuilder: (ctx, i) => _ScheduledMessageCard(
                key: ValueKey('sched_${messages[i].id}'),
                sm: messages[i],
                onSendNow: () => onSendNow(messages[i]),
                onEdit: () => onEdit(messages[i]),
                onCancel: () => onCancel(messages[i]),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ScheduledMessageCard extends StatelessWidget {
  final ScheduledMessage sm;
  final VoidCallback onSendNow;
  final VoidCallback onEdit;
  final VoidCallback onCancel;

  const _ScheduledMessageCard({
    super.key,
    required this.sm,
    required this.onSendNow,
    required this.onEdit,
    required this.onCancel,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.fromLTRB(10, 6, 6, 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF59E0B).withOpacity(0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFF59E0B).withOpacity(0.2)),
      ),
      child: Row(
        children: [
          // Time badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: const Color(0xFFF59E0B).withOpacity(0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              sm.scheduledTimeDisplay,
              style: const TextStyle(
                color: Color(0xFFF59E0B),
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 8),
          // Content preview
          Expanded(
            child: Text(
              sm.content,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: GodTheme.textSecondary,
                fontSize: 12,
              ),
            ),
          ),
          // Actions
          _miniButton(Icons.send, GodTheme.success, onSendNow, 'Отправить'),
          _miniButton(Icons.edit, GodTheme.primary, onEdit, 'Изменить'),
          _miniButton(Icons.close, GodTheme.error, onCancel, 'Отменить'),
        ],
      ),
    );
  }

  Widget _miniButton(IconData icon, Color color, VoidCallback onTap, String tooltip) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(icon, size: 16, color: color),
        ),
      ),
    );
  }
}
