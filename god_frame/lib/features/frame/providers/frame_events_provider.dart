import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../data/frame_repository.dart';
import '../../../shared/utils/api_client.dart';
import 'frame_connection_provider.dart';

/// Fetches upcoming calendar events and displays them on Frame glasses.
///
/// Events are shown on the idle screen as 3 lines:
///   > 10:00 Team standup
///     11:30 Design review
///     14:00 Sprint planning
class FrameEventsNotifier extends StateNotifier<List<CalendarEvent>> {
  final Dio _dio;
  final FrameRepository _frameRepo;
  final bool _isFrameConnected;
  Timer? _refreshTimer;

  FrameEventsNotifier(this._dio, this._frameRepo, this._isFrameConnected)
      : super([]) {
    if (_isFrameConnected) {
      _fetchAndDisplay();
    }
    // Refresh events every 5 minutes
    _refreshTimer = Timer.periodic(const Duration(minutes: 5), (_) {
      if (_isFrameConnected) {
        _fetchAndDisplay();
      }
    });
  }

  /// Fetch upcoming events from CRM calendar API and send to Frame.
  Future<void> _fetchAndDisplay() async {
    try {
      final events = await _fetchUpcomingEvents();
      state = events;
      if (events.isNotEmpty && _isFrameConnected) {
        final text = _formatForFrame(events);
        await _frameRepo.displayEvents(text);
        print('[Events] Sent ${events.length} events to Frame: $text');
      }
    } catch (e) {
      print('[Events] Failed to fetch/display events: $e');
    }
  }

  /// Manually refresh events (e.g., after Frame reconnects).
  Future<void> refresh() async {
    await _fetchAndDisplay();
  }

  /// Fetch upcoming events from CRM API.
  Future<List<CalendarEvent>> _fetchUpcomingEvents() async {
    try {
      final now = DateTime.now();
      final endOfDay = DateTime(now.year, now.month, now.day, 23, 59, 59);
      final startDate = now.toIso8601String();
      final endDate = endOfDay.toIso8601String();

      final response = await _dio.get(
        '/calendar/events',
        queryParameters: {
          'source': 'crm',
          'startDate': startDate,
          'endDate': endDate,
        },
      );

      if (response.statusCode == 200) {
        final data = response.data;
        final List<dynamic> items = data is Map
            ? (data['data'] ?? [])
            : (data is List ? data : []);

        final events = items
            .map((e) => CalendarEvent.fromJson(e is Map<String, dynamic> ? e : {}))
            .where((e) => e.title.isNotEmpty && e.startDateTime != null)
            .where((e) => e.startDateTime!.isAfter(now.subtract(const Duration(minutes: 30))))
            .toList();

        // Sort by start time
        events.sort((a, b) => a.startDateTime!.compareTo(b.startDateTime!));

        // Return at most 3
        return events.take(3).toList();
      }
    } catch (e) {
      print('[Events] API error: $e');
    }
    return [];
  }

  /// Format events for Frame display (max 3 lines, ~30 chars each).
  String _formatForFrame(List<CalendarEvent> events) {
    final lines = <String>[];
    final timeFormat = DateFormat('HH:mm');

    for (final event in events.take(3)) {
      final time = event.startDateTime != null
          ? timeFormat.format(event.startDateTime!)
          : '??:??';
      // Truncate title to fit Frame display (~25 chars after time)
      var title = event.title;
      if (title.length > 24) {
        title = '${title.substring(0, 22)}..';
      }
      lines.add('$time $title');
    }

    return lines.join('\n');
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }
}

/// Simple calendar event model.
class CalendarEvent {
  final int? id;
  final String title;
  final DateTime? startDateTime;
  final DateTime? endDateTime;
  final String? description;

  const CalendarEvent({
    this.id,
    required this.title,
    this.startDateTime,
    this.endDateTime,
    this.description,
  });

  factory CalendarEvent.fromJson(Map<String, dynamic> json) {
    DateTime? parseDate(dynamic value) {
      if (value == null) return null;
      if (value is String && value.isNotEmpty) {
        return DateTime.tryParse(value);
      }
      return null;
    }

    return CalendarEvent(
      id: json['id'] is int ? json['id'] : null,
      title: json['title']?.toString() ?? json['summary']?.toString() ?? '',
      startDateTime: parseDate(json['start_datetime'] ?? json['start']),
      endDateTime: parseDate(json['end_datetime'] ?? json['end']),
      description: json['description']?.toString(),
    );
  }
}

/// Dio provider (reuse existing API client).
final _dioProvider = Provider<Dio>((ref) => ref.watch(apiClientProvider));

/// Frame events provider — watches connection state and refreshes events.
final frameEventsProvider =
    StateNotifierProvider<FrameEventsNotifier, List<CalendarEvent>>((ref) {
  final dio = ref.watch(_dioProvider);
  final frameRepo = ref.watch(frameRepositoryProvider);
  final frameState = ref.watch(frameConnectionProvider);

  return FrameEventsNotifier(dio, frameRepo, frameState.isConnected);
});
