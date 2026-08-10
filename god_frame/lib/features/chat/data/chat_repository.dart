import 'package:dio/dio.dart';
import '../../../core/config.dart';
import '../../../shared/utils/api_client.dart';
import 'models.dart';

/// Safely extract error message from DioException response.
/// Prevents "type 'String' is not a subtype of type 'int' of 'index'"
/// when Dio returns a non-JSON (String) response body.
String _extractDioError(DioException e) {
  final data = e.response?.data;
  if (data is Map) {
    final errObj = data['error'];
    if (errObj is Map) {
      return (errObj['message'] ?? errObj['detail'])?.toString() ?? 'Request failed';
    }
    return (data['error'] ?? data['message'] ?? data['detail'])?.toString() ??
        e.message ?? 'Connection error';
  }
  if (data is String && data.isNotEmpty) {
    // Truncate long HTML/text error pages
    return data.length > 200 ? '${data.substring(0, 200)}...' : data;
  }
  return e.message ?? 'Connection error';
}

/// Repository for chat operations against GOD CRM backend.
class ChatRepository {
  final Dio _dio;

  ChatRepository(this._dio);

  /// List spaces available to the user.
  Future<ApiResult<List<Space>>> getSpaces() async {
    try {
      final response = await _dio.get(AppConfig.spacesPath);

      if (response.statusCode == 200) {
        final body = response.data;
        final List items = body is Map && body.containsKey('data')
            ? (body['data'] is List ? body['data'] : [body['data']])
            : (body is List ? body : []);

        final spaces = items
            .where((s) => s is Map)
            .map((s) => Space.fromJson(s as Map<String, dynamic>))
            .toList();

        return ApiResult.success(spaces);
      }

      return ApiResult.failure('Failed to load spaces', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// List all conversations for the current user.
  Future<ApiResult<List<Conversation>>> getConversations({
    int limit = 50,
    int offset = 0,
    int? spaceId,
  }) async {
    try {
      final params = <String, dynamic>{'limit': limit, 'offset': offset};
      if (spaceId != null) params['space_id'] = spaceId;

      final response = await _dio.get(
        AppConfig.conversationsPath,
        queryParameters: params,
      );

      if (response.statusCode == 200) {
        final body = response.data;
        // Support both old format (data = array) and new paginated format (data = { conversations: [...], ... })
        List items;
        if (body is Map && body.containsKey('data')) {
          final data = body['data'];
          if (data is List) {
            items = data;
          } else if (data is Map && data.containsKey('conversations')) {
            items = data['conversations'] is List ? data['conversations'] : [];
          } else {
            items = [data];
          }
        } else {
          items = body is List ? body : [];
        }

        final conversations = items
            .where((c) => c is Map)
            .map((c) => Conversation.fromJson(c as Map<String, dynamic>))
            .toList();

        return ApiResult.success(conversations);
      }

      return ApiResult.failure('Failed to load conversations', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Get a single conversation with messages.
  /// Filters out heavy tool/thinking messages to reduce payload (6MB+ → ~200KB).
  Future<ApiResult<ConversationDetail>> getConversation(int id) async {
    try {
      final response = await _dio.get(
        '${AppConfig.conversationsPath}/$id',
        queryParameters: {'content_types': 'text,system,call,plan'},
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final data = body is Map && body.containsKey('data') ? body['data'] : body;
        return ApiResult.success(ConversationDetail.fromJson(data));
      }

      return ApiResult.failure('Conversation not found', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Get older messages before a given message ID (pagination / load more).
  /// Uses the `before` query param supported by GET /conversations/:id.
  Future<ApiResult<ConversationDetail>> getConversationBefore(int id, int beforeId) async {
    try {
      final response = await _dio.get(
        '${AppConfig.conversationsPath}/$id',
        queryParameters: {'before': beforeId.toString(), 'limit': '50'},
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final data = body is Map && body.containsKey('data') ? body['data'] : body;
        return ApiResult.success(ConversationDetail.fromJson(data));
      }

      return ApiResult.failure('Failed to load older messages', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Get new messages since a given message ID (incremental polling).
  /// Uses GET /conversations/:id/messages?after=<messageId>
  /// Returns new messages + processing state for real-time streaming.
  Future<ApiResult<IncrementalPollResult>> getNewMessages(
    int conversationId, {
    int? afterId,
  }) async {
    try {
      final params = <String, dynamic>{};
      if (afterId != null && afterId > 0) {
        params['after'] = afterId.toString();
      }

      final response = await _dio.get(
        '${AppConfig.conversationsPath}/$conversationId/messages',
        queryParameters: params,
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final data = body is Map && body.containsKey('data')
            ? body['data']
            : body;
        if (data is Map<String, dynamic>) {
          return ApiResult.success(IncrementalPollResult.fromJson(data));
        }
        return ApiResult.success(const IncrementalPollResult(
          messages: [],
          isProcessing: false,
        ));
      }

      return ApiResult.failure('Failed to fetch messages', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Create a new conversation.
  Future<ApiResult<Conversation>> createConversation({
    String? title,
    List<int>? participantIds,
  }) async {
    try {
      final data = <String, dynamic>{
        'title': title ?? 'New Conversation',
      };
      if (participantIds != null && participantIds.isNotEmpty) {
        data['participant_ids'] = participantIds;
      }
      final response = await _dio.post(
        AppConfig.conversationsPath,
        data: data,
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.data;
        final data = body is Map && body.containsKey('data') ? body['data'] : body;
        return ApiResult.success(Conversation.fromJson(data));
      }

      return ApiResult.failure('Failed to create conversation', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Send a message to a conversation.
  /// Supports @agent mentions in the content.
  /// Optionally includes pre-uploaded attachments metadata.
  Future<ApiResult<Message>> sendMessage(
    int conversationId,
    String content, {
    List<Map<String, dynamic>>? attachments,
  }) async {
    try {
      final data = <String, dynamic>{
        'content': content,
        'role': 'user',
      };

      if (attachments != null && attachments.isNotEmpty) {
        data['attachments'] = attachments;
      }

      final response = await _dio.post(
        '${AppConfig.conversationsPath}/$conversationId/messages',
        data: data,
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.data;
        final respData = body is Map && body.containsKey('data') ? body['data'] : body;

        if (respData is Map<String, dynamic>) {
          return ApiResult.success(Message.fromJson(respData));
        }
        return ApiResult.success(Message(
          id: 0,
          conversationId: conversationId,
          role: 'user',
          content: content,
          createdAt: DateTime.now().toIso8601String(),
        ));
      }

      return ApiResult.failure('Failed to send message', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Guess MIME type from file extension.
  String? _guessContentType(String fileName) {
    final ext = fileName.split('.').last.toLowerCase();
    switch (ext) {
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'pdf': return 'application/pdf';
      case 'mp4': return 'video/mp4';
      case 'mp3': return 'audio/mpeg';
      default: return null;
    }
  }

  /// Upload files to the CRM backend.
  /// Returns a list of attachment metadata maps with {id, name, url, type, size}.
  Future<ApiResult<List<Map<String, dynamic>>>> uploadFiles(
    List<String> filePaths, {
    int? spaceId,
  }) async {
    try {
      final formData = FormData();

      for (final path in filePaths) {
        final fileName = path.split('/').last;
        final contentType = _guessContentType(fileName);
        formData.files.add(MapEntry(
          'files',
          await MultipartFile.fromFile(
            path,
            filename: fileName,
            contentType: contentType != null
                ? DioMediaType.parse(contentType)
                : null,
          ),
        ));
      }

      if (spaceId != null) {
        formData.fields.add(MapEntry('spaceId', spaceId.toString()));
      }

      final response = await _dio.post(
        AppConfig.uploadPath,
        data: formData,
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.data;

        // Backend can return single file or array
        final List rawFiles;
        if (body is Map && body.containsKey('data')) {
          final data = body['data'];
          rawFiles = data is List ? data : [data];
        } else if (body is Map && body.containsKey('files')) {
          rawFiles = body['files'] is List ? body['files'] : [body['files']];
        } else if (body is List) {
          rawFiles = body;
        } else if (body is Map) {
          rawFiles = [body];
        } else {
          rawFiles = [];
        }

        final attachments = rawFiles.map<Map<String, dynamic>>((f) {
          if (f is! Map) return {};
          final m = Map<String, dynamic>.from(f);
          return {
            'id': m['id']?.toString() ?? '',
            'name': m['name'] ?? m['filename'] ?? m['originalName'] ?? 'file',
            'url': m['url'] ?? m['file_url'] ?? m['path'] ?? '',
            'type': m['mime_type'] ?? m['mimeType'] ?? m['type'] ?? '',
            'size': m['size'] ?? 0,
          };
        }).where((m) => m.isNotEmpty).toList();

        return ApiResult.success(attachments);
      }

      final errMsg = response.data is Map
          ? (response.data['error']?['message'] ?? response.data['message'] ?? 'Upload failed').toString()
          : 'Upload failed (${response.statusCode})';
      return ApiResult.failure(errMsg, response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        'Upload error: ${_extractDioError(e)}',
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure('Upload error: $e');
    }
  }

  /// Bind a CRM table row to a conversation.
  /// PUT /ai/conversations/:id with bound_table_id and bound_row_id.
  Future<ApiResult<bool>> bindRow(int conversationId, int tableId, int rowId) async {
    try {
      final response = await _dio.put(
        '${AppConfig.aiConversationsPath}/$conversationId',
        data: {'bound_table_id': tableId, 'bound_row_id': rowId},
      );

      if (response.statusCode == 200 || response.statusCode == 201 || response.statusCode == 204) {
        return ApiResult.success(true);
      }

      // Fallback: try PATCH on chat path
      final fallback = await _dio.patch(
        '${AppConfig.conversationsPath}/$conversationId',
        data: {'bound_table_id': tableId, 'bound_row_id': rowId},
      );
      if (fallback.statusCode == 200 || fallback.statusCode == 204) {
        return ApiResult.success(true);
      }

      return ApiResult.failure('Failed to bind row', response.statusCode);
    } on DioException catch (e) {
      // Try fallback on 404/405
      if (e.response?.statusCode == 404 || e.response?.statusCode == 405) {
        try {
          final fallback = await _dio.patch(
            '${AppConfig.conversationsPath}/$conversationId',
            data: {'bound_table_id': tableId, 'bound_row_id': rowId},
          );
          if (fallback.statusCode == 200 || fallback.statusCode == 204) {
            return ApiResult.success(true);
          }
        } catch (_) {}
      }
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Add a participant to a conversation.
  /// POST /chat/conversations/:id/participants
  Future<ApiResult<bool>> addParticipant(int conversationId, int userId) async {
    try {
      final response = await _dio.post(
        '${AppConfig.conversationsPath}/$conversationId/participants',
        data: {'user_id': userId},
      );

      if (response.statusCode == 200 || response.statusCode == 201 || response.statusCode == 204) {
        return ApiResult.success(true);
      }

      return ApiResult.failure('Failed to add participant', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Update conversation title (rename).
  /// Backend endpoint: PUT /api/v3/ai/conversations/:conversationId
  Future<ApiResult<bool>> updateConversationTitle(int id, String title) async {
    // Primary endpoint: PUT /ai/conversations/:id (ai-agents.js)
    try {
      final response = await _dio.put(
        '${AppConfig.aiConversationsPath}/$id',
        data: {'title': title},
      );

      if (response.statusCode == 200 || response.statusCode == 201 || response.statusCode == 204) {
        return ApiResult.success(true);
      }

      // Non-error status but unexpected code
      final body = response.data;
      if (body is Map && body['id'] != null) {
        return ApiResult.success(true); // Backend returned the conversation — success
      }

      return ApiResult.failure(
        'Rename returned status ${response.statusCode}',
        response.statusCode,
      );
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      final errMsg = _extractDioError(e);

      print('[Rename] PUT /ai/conversations/$id failed: $status $errMsg');

      // If 403/404 on primary endpoint, try fallback via chat path
      if (status == 404 || status == 405) {
        return _renameFallback(id, title);
      }

      return ApiResult.failure(errMsg, status);
    } catch (e) {
      print('[Rename] Exception: $e');
      return _renameFallback(id, title);
    }
  }

  /// Fallback rename via PATCH /chat/conversations/:id
  Future<ApiResult<bool>> _renameFallback(int id, String title) async {
    try {
      final response = await _dio.patch(
        '${AppConfig.conversationsPath}/$id',
        data: {'title': title},
      );

      if (response.statusCode == 200 || response.statusCode == 204) {
        return ApiResult.success(true);
      }
      return ApiResult.failure('Rename failed (fallback: ${response.statusCode})');
    } on DioException catch (e) {
      return ApiResult.failure('Rename failed: ${_extractDioError(e)}');
    } catch (e) {
      return ApiResult.failure('Rename error: $e');
    }
  }

  /// Get dynamic ticket statuses from the relation table linked to the tickets table.
  Future<ApiResult<List<TicketStatus>>> getTicketStatuses({int? spaceId}) async {
    try {
      final tableId = await _findTicketTableForSpace(spaceId);
      final columns = await _getTableColumns(tableId);

      // Find the state/status column with a relation config
      int? statesTableId;
      for (final col in columns) {
        final colName = (col['column_name'] ?? col['name'])?.toString()?.toLowerCase() ?? '';
        if (colName == 'state' || colName == 'status') {
          final config = col['config'];
          if (config is Map) {
            final relation = config['relation'];
            if (relation is Map && relation['enabled'] == true) {
              statesTableId = int.tryParse(relation['tableId'].toString());
              break;
            }
          }
        }
      }

      if (statesTableId == null) {
        print('[Statuses] No relation table found for state column, using defaults');
        return ApiResult.success(List<TicketStatus>.from(defaultTicketStatuses));
      }

      // Fetch rows from the states relation table
      final response = await _dio.get('${AppConfig.tablesPath}/$statesTableId/rows');
      if (response.statusCode == 200) {
        final items = _extractRowsList(response.data);
        final statuses = items
            .whereType<Map>()
            .map((m) => TicketStatus.fromJson(Map<String, dynamic>.from(m)))
            .toList();
        statuses.sort((a, b) => a.order.compareTo(b.order));
        print('[Statuses] Loaded ${statuses.length} statuses from table $statesTableId');
        return ApiResult.success(statuses);
      }

      return ApiResult.success(List<TicketStatus>.from(defaultTicketStatuses));
    } catch (e) {
      print('[Statuses] Error: $e');
      return ApiResult.success(List<TicketStatus>.from(defaultTicketStatuses));
    }
  }

  /// Get dynamic ticket priorities from the relation table linked to the tickets table.
  Future<ApiResult<List<TicketPriority>>> getTicketPriorities({int? spaceId}) async {
    try {
      final tableId = await _findTicketTableForSpace(spaceId);
      final columns = await _getTableColumns(tableId);

      // Find the priority column with a relation config
      int? prioritiesTableId;
      for (final col in columns) {
        final colName = (col['column_name'] ?? col['name'])?.toString()?.toLowerCase() ?? '';
        if (colName == 'priority') {
          final config = col['config'];
          if (config is Map) {
            final relation = config['relation'];
            if (relation is Map && relation['enabled'] == true) {
              prioritiesTableId = int.tryParse(relation['tableId'].toString());
              break;
            }
          }
        }
      }

      if (prioritiesTableId == null) {
        print('[Priorities] No relation table found for priority column, using defaults');
        return ApiResult.success(List<TicketPriority>.from(defaultTicketPriorities));
      }

      // Fetch rows from the priorities relation table
      final response = await _dio.get('${AppConfig.tablesPath}/$prioritiesTableId/rows');
      if (response.statusCode == 200) {
        final items = _extractRowsList(response.data);
        final priorities = items
            .whereType<Map>()
            .map((m) => TicketPriority.fromJson(Map<String, dynamic>.from(m)))
            .toList();
        priorities.sort((a, b) => a.level.compareTo(b.level));
        print('[Priorities] Loaded ${priorities.length} priorities from table $prioritiesTableId');
        return ApiResult.success(priorities);
      }

      return ApiResult.success(List<TicketPriority>.from(defaultTicketPriorities));
    } catch (e) {
      print('[Priorities] Error: $e');
      return ApiResult.success(List<TicketPriority>.from(defaultTicketPriorities));
    }
  }

  /// Get tickets from the CRM backend.
  /// Always uses table-based approach with full relation resolution
  /// to ensure type, state, priority, assigned_to show labels not IDs.
  Future<ApiResult<List<Ticket>>> getTickets({int? spaceId}) async {
    // Always use table-based approach — it resolves relation fields
    // (type, state, priority, assigned_to) from numeric IDs to labels.
    // The dedicated /tickets endpoint returns raw data without resolution.
    return _getTicketsFromTable(spaceId: spaceId);
  }

  /// Find the ticket/task table for a given space, or default to 1708.
  Future<int> _findTicketTableForSpace(int? spaceId) async {
    if (spaceId == null) return 1708;

    try {
      final tablesResult = await getTables(spaceId: spaceId);
      if (tablesResult.isSuccess && tablesResult.data != null) {
        final tables = tablesResult.data!;
        // Priority order: exact "Tickets" > exact "Tasks" > contains patterns
        // First pass: exact match
        for (final t in tables) {
          final name = t.name.toLowerCase().trim();
          if (name == 'tickets' || name == 'tasks') {
            print('[Tickets] Found exact match table "${t.name}" (id=${t.id}) for space $spaceId');
            return t.id;
          }
        }
        // Second pass: partial match
        for (final t in tables) {
          final name = t.name.toLowerCase();
          if (name.contains('ticket') || name.contains('task') ||
              name == 'my tasks data' || name.contains('задач') ||
              name.contains('тикет')) {
            print('[Tickets] Found partial match table "${t.name}" (id=${t.id}) for space $spaceId');
            return t.id;
          }
        }
        print('[Tickets] No ticket/task table found for space $spaceId among ${tables.length} tables');
      }
    } catch (e) {
      print('[Tickets] Error finding table for space $spaceId: $e');
    }
    return 1708;
  }

  /// Fetch column definitions for a table.
  Future<List<Map<String, dynamic>>> _getTableColumns(int tableId) async {
    try {
      final response = await _dio.get('${AppConfig.tablesPath}/$tableId/columns');
      if (response.statusCode == 200) {
        final body = response.data;
        final List items;
        if (body is Map && body.containsKey('data')) {
          items = body['data'] is List ? body['data'] as List : [body['data']];
        } else if (body is List) {
          items = body;
        } else {
          items = [];
        }
        return items
            .whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m))
            .toList();
      }
    } catch (e) {
      print('[Columns] Error fetching columns for table $tableId: $e');
    }
    return [];
  }

  /// Resolve relation IDs to display labels in row data.
  /// Fetches related tables and builds lookup maps.
  Future<List<Map<String, dynamic>>> _resolveRelations(
    List<Map<String, dynamic>> rows,
    List<Map<String, dynamic>> columns,
  ) async {
    // 1. Find columns with relation config
    final relationCols = <String, Map<String, dynamic>>{};
    for (final col in columns) {
      final config = col['config'];
      if (config is! Map) continue;
      final relation = config['relation'];
      if (relation is! Map) continue;
      if (relation['enabled'] != true) continue;
      final relTableId = relation['tableId'];
      if (relTableId == null) continue;

      final colName = (col['column_name'] ?? col['name'])?.toString();
      if (colName != null) {
        relationCols[colName] = Map<String, dynamic>.from(relation);
      }
    }

    if (relationCols.isEmpty) return rows;

    // 2. Collect unique related table IDs
    final relatedTableIds = <int>{};
    for (final rel in relationCols.values) {
      final tid = int.tryParse(rel['tableId'].toString());
      if (tid != null) relatedTableIds.add(tid);
    }

    // 3. Fetch related table rows and build lookup maps
    // Maps: relatedTableId -> { valueColumnValue -> labelColumnValue }
    final lookups = <int, Map<String, String>>{};

    for (final relTableId in relatedTableIds) {
      try {
        final response = await _dio.get('${AppConfig.tablesPath}/$relTableId/rows');
        if (response.statusCode != 200) continue;

        final body = response.data;
        final List items;
        if (body is Map && body.containsKey('data')) {
          final d = body['data'];
          items = d is List ? d : (d is Map && d.containsKey('rows') ? d['rows'] as List : []);
        } else if (body is Map && body.containsKey('rows')) {
          items = body['rows'] is List ? body['rows'] as List : [];
        } else {
          items = [];
        }

        final map = <String, String>{};
        for (final item in items) {
          if (item is! Map) continue;
          final rowId = item['id'];
          final rowData = item['data'] is Map
              ? Map<String, dynamic>.from(item['data'] as Map)
              : <String, dynamic>{};

          // Find which relation columns reference this table
          for (final relEntry in relationCols.entries) {
            final rel = relEntry.value;
            final tid = int.tryParse(rel['tableId'].toString());
            if (tid != relTableId) continue;

            final valueCol = (rel['valueColumn'] ?? 'id').toString();
            final labelCol = (rel['labelColumn'] ?? 'name').toString();
            final label = (rowData[labelCol] ?? rowData['name'] ?? rowData['title'] ?? '').toString();

            if (label.isEmpty) continue;

            if (valueCol == 'id') {
              // Standard: match by row ID
              map[rowId.toString()] = label;
            } else {
              // Custom: match by a data field (e.g., system_user_id)
              final keyVal = rowData[valueCol];
              if (keyVal != null) {
                map[keyVal.toString()] = label;
              }
              // Also store by row ID as fallback
              map[rowId.toString()] = label;
            }
          }
        }
        lookups[relTableId] = map;
      } catch (e) {
        print('[Relations] Error fetching table $relTableId: $e');
      }
    }

    // 4. Replace IDs with labels in row data
    final resolvedRows = <Map<String, dynamic>>[];
    for (final row in rows) {
      final data = row['data'] is Map
          ? Map<String, dynamic>.from(row['data'] as Map)
          : Map<String, dynamic>.from(row);

      for (final entry in relationCols.entries) {
        final colName = entry.key;
        final rel = entry.value;
        final relTableId = int.tryParse(rel['tableId'].toString());
        if (relTableId == null) continue;

        final lookup = lookups[relTableId];
        if (lookup == null) continue;

        final rawValue = data[colName];
        if (rawValue == null) continue;

        final label = lookup[rawValue.toString()];
        if (label != null && label.isNotEmpty) {
          data[colName] = label;
        }
      }

      resolvedRows.add({...row, 'data': data});
    }

    return resolvedRows;
  }

  /// Get tickets from table rows with relation resolution.
  Future<ApiResult<List<Ticket>>> _getTicketsFromTable({int? spaceId}) async {
    try {
      final tableId = await _findTicketTableForSpace(spaceId);
      print('[Tickets] Loading from table $tableId (space: $spaceId)');

      // Fetch columns and rows in parallel
      final columnsFuture = _getTableColumns(tableId);
      final params = <String, dynamic>{'limit': 500};
      if (spaceId != null) params['space_id'] = spaceId;
      final rowsFuture = _dio.get(
        '${AppConfig.tablesPath}/$tableId/rows',
        queryParameters: params,
      );

      final columns = await columnsFuture;
      final response = await rowsFuture;

      if (response.statusCode == 200) {
        // Parse raw rows
        final rawItems = _extractRowsList(response.data);
        final rawRows = rawItems
            .whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m))
            .toList();

        print('[Tickets] Got ${rawRows.length} raw rows, ${columns.length} columns');

        // Resolve relation values (type, state, priority, assigned_to → labels)
        final resolvedRows = columns.isNotEmpty
            ? await _resolveRelations(rawRows, columns)
            : rawRows;

        // Set table_id on each row for status updates
        final tickets = resolvedRows.map((t) {
          if (t['table_id'] == null) t['table_id'] = tableId;
          return Ticket.fromJson(t);
        }).toList();

        print('[Tickets] Resolved ${tickets.length} tickets');
        return ApiResult.success(tickets);
      }
      return ApiResult.failure('No tickets found');
    } catch (e) {
      print('[Tickets] Error: $e');
      return ApiResult.failure('Tickets not available: $e');
    }
  }

  /// Extract rows list from various API response shapes.
  List _extractRowsList(dynamic body) {
    if (body is Map && body.containsKey('data')) {
      final data = body['data'];
      return data is List
          ? data
          : (data is Map && data.containsKey('rows') ? data['rows'] as List : [data]);
    } else if (body is Map && body.containsKey('rows')) {
      return body['rows'] is List ? body['rows'] as List : [body['rows']];
    } else if (body is List) {
      return body;
    }
    return [];
  }

  ApiResult<List<Ticket>> _parseTickets(dynamic body) {
    final items = _extractRowsList(body);

    final tickets = items
        .where((t) => t is Map)
        .map((t) => Ticket.fromJson(Map<String, dynamic>.from(t as Map)))
        .toList();

    return ApiResult.success(tickets);
  }

  /// Get users/contacts from the CRM.
  Future<ApiResult<List<Contact>>> getContacts() async {
    try {
      final response = await _dio.get(AppConfig.usersPath);

      if (response.statusCode == 200) {
        final body = response.data;
        final List items = body is Map && body.containsKey('data')
            ? (body['data'] is List ? body['data'] : [body['data']])
            : (body is List ? body : []);

        final contacts = items
            .where((c) => c is Map)
            .map((c) => Contact.fromJson(Map<String, dynamic>.from(c as Map)))
            .toList();

        return ApiResult.success(contacts);
      }

      return ApiResult.failure('Failed to load contacts', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// List projects in a space (for hierarchical row picker).
  Future<ApiResult<List<CrmProject>>> getProjects({int? spaceId}) async {
    try {
      final params = <String, dynamic>{};
      if (spaceId != null) params['space_id'] = spaceId;

      final response = await _dio.get(
        AppConfig.projectsPath,
        queryParameters: params,
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final List items = body is Map && body.containsKey('data')
            ? (body['data'] is List ? body['data'] : [body['data']])
            : (body is List ? body : []);

        final projects = items
            .where((p) => p is Map)
            .map((p) => CrmProject.fromJson(Map<String, dynamic>.from(p as Map)))
            .toList();

        return ApiResult.success(projects);
      }

      return ApiResult.failure('Failed to load projects', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// List available CRM tables (for linking rows to chat).
  Future<ApiResult<List<CrmTable>>> getTables({int? spaceId, int? projectId}) async {
    try {
      final params = <String, dynamic>{};
      if (spaceId != null) params['space_id'] = spaceId;
      if (projectId != null) params['project_id'] = projectId;

      final response = await _dio.get(
        AppConfig.tablesPath,
        queryParameters: params,
      );

      if (response.statusCode == 200) {
        final body = response.data;
        final List items = body is Map && body.containsKey('data')
            ? (body['data'] is List ? body['data'] : [body['data']])
            : (body is List ? body : []);

        final tables = items
            .where((t) => t is Map)
            .map((t) => CrmTable.fromJson(Map<String, dynamic>.from(t as Map)))
            .toList();

        return ApiResult.success(tables);
      }

      return ApiResult.failure('Failed to load tables', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Get rows from a specific table (for linking to chat).
  Future<ApiResult<List<CrmTableRow>>> getTableRows(int tableId) async {
    try {
      final response = await _dio.get('${AppConfig.tablesPath}/$tableId/rows');

      if (response.statusCode == 200) {
        final body = response.data;
        final List items;
        if (body is Map && body.containsKey('data')) {
          final data = body['data'];
          items = data is List ? data : (data is Map && data.containsKey('rows') ? data['rows'] : [data]);
        } else if (body is Map && body.containsKey('rows')) {
          items = body['rows'] is List ? body['rows'] : [body['rows']];
        } else if (body is List) {
          items = body;
        } else {
          items = [];
        }

        final rows = items
            .where((r) => r is Map)
            .map((r) => CrmTableRow.fromJson(Map<String, dynamic>.from(r as Map), tableId))
            .toList();

        return ApiResult.success(rows);
      }

      return ApiResult.failure('Failed to load rows', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Find the AI Agents table for a given space, or default to 1784.
  Future<int> _findAgentsTableForSpace(int? spaceId) async {
    if (spaceId == null) return 1784;

    try {
      final tablesResult = await getTables(spaceId: spaceId);
      if (tablesResult.isSuccess && tablesResult.data != null) {
        final tables = tablesResult.data!;
        // Look for "AI Agents" or "Agents" table
        for (final t in tables) {
          final name = t.name.toLowerCase().trim();
          if (name == 'ai agents' || name == 'agents' || name == 'ai_agents') {
            print('[Agents] Found agents table "${t.name}" (id=${t.id}) for space $spaceId');
            return t.id;
          }
        }
        // Partial match
        for (final t in tables) {
          final name = t.name.toLowerCase();
          if (name.contains('agent') && !name.contains('activity') && !name.contains('doc_')) {
            print('[Agents] Found partial match agents table "${t.name}" (id=${t.id}) for space $spaceId');
            return t.id;
          }
        }
        print('[Agents] No agents table found for space $spaceId among ${tables.length} tables');
      }
    } catch (e) {
      print('[Agents] Error finding agents table for space $spaceId: $e');
    }
    return 1784;
  }

  /// Get list of available agents for @mentions.
  /// If spaceId is provided, loads agents from the space's own AI Agents table.
  Future<ApiResult<List<Agent>>> getAgents({int? spaceId}) async {
    try {
      final tableId = await _findAgentsTableForSpace(spaceId);
      print('[Agents] Loading from table $tableId (space: $spaceId)');
      final response = await _dio.get('${AppConfig.tablesPath}/$tableId/rows');

      if (response.statusCode == 200) {
        final body = response.data;
        final List items;
        if (body is Map && body.containsKey('data')) {
          final data = body['data'];
          items = data is List ? data : (data is Map && data.containsKey('rows') ? data['rows'] : [data]);
        } else if (body is Map && body.containsKey('rows')) {
          items = body['rows'] is List ? body['rows'] : [body['rows']];
        } else if (body is List) {
          items = body;
        } else {
          items = [];
        }

        final agents = items
            .where((a) => a is Map)
            .map((a) => Agent.fromJson(Map<String, dynamic>.from(a as Map)))
            .toList();

        print('[Agents] Loaded ${agents.length} agents from table $tableId');
        return ApiResult.success(agents);
      }

      return ApiResult.failure('Failed to load agents', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Update ticket status in CRM.
  Future<ApiResult<bool>> updateTicketStatus(int ticketId, String newStatus, {int? tableId}) async {
    try {
      final tId = tableId ?? 1708;
      final response = await _dio.patch(
        '${AppConfig.tablesPath}/$tId/rows/$ticketId',
        data: {'data': {'status': newStatus}},
      );

      if (response.statusCode == 200 || response.statusCode == 204) {
        return ApiResult.success(true);
      }
      return ApiResult.failure('Failed to update status', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Send multipart message with file attachment (for voice/image from phone).
  Future<ApiResult<Message>> sendMessageWithFiles(
    int conversationId,
    String content,
    List<String> filePaths,
  ) async {
    try {
      final formData = FormData.fromMap({
        'content': content,
        'role': 'user',
      });

      for (final path in filePaths) {
        final fileName = path.split('/').last;
        final contentType = _guessContentType(fileName);
        formData.files.add(MapEntry(
          'files',
          await MultipartFile.fromFile(
            path,
            filename: fileName,
            contentType: contentType != null
                ? DioMediaType.parse(contentType)
                : null,
          ),
        ));
      }

      final response = await _dio.post(
        '${AppConfig.conversationsPath}/$conversationId/messages',
        data: formData,
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.data;
        final data = body is Map && body.containsKey('data') ? body['data'] : body;
        if (data is Map<String, dynamic>) {
          return ApiResult.success(Message.fromJson(data));
        }
        if (data is Map) {
          return ApiResult.success(Message.fromJson(Map<String, dynamic>.from(data)));
        }
        return ApiResult.success(Message(
          id: 0,
          conversationId: conversationId,
          role: 'user',
          content: content,
          createdAt: DateTime.now().toIso8601String(),
        ));
      }

      return ApiResult.failure('Failed to send message', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(
        _extractDioError(e),
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  // ── Scheduled Messages ──────────────────────────────────────────────

  /// List pending scheduled messages for a conversation.
  Future<ApiResult<List<ScheduledMessage>>> getScheduledMessages(int conversationId) async {
    try {
      final response = await _dio.get('/chat/conversations/$conversationId/scheduled-messages');
      if (response.statusCode == 200) {
        final body = response.data;
        final List raw = body is Map && body.containsKey('scheduled_messages')
            ? body['scheduled_messages']
            : (body is List ? body : []);
        final items = raw
            .whereType<Map>()
            .map((m) => ScheduledMessage.fromJson(Map<String, dynamic>.from(m)))
            .toList();
        return ApiResult.success(items);
      }
      return ApiResult.failure('Failed to load scheduled messages', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Schedule a new message.
  Future<ApiResult<ScheduledMessage>> scheduleMessage(
    int conversationId, {
    required String content,
    required String scheduledAt,
  }) async {
    try {
      final response = await _dio.post(
        '/chat/conversations/$conversationId/scheduled-messages',
        data: {'content': content, 'scheduled_at': scheduledAt},
      );
      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.data;
        final json = body is Map && body.containsKey('scheduled_message')
            ? body['scheduled_message']
            : body;
        return ApiResult.success(ScheduledMessage.fromJson(Map<String, dynamic>.from(json)));
      }
      return ApiResult.failure('Failed to schedule message', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Edit a pending scheduled message.
  Future<ApiResult<ScheduledMessage>> editScheduledMessage(
    int scheduledMessageId, {
    String? content,
    String? scheduledAt,
  }) async {
    try {
      final data = <String, dynamic>{};
      if (content != null) data['content'] = content;
      if (scheduledAt != null) data['scheduled_at'] = scheduledAt;
      final response = await _dio.put('/chat/scheduled-messages/$scheduledMessageId', data: data);
      if (response.statusCode == 200) {
        final body = response.data;
        final json = body is Map && body.containsKey('scheduled_message')
            ? body['scheduled_message']
            : body;
        return ApiResult.success(ScheduledMessage.fromJson(Map<String, dynamic>.from(json)));
      }
      return ApiResult.failure('Failed to edit scheduled message', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Cancel (delete) a pending scheduled message.
  Future<ApiResult<bool>> cancelScheduledMessage(int scheduledMessageId) async {
    try {
      final response = await _dio.delete('/chat/scheduled-messages/$scheduledMessageId');
      if (response.statusCode == 200) return ApiResult.success(true);
      return ApiResult.failure('Failed to cancel', response.statusCode);
    } on DioException catch (e) {
      return ApiResult.failure(_extractDioError(e), e.response?.statusCode);
    } catch (e) {
      return ApiResult.failure(e.toString());
    }
  }

  /// Send a scheduled message immediately (cancel + send).
  Future<ApiResult<bool>> sendScheduledNow(int conversationId, ScheduledMessage sm) async {
    final cancelResult = await cancelScheduledMessage(sm.id);
    if (cancelResult.isError) return ApiResult.failure(cancelResult.error!);
    final sendResult = await sendMessage(conversationId, sm.content);
    if (sendResult.isError) return ApiResult.failure(sendResult.error!);
    return ApiResult.success(true);
  }
}

/// Conversation with full message list and pagination info.
class ConversationDetail {
  final Conversation conversation;
  final List<Message> messages;
  final bool hasMore;
  final int? nextCursor;

  const ConversationDetail({
    required this.conversation,
    required this.messages,
    this.hasMore = false,
    this.nextCursor,
  });

  factory ConversationDetail.fromJson(Map<String, dynamic> json) {
    final conversation = Conversation.fromJson(json);
    final List rawMessages = json['messages'] ?? [];
    final messages = rawMessages
        .where((m) => m is Map)
        .map((m) => Message.fromJson(m as Map<String, dynamic>))
        .toList();

    final hasMore = json['hasMore'] == true || json['has_more'] == true;
    final nextCursor = json['nextCursor'] is int
        ? json['nextCursor']
        : (json['next_cursor'] is int
            ? json['next_cursor']
            : int.tryParse('${json['nextCursor'] ?? json['next_cursor'] ?? ''}'));

    return ConversationDetail(
      conversation: conversation,
      messages: messages,
      hasMore: hasMore,
      nextCursor: nextCursor,
    );
  }
}
