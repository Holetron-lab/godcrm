import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/pes_models.dart';
import '../data/pes_repository.dart';

/// Main PES status provider — polls every 10 seconds for live updates.
final pesStatusProvider = AsyncNotifierProvider<PesStatusNotifier, PesStatus>(
  PesStatusNotifier.new,
);

class PesStatusNotifier extends AsyncNotifier<PesStatus> {
  Timer? _pollTimer;

  @override
  Future<PesStatus> build() async {
    ref.onDispose(() => _pollTimer?.cancel());
    _startPolling();
    return _fetch();
  }

  Future<PesStatus> _fetch() async {
    final repo = ref.read(pesRepositoryProvider);
    return repo.getStatus();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 10), (_) async {
      try {
        final status = await _fetch();
        state = AsyncData(status);
      } catch (_) {
        // Keep last known state on error
      }
    });
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }
}

/// XP log provider.
final pesXpLogProvider = FutureProvider<List<PesXpEntry>>((ref) async {
  final repo = ref.watch(pesRepositoryProvider);
  return repo.getXpLog(limit: 30);
});

/// Timeline provider (7-day activity).
final pesTimelineProvider = FutureProvider<List<PesTimelineEntry>>((ref) async {
  final repo = ref.watch(pesRepositoryProvider);
  return repo.getTimeline(days: 7);
});
