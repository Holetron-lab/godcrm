import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../shared/utils/api_client.dart';
import 'pes_models.dart';

/// PES API repository — connects to /api/v3/pes/* endpoints.
class PesRepository {
  final Dio _dio;

  PesRepository(this._dio);

  Future<PesStatus> getStatus() async {
    final response = await _dio.get('/pes/status');
    final data = response.data;
    final payload = data is Map && data.containsKey('data') ? data['data'] : data;
    return PesStatus.fromJson(payload);
  }

  Future<PesEmotions> getEmotions() async {
    final response = await _dio.get('/pes/emotions');
    final data = response.data;
    final payload = data is Map && data.containsKey('data') ? data['data'] : data;
    return PesEmotions.fromJson(payload);
  }

  Future<Map<String, double>> getTraits() async {
    final response = await _dio.get('/pes/traits');
    final data = response.data;
    final payload = data is Map && data.containsKey('data') ? data['data'] : data;
    final current = payload['current'] ?? payload;
    return (current as Map).map((k, v) => MapEntry(k.toString(), (v ?? 0).toDouble()));
  }

  Future<List<PesXpEntry>> getXpLog({int limit = 50}) async {
    final response = await _dio.get('/pes/xp', queryParameters: {'limit': limit});
    final data = response.data;
    final list = data is Map && data.containsKey('data') ? data['data'] : data;
    if (list is! List) return [];
    return list.map((e) => PesXpEntry.fromJson(e)).toList();
  }

  Future<List<PesTimelineEntry>> getTimeline({int days = 7}) async {
    final response = await _dio.get('/pes/timeline', queryParameters: {'days': days});
    final data = response.data;
    final list = data is Map && data.containsKey('data') ? data['data'] : data;
    if (list is! List) return [];
    return list.map((e) => PesTimelineEntry.fromJson(e)).toList();
  }

  Future<void> pushEvent(String type, [Map<String, dynamic>? eventData]) async {
    await _dio.post('/pes/events', data: {
      'type': type,
      'data': eventData ?? {},
    });
  }
}

final pesRepositoryProvider = Provider<PesRepository>((ref) {
  final dio = ref.watch(apiClientProvider);
  return PesRepository(dio);
});
