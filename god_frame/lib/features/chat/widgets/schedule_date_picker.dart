import 'package:flutter/material.dart';
import '../../../core/theme.dart';

/// Inline datetime picker for scheduling messages.
/// Quick presets + full calendar with time picker.
class ScheduleDatePicker extends StatefulWidget {
  final void Function(DateTime scheduledAt) onSchedule;
  final VoidCallback onCancel;

  const ScheduleDatePicker({
    super.key,
    required this.onSchedule,
    required this.onCancel,
  });

  @override
  State<ScheduleDatePicker> createState() => _ScheduleDatePickerState();
}

class _ScheduleDatePickerState extends State<ScheduleDatePicker> {
  bool _showCustom = false;
  DateTime _selectedDate = DateTime.now().add(const Duration(hours: 1));
  late TextEditingController _hourCtrl;
  late TextEditingController _minCtrl;

  @override
  void initState() {
    super.initState();
    _hourCtrl = TextEditingController(text: _selectedDate.hour.toString().padLeft(2, '0'));
    _minCtrl = TextEditingController(text: _selectedDate.minute.toString().padLeft(2, '0'));
  }

  @override
  void dispose() {
    _hourCtrl.dispose();
    _minCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: GodTheme.surface,
        border: Border(top: BorderSide(color: GodTheme.border, width: 1)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              const Icon(Icons.schedule, color: Color(0xFFF59E0B), size: 18),
              const SizedBox(width: 6),
              const Expanded(
                child: Text('Запланировать сообщение',
                  style: TextStyle(color: GodTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 18, color: GodTheme.textMuted),
                onPressed: widget.onCancel,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
              ),
            ],
          ),
          const SizedBox(height: 8),

          if (!_showCustom) ...[
            // Quick presets
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _presetChip('30 мин', const Duration(minutes: 30)),
                _presetChip('1 час', const Duration(hours: 1)),
                _presetChip('3 часа', const Duration(hours: 3)),
                _presetChip('Завтра 9:00', null, _tomorrow(9, 0)),
                _presetChip('Завтра 12:00', null, _tomorrow(12, 0)),
              ],
            ),
            const SizedBox(height: 8),
            // "Custom" button
            TextButton.icon(
              onPressed: () => setState(() => _showCustom = true),
              icon: const Icon(Icons.calendar_today, size: 16),
              label: const Text('Выбрать дату'),
              style: TextButton.styleFrom(
                foregroundColor: GodTheme.primary,
                textStyle: const TextStyle(fontSize: 13),
              ),
            ),
          ] else ...[
            // Custom date/time picker
            Row(
              children: [
                // Date button
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickDate,
                    icon: const Icon(Icons.calendar_today, size: 14),
                    label: Text(
                      '${_selectedDate.day.toString().padLeft(2, '0')}.${_selectedDate.month.toString().padLeft(2, '0')}.${_selectedDate.year}',
                      style: const TextStyle(fontSize: 13),
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: GodTheme.textPrimary,
                      side: const BorderSide(color: GodTheme.border),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Time input
                SizedBox(
                  width: 50,
                  child: TextField(
                    controller: _hourCtrl,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14, color: GodTheme.textPrimary),
                    decoration: const InputDecoration(
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      border: OutlineInputBorder(),
                      hintText: 'ЧЧ',
                    ),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 4),
                  child: Text(':', style: TextStyle(color: GodTheme.textPrimary, fontSize: 16)),
                ),
                SizedBox(
                  width: 50,
                  child: TextField(
                    controller: _minCtrl,
                    keyboardType: TextInputType.number,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 14, color: GodTheme.textPrimary),
                    decoration: const InputDecoration(
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 4, vertical: 8),
                      border: OutlineInputBorder(),
                      hintText: 'ММ',
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Confirm/Back buttons
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => setState(() => _showCustom = false),
                  child: const Text('Назад', style: TextStyle(color: GodTheme.textMuted)),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed: _confirmCustom,
                  icon: const Icon(Icons.schedule, size: 16),
                  label: const Text('Запланировать'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFFF59E0B),
                    foregroundColor: Colors.black,
                    textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _presetChip(String label, Duration? offset, [DateTime? exact]) {
    return ActionChip(
      label: Text(label, style: const TextStyle(fontSize: 12)),
      backgroundColor: const Color(0xFFF59E0B).withOpacity(0.12),
      labelStyle: const TextStyle(color: Color(0xFFF59E0B)),
      side: const BorderSide(color: Color(0xFFF59E0B), width: 0.5),
      onPressed: () {
        final dt = exact ?? DateTime.now().add(offset!);
        widget.onSchedule(dt);
      },
    );
  }

  DateTime _tomorrow(int hour, int minute) {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day + 1, hour, minute);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() {
        _selectedDate = DateTime(picked.year, picked.month, picked.day,
            _selectedDate.hour, _selectedDate.minute);
      });
    }
  }

  void _confirmCustom() {
    final hour = int.tryParse(_hourCtrl.text) ?? _selectedDate.hour;
    final minute = int.tryParse(_minCtrl.text) ?? _selectedDate.minute;
    final dt = DateTime(_selectedDate.year, _selectedDate.month,
        _selectedDate.day, hour.clamp(0, 23), minute.clamp(0, 59));
    if (dt.isBefore(DateTime.now())) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Время должно быть в будущем'),
          backgroundColor: GodTheme.error,
        ),
      );
      return;
    }
    widget.onSchedule(dt);
  }
}
