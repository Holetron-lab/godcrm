import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Todo view settings state.
class TodoViewSettings {
  /// Whether todo view mode is enabled (otherwise default list view).
  final bool enabled;

  /// Which status names to show in todo view (empty = show all).
  final List<String> visibleStatuses;

  /// The status name to set when marking a ticket as "done" via checkbox.
  final String doneStatus;

  const TodoViewSettings({
    this.enabled = false,
    this.visibleStatuses = const [],
    this.doneStatus = 'done',
  });

  TodoViewSettings copyWith({
    bool? enabled,
    List<String>? visibleStatuses,
    String? doneStatus,
  }) {
    return TodoViewSettings(
      enabled: enabled ?? this.enabled,
      visibleStatuses: visibleStatuses ?? this.visibleStatuses,
      doneStatus: doneStatus ?? this.doneStatus,
    );
  }

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'visibleStatuses': visibleStatuses,
    'doneStatus': doneStatus,
  };

  factory TodoViewSettings.fromJson(Map<String, dynamic> json) {
    return TodoViewSettings(
      enabled: json['enabled'] as bool? ?? false,
      visibleStatuses: (json['visibleStatuses'] as List?)
          ?.map((e) => e.toString())
          .toList() ?? [],
      doneStatus: json['doneStatus'] as String? ?? 'done',
    );
  }
}

/// Notifier for todo view settings — persists to SharedPreferences.
class TodoViewNotifier extends StateNotifier<TodoViewSettings> {
  static const _key = 'todo_view_settings';

  TodoViewNotifier() : super(const TodoViewSettings()) {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_key);
    if (json != null) {
      try {
        state = TodoViewSettings.fromJson(
          Map<String, dynamic>.from(jsonDecode(json) as Map),
        );
      } catch (_) {}
    }
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(state.toJson()));
  }

  void setEnabled(bool enabled) {
    state = state.copyWith(enabled: enabled);
    _save();
  }

  void setDoneStatus(String status) {
    state = state.copyWith(doneStatus: status);
    _save();
  }

  void toggleVisibleStatus(String status) {
    final list = List<String>.from(state.visibleStatuses);
    if (list.contains(status)) {
      list.remove(status);
    } else {
      list.add(status);
    }
    state = state.copyWith(visibleStatuses: list);
    _save();
  }

  void setVisibleStatuses(List<String> statuses) {
    state = state.copyWith(visibleStatuses: statuses);
    _save();
  }
}

/// Provider for todo view settings.
final todoViewProvider =
    StateNotifierProvider<TodoViewNotifier, TodoViewSettings>((ref) {
  return TodoViewNotifier();
});
