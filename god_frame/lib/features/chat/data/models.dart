import 'package:flutter/painting.dart';

/// Chat data models matching GOD CRM backend.

class Conversation {
  final int id;
  final String title;
  final String? lastMessage;
  final String? lastMessageAt;
  final int messageCount;
  final int unreadCount; // Unread messages (from backend or client-side tracking)
  final String createdAt;
  final List<Participant> participants;
  // Bound row fields — linked CRM table row
  final int? boundTableId;
  final int? boundRowId;
  final String? boundRowTitle;
  final String? boundTableName;
  final String? boundTableIcon;

  const Conversation({
    required this.id,
    required this.title,
    this.lastMessage,
    this.lastMessageAt,
    required this.messageCount,
    this.unreadCount = 0,
    required this.createdAt,
    this.participants = const [],
    this.boundTableId,
    this.boundRowId,
    this.boundRowTitle,
    this.boundTableName,
    this.boundTableIcon,
  });

  /// Create a copy with updated unread count (for client-side tracking).
  Conversation copyWith({int? unreadCount}) {
    return Conversation(
      id: id,
      title: title,
      lastMessage: lastMessage,
      lastMessageAt: lastMessageAt,
      messageCount: messageCount,
      unreadCount: unreadCount ?? this.unreadCount,
      createdAt: createdAt,
      participants: participants,
      boundTableId: boundTableId,
      boundRowId: boundRowId,
      boundRowTitle: boundRowTitle,
      boundTableName: boundTableName,
      boundTableIcon: boundTableIcon,
    );
  }

  factory Conversation.fromJson(Map<String, dynamic> json) {
    // Defensive parsing — handle type mismatches gracefully
    List<Participant> participants = [];
    try {
      final rawParticipants = json['participants'];
      if (rawParticipants is List) {
        participants = rawParticipants
            .whereType<Map>()
            .map((p) => Participant.fromJson(Map<String, dynamic>.from(p)))
            .toList();
      }
    } catch (_) {
      // Silently ignore participant parsing errors
    }

    // Parse unread count — try backend field first, then compute from message_count
    final unreadCount = json['unread_count'] is int
        ? json['unread_count']
        : (json['unreadCount'] is int
            ? json['unreadCount']
            : (int.tryParse('${json['unread_count'] ?? json['unreadCount'] ?? 0}') ?? 0));

    return Conversation(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      title: json['title']?.toString() ?? 'New Conversation',
      lastMessage: (json['last_message'] ?? json['lastMessage'])?.toString(),
      lastMessageAt: (json['last_message_at'] ?? json['lastMessageAt'] ?? json['updated_at'])?.toString(),
      messageCount: json['messages_count'] is int
          ? json['messages_count']
          : (json['message_count'] is int
              ? json['message_count']
              : (json['messageCount'] is int
                  ? json['messageCount']
                  : (int.tryParse('${json['messages_count'] ?? json['message_count'] ?? json['messageCount'] ?? 0}') ?? 0))),
      unreadCount: unreadCount,
      createdAt: (json['created_at'] ?? json['createdAt'] ?? '')?.toString() ?? '',
      participants: participants,
      boundTableId: json['bound_table_id'] is int ? json['bound_table_id'] : (int.tryParse('${json['bound_table_id'] ?? ''}') ),
      boundRowId: json['bound_row_id'] is int ? json['bound_row_id'] : (int.tryParse('${json['bound_row_id'] ?? ''}') ),
      boundRowTitle: json['bound_row_title']?.toString(),
      boundTableName: json['bound_table_name']?.toString(),
      boundTableIcon: json['bound_table_icon']?.toString(),
    );
  }

  /// Time-ago string for display.
  String get timeAgo {
    final dateStr = lastMessageAt ?? createdAt;
    if (dateStr.isEmpty) return '';
    try {
      final date = DateTime.parse(dateStr);
      final diff = DateTime.now().difference(date);
      if (diff.inMinutes < 1) return 'now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m';
      if (diff.inHours < 24) return '${diff.inHours}h';
      if (diff.inDays < 7) return '${diff.inDays}d';
      return '${(diff.inDays / 7).floor()}w';
    } catch (_) {
      return '';
    }
  }
}

class Participant {
  final int id;
  final String name;
  final String? email;
  final String? avatar;
  final String role;

  const Participant({
    required this.id,
    required this.name,
    this.email,
    this.avatar,
    this.role = 'member',
  });

  factory Participant.fromJson(Map<String, dynamic> json) {
    return Participant(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: json['name']?.toString() ?? 'Unknown',
      email: json['email']?.toString(),
      avatar: json['avatar']?.toString(),
      role: json['role']?.toString() ?? 'member',
    );
  }
}

class Message {
  final int id;
  final int conversationId;
  final String role;      // 'user', 'assistant', 'system', 'tool'
  final String content;
  final String? contentType; // 'text', 'thinking', 'tool_call', 'tool_result'
  final String? agentName; // Which agent responded
  final String? agentModel;
  final List<Attachment> attachments;
  final String createdAt;
  final Map<String, dynamic>? metadata;
  final List<ToolResult>? toolResults;
  final int? iterations;

  const Message({
    required this.id,
    required this.conversationId,
    required this.role,
    required this.content,
    this.contentType,
    this.agentName,
    this.agentModel,
    this.attachments = const [],
    required this.createdAt,
    this.metadata,
    this.toolResults,
    this.iterations,
  });

  factory Message.fromJson(Map<String, dynamic> json) {
    // Safe type conversions to prevent crashes from unexpected data
    final rawContent = json['content'];
    final content = rawContent is String ? rawContent : (rawContent?.toString() ?? '');

    List<Attachment> attachments = [];
    try {
      final rawAttachments = json['attachments'];
      if (rawAttachments is List) {
        attachments = rawAttachments
            .whereType<Map>()
            .map((a) => Attachment.fromJson(Map<String, dynamic>.from(a)))
            .toList();
      }
    } catch (_) {
      // Silently ignore attachment parsing errors
    }

    return Message(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      conversationId: json['conversation_id'] is int
          ? json['conversation_id']
          : (json['conversationId'] is int
              ? json['conversationId']
              : (int.tryParse('${json['conversation_id'] ?? json['conversationId'] ?? 0}') ?? 0)),
      role: (json['role'] ?? 'user').toString(),
      content: content,
      contentType: json['content_type']?.toString() ?? json['contentType']?.toString(),
      agentName: json['agent_name']?.toString() ?? json['agentName']?.toString(),
      agentModel: json['agent_model']?.toString() ?? json['agentModel']?.toString(),
      attachments: attachments,
      createdAt: json['created_at']?.toString() ?? json['createdAt']?.toString() ?? '',
      metadata: json['metadata'] is Map ? Map<String, dynamic>.from(json['metadata']) : null,
      toolResults: _parseToolResults(json['tool_results'] ?? json['toolResults']),
      iterations: json['iterations'] is int ? json['iterations'] : null,
    );
  }

  bool get isUser => role == 'user';
  bool get isAssistant => role == 'assistant';
  bool get isSystem => role == 'system';
  bool get isTool => role == 'tool';

  /// Whether this is a call transcript message.
  bool get isCall => contentType == 'call';

  /// Parsed call dialogue from metadata.
  List<Map<String, dynamic>> get callDialogue {
    if (!isCall || metadata == null) return [];
    final d = metadata!['dialogue'];
    if (d is List) return d.cast<Map<String, dynamic>>();
    return [];
  }

  /// Call duration in seconds from metadata.
  double get callDuration {
    if (!isCall || metadata == null) return 0;
    final d = metadata!['duration'];
    if (d is num) return d.toDouble();
    return 0;
  }

  /// Call participants from metadata.
  List<String> get callParticipants {
    if (!isCall || metadata == null) return [];
    final p = metadata!['participants'];
    if (p is List) return p.cast<String>();
    return [];
  }

  /// Whether this message is a tool step (tool_call, tool_result, thinking).
  bool get isToolStep =>
      contentType == 'tool_call' ||
      contentType == 'tool_result' ||
      contentType == 'thinking' ||
      role == 'tool';

  /// Whether this message should be shown in the chat UI.
  bool get isHumanVisible =>
      !isToolStep &&
      (isUser || (isAssistant && (contentType == null || contentType == 'text')) || isSystem || isCall);

  /// Time display.
  String get time {
    if (createdAt.isEmpty) return '';
    try {
      final date = DateTime.parse(createdAt);
      return '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }
}

class Attachment {
  final int? id;
  final String name;
  final String? url;
  final String? mimeType;
  final int? size;

  const Attachment({
    this.id,
    required this.name,
    this.url,
    this.mimeType,
    this.size,
  });

  factory Attachment.fromJson(Map<String, dynamic> json) {
    // Backend may return URL in different fields: url, file_url, path, file_path
    final resolvedUrl = json['url']?.toString() ??
        json['file_url']?.toString() ??
        json['path']?.toString() ??
        json['file_path']?.toString();

    return Attachment(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id'] ?? ''}') ),
      name: json['name']?.toString() ?? json['filename']?.toString() ?? json['originalName']?.toString() ?? 'file',
      url: resolvedUrl,
      mimeType: json['mime_type']?.toString() ?? json['mimeType']?.toString() ?? json['type']?.toString() ?? json['content_type']?.toString(),
      size: json['size'] is int ? json['size'] : (int.tryParse('${json['size'] ?? ''}') ),
    );
  }

  bool get isImage =>
      mimeType?.startsWith('image/') == true ||
      name.toLowerCase().endsWith('.jpg') ||
      name.toLowerCase().endsWith('.jpeg') ||
      name.toLowerCase().endsWith('.png') ||
      name.toLowerCase().endsWith('.gif') ||
      name.toLowerCase().endsWith('.webp') ||
      (url != null && RegExp(r'\.(jpg|jpeg|png|gif|webp)(\?|$)', caseSensitive: false).hasMatch(url!));
}

/// Tool result from agent execution.
class ToolResult {
  final String tool;
  final dynamic result;
  final bool success;

  const ToolResult({
    required this.tool,
    this.result,
    this.success = true,
  });

  factory ToolResult.fromJson(Map<String, dynamic> json) {
    return ToolResult(
      tool: json['tool'] ?? 'unknown',
      result: json['result'],
      success: json['success'] ?? true,
    );
  }
}

/// Safe parser for tool results list.
List<ToolResult>? _parseToolResults(dynamic raw) {
  if (raw == null) return null;
  if (raw is! List) return null;
  try {
    return raw
        .whereType<Map>()
        .map((t) => ToolResult.fromJson(Map<String, dynamic>.from(t)))
        .toList();
  } catch (_) {
    return null;
  }
}

/// Space (workspace) model.
class Space {
  final int id;
  final String name;
  final String? description;
  final String? icon;
  final String type; // 'personal', 'business', 'ai', 'custom'

  const Space({
    required this.id,
    required this.name,
    this.description,
    this.icon,
    this.type = 'personal',
  });

  factory Space.fromJson(Map<String, dynamic> json) {
    return Space(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: json['name']?.toString() ?? 'Space',
      description: json['description']?.toString(),
      icon: json['icon']?.toString(),
      type: json['type']?.toString() ?? 'personal',
    );
  }
}

/// Agent info for @mentions.
class Agent {
  final int id;
  final String name;
  final String? description;
  final String status;
  final String? provider;
  final String? model;

  const Agent({
    required this.id,
    required this.name,
    this.description,
    this.status = 'active',
    this.provider,
    this.model,
  });

  factory Agent.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map ? json['data'] as Map<String, dynamic> : json;
    return Agent(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: (data['name'] ?? 'Agent').toString(),
      description: data['description']?.toString(),
      status: (data['status'] ?? 'active').toString(),
      provider: data['provider']?.toString(),
      model: data['model']?.toString(),
    );
  }
}

/// Ticket model from GOD CRM kanban board.
/// Relation fields (type, state, priority, assigned_to) are resolved to
/// display labels before parsing — see ChatRepository._resolveRelations().
class Ticket {
  final int id;
  final String title;
  final String? description;
  final String status;
  final String? priority;
  final String? type;
  final String? assignee;
  final String? phase;
  final String? adrRef;
  final String createdAt;
  final int? tableId;
  final DateTime? deadlineFrom;
  final DateTime? deadlineTo;
  final String? emoji;
  final String? color;

  const Ticket({
    required this.id,
    required this.title,
    this.description,
    this.status = 'backlog',
    this.priority,
    this.type,
    this.assignee,
    this.phase,
    this.adrRef,
    required this.createdAt,
    this.tableId,
    this.deadlineFrom,
    this.deadlineTo,
    this.emoji,
    this.color,
  });

  /// Try to parse a date from various formats.
  static DateTime? _tryParseDate(dynamic value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    final s = value.toString().trim();
    if (s.isEmpty) return null;
    try {
      return DateTime.parse(s);
    } catch (_) {
      // Try common date formats
      try {
        // dd.MM.yyyy
        final parts = s.split(RegExp(r'[./\-]'));
        if (parts.length == 3) {
          final day = int.tryParse(parts[0]);
          final month = int.tryParse(parts[1]);
          final year = int.tryParse(parts[2]);
          if (day != null && month != null && year != null) {
            return DateTime(year < 100 ? 2000 + year : year, month, day);
          }
        }
      } catch (_) {}
      return null;
    }
  }

  factory Ticket.fromJson(Map<String, dynamic> json) {
    // Tickets come from universal_tables — data may be in 'data' sub-object
    final data = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : json;

    // Resolve status: prefer already-resolved string, skip raw numeric IDs
    String resolveField(dynamic value, String fallback) {
      if (value == null) return fallback;
      final s = value.toString();
      // If it's a pure number, it's an unresolved relation ID — skip it
      if (int.tryParse(s) != null) return fallback;
      return s;
    }

    String? resolveOptionalField(dynamic value) {
      if (value == null) return null;
      final s = value.toString();
      if (int.tryParse(s) != null) return null; // unresolved relation ID
      return s;
    }

    return Ticket(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      title: (data['title'] ?? data['what'] ?? data['name'] ?? 'Untitled').toString(),
      description: (data['description'] ?? data['why'])?.toString(),
      status: resolveField(
        data['status'] ?? data['state'] ?? data['state_name'],
        'backlog',
      ),
      priority: resolveOptionalField(data['priority'] ?? data['priority_name']),
      type: resolveOptionalField(data['type'] ?? data['type_name']),
      assignee: resolveOptionalField(data['assigned_to'] ?? data['assignee'] ?? data['assigned_agent']),
      phase: resolveOptionalField(data['phase']),
      adrRef: resolveOptionalField(data['adr_ref']),
      createdAt: (json['created_at'] ?? json['createdAt'] ?? '').toString(),
      tableId: json['table_id'] is int ? json['table_id'] : null,
      deadlineFrom: _tryParseDate(data['deadline_from'] ?? data['start_date'] ?? data['date_from']),
      deadlineTo: _tryParseDate(data['deadline_to'] ?? data['due_date'] ?? data['deadline'] ?? data['end_date'] ?? data['date_to']),
      emoji: data['emoji']?.toString(),
      color: data['color']?.toString(),
    );
  }

  Color get statusColor {
    switch (status.toLowerCase()) {
      case 'done':
      case 'completed':
        return const Color(0xFF10B981);
      case 'in_progress':
      case 'in progress':
        return const Color(0xFF3B82F6);
      case 'review':
      case 'control':
        return const Color(0xFFF59E0B);
      case 'rejected':
        return const Color(0xFFEF4444);
      case 'assigned':
        return const Color(0xFF8B5CF6);
      case 'on hold':
        return const Color(0xFF6366F1);
      default:
        return const Color(0xFF6B7280);
    }
  }
}

/// Unified mentionable user for @mentions in chat input.
/// Merges agents and contacts into a single type.
enum MentionableUserType { agent, human }

class MentionableUser {
  final int id;
  final String name;
  final String? description;
  final String? avatar;
  final MentionableUserType type;
  final String? status; // For agents: 'active', 'inactive'
  final String? email;
  final String? role;

  const MentionableUser({
    required this.id,
    required this.name,
    this.description,
    this.avatar,
    required this.type,
    this.status,
    this.email,
    this.role,
  });

  bool get isAgent => type == MentionableUserType.agent;
  bool get isHuman => type == MentionableUserType.human;
  bool get isActive => status == 'active';

  /// Slug for structured invocation tokens (<<@slug>>).
  /// Converts "Architect" -> "architect", "Developer Ralph" -> "developer-ralph".
  String get slug => name.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-|-$'), '');

  /// Create from an Agent model.
  factory MentionableUser.fromAgent(Agent agent) {
    return MentionableUser(
      id: agent.id,
      name: agent.name,
      description: agent.description,
      type: MentionableUserType.agent,
      status: agent.status,
    );
  }

  /// Create from a Contact model.
  factory MentionableUser.fromContact(Contact contact) {
    return MentionableUser(
      id: contact.id,
      name: contact.name,
      avatar: contact.avatar,
      type: MentionableUserType.human,
      email: contact.email,
      role: contact.role,
      description: contact.role ?? contact.company,
    );
  }

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }
}

/// Dynamic ticket status from CRM relation table.
/// Loaded from the states lookup table linked to the tickets table.
class TicketStatus {
  final int id;
  final String name;
  final int order;
  final Color color;
  final bool isFinal;

  const TicketStatus({
    required this.id,
    required this.name,
    required this.order,
    this.color = const Color(0xFF6B7280),
    this.isFinal = false,
  });

  factory TicketStatus.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : json;
    return TicketStatus(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: (data['name'] ?? 'unknown').toString(),
      order: data['order'] is int
          ? data['order']
          : (int.tryParse('${data['order'] ?? 0}') ?? 0),
      color: _parseHexColor(data['color']?.toString()),
      isFinal: data['is_final'] == true || data['is_final'] == 1,
    );
  }
}

/// Dynamic ticket priority from CRM relation table.
/// Loaded from the priorities lookup table linked to the tickets table.
class TicketPriority {
  final int id;
  final String name;
  final int level;
  final Color color;

  const TicketPriority({
    required this.id,
    required this.name,
    required this.level,
    this.color = const Color(0xFF6B7280),
  });

  factory TicketPriority.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : json;
    return TicketPriority(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: (data['name'] ?? 'unknown').toString(),
      level: data['level'] is int
          ? data['level']
          : (int.tryParse('${data['level'] ?? 0}') ?? 0),
      color: _parseHexColor(data['color']?.toString()),
    );
  }
}

/// Parse a hex color string like "#6b7280" to a Color.
Color _parseHexColor(String? hex) {
  if (hex == null || hex.isEmpty) return const Color(0xFF6B7280);
  hex = hex.replaceFirst('#', '');
  if (hex.length == 6) hex = 'FF$hex';
  final parsed = int.tryParse(hex, radix: 16);
  return parsed != null ? Color(parsed) : const Color(0xFF6B7280);
}

/// Default statuses (fallback when CRM relation table is not available).
const defaultTicketStatuses = <TicketStatus>[
  TicketStatus(id: 0, name: 'backlog', order: 1, color: Color(0xFF6B7280)),
  TicketStatus(id: 0, name: 'assigned', order: 2, color: Color(0xFF6366F1)),
  TicketStatus(id: 0, name: 'in progress', order: 3, color: Color(0xFF3B82F6)),
  TicketStatus(id: 0, name: 'review', order: 4, color: Color(0xFFA855F7)),
  TicketStatus(id: 0, name: 'control', order: 5, color: Color(0xFFF59E0B)),
  TicketStatus(id: 0, name: 'on hold', order: 6, color: Color(0xFFF59E0B)),
  TicketStatus(id: 0, name: 'done', order: 7, color: Color(0xFF22C55E), isFinal: true),
  TicketStatus(id: 0, name: 'rejected', order: 8, color: Color(0xFFEF4444), isFinal: true),
];

/// Default priorities (fallback when CRM relation table is not available).
const defaultTicketPriorities = <TicketPriority>[
  TicketPriority(id: 0, name: 'low', level: 1, color: Color(0xFF6B7280)),
  TicketPriority(id: 0, name: 'medium', level: 2, color: Color(0xFFF59E0B)),
  TicketPriority(id: 0, name: 'high', level: 3, color: Color(0xFFF97316)),
  TicketPriority(id: 0, name: 'critical', level: 4, color: Color(0xFFEF4444)),
];

/// Helper to find a status color by name from a list of dynamic statuses.
Color statusColorFromList(String statusName, List<TicketStatus> statuses) {
  final lower = statusName.toLowerCase().replaceAll('_', ' ');
  for (final s in statuses) {
    if (s.name.toLowerCase() == lower) return s.color;
  }
  // Aliases
  if (lower == 'completed') {
    for (final s in statuses) {
      if (s.name.toLowerCase() == 'done') return s.color;
    }
  }
  if (lower == 'in_progress') {
    for (final s in statuses) {
      if (s.name.toLowerCase() == 'in progress') return s.color;
    }
  }
  return const Color(0xFF6B7280);
}

/// Helper to find a priority color by name from a list of dynamic priorities.
Color priorityColorFromList(String priorityName, List<TicketPriority> priorities) {
  final lower = priorityName.toLowerCase();
  for (final p in priorities) {
    if (p.name.toLowerCase() == lower) return p.color;
  }
  return const Color(0xFF9CA3AF);
}

/// Contact/User model from GOD CRM.
class Contact {
  final int id;
  final String name;
  final String? email;
  final String? phone;
  final String? avatar;
  final String? role;
  final String? company;

  const Contact({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.avatar,
    this.role,
    this.company,
  });

  factory Contact.fromJson(Map<String, dynamic> json) {
    final data = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : json;

    return Contact(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: (data['name'] ?? data['full_name'] ?? data['username'] ?? 'Unknown').toString(),
      email: data['email']?.toString(),
      phone: (data['phone'] ?? data['mobile'])?.toString(),
      avatar: data['avatar']?.toString(),
      role: (data['role'] ?? data['position'] ?? data['title'])?.toString(),
      company: (data['company'] ?? data['organization'])?.toString(),
    );
  }

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name.isNotEmpty ? name[0].toUpperCase() : '?';
  }
}

/// CRM Project model — belongs to a Space, contains Tables.
class CrmProject {
  final int id;
  final String name;
  final String? description;
  final int? spaceId;
  final String? icon;

  const CrmProject({
    required this.id,
    required this.name,
    this.description,
    this.spaceId,
    this.icon,
  });

  factory CrmProject.fromJson(Map<String, dynamic> json) {
    return CrmProject(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: (json['name'] ?? json['title'] ?? 'Project').toString(),
      description: json['description']?.toString(),
      spaceId: json['space_id'] is int
          ? json['space_id']
          : (int.tryParse('${json['space_id'] ?? ''}') ),
      icon: json['icon']?.toString(),
    );
  }
}

/// Generic CRM table.
class CrmTable {
  final int id;
  final String name;
  final String? description;
  final int? projectId;
  final int? columnCount;

  const CrmTable({
    required this.id,
    required this.name,
    this.description,
    this.projectId,
    this.columnCount,
  });

  factory CrmTable.fromJson(Map<String, dynamic> json) {
    return CrmTable(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      name: (json['name'] ?? json['title'] ?? 'Table').toString(),
      description: json['description']?.toString(),
      projectId: json['project_id'] is int ? json['project_id'] : null,
      columnCount: json['column_count'] is int ? json['column_count'] : null,
    );
  }
}

/// Scheduled message model — matches backend scheduled_messages table.
class ScheduledMessage {
  final int id;
  final int conversationId;
  final String content;
  final String scheduledAt;
  final String status; // 'pending', 'sent', 'failed', 'cancelled'
  final String createdAt;
  final String? contentType;
  final Map<String, dynamic>? metadata;

  const ScheduledMessage({
    required this.id,
    required this.conversationId,
    required this.content,
    required this.scheduledAt,
    this.status = 'pending',
    required this.createdAt,
    this.contentType,
    this.metadata,
  });

  factory ScheduledMessage.fromJson(Map<String, dynamic> json) {
    return ScheduledMessage(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      conversationId: json['conversation_id'] is int
          ? json['conversation_id']
          : (int.tryParse('${json['conversation_id'] ?? 0}') ?? 0),
      content: json['content']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString() ?? '',
      status: json['status']?.toString() ?? 'pending',
      createdAt: json['created_at']?.toString() ?? '',
      contentType: json['content_type']?.toString(),
      metadata: json['metadata'] is Map ? Map<String, dynamic>.from(json['metadata']) : null,
    );
  }

  /// Parsed scheduled time.
  DateTime? get scheduledDateTime {
    try {
      return DateTime.parse(scheduledAt);
    } catch (_) {
      return null;
    }
  }

  /// Human-readable scheduled time.
  String get scheduledTimeDisplay {
    final dt = scheduledDateTime;
    if (dt == null) return scheduledAt;
    final now = DateTime.now();
    final isToday = dt.year == now.year && dt.month == now.month && dt.day == now.day;
    final tomorrow = now.add(const Duration(days: 1));
    final isTomorrow = dt.year == tomorrow.year && dt.month == tomorrow.month && dt.day == tomorrow.day;
    final time = '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    if (isToday) return 'Сегодня $time';
    if (isTomorrow) return 'Завтра $time';
    return '${dt.day.toString().padLeft(2, '0')}.${dt.month.toString().padLeft(2, '0')} $time';
  }
}

/// Result from incremental message polling.
/// Includes new messages + processing state from the conversation.
class IncrementalPollResult {
  final List<Message> messages;
  final bool isProcessing;
  final String? processingAgentName;

  const IncrementalPollResult({
    required this.messages,
    this.isProcessing = false,
    this.processingAgentName,
  });

  factory IncrementalPollResult.fromJson(Map<String, dynamic> json) {
    final rawMessages = json['messages'];
    final messages = <Message>[];
    if (rawMessages is List) {
      for (final m in rawMessages) {
        if (m is Map) {
          try {
            messages.add(Message.fromJson(Map<String, dynamic>.from(m)));
          } catch (_) {
            // Skip malformed messages
          }
        }
      }
    }

    return IncrementalPollResult(
      messages: messages,
      isProcessing: json['is_processing'] == true,
      processingAgentName: json['processing_agent_name']?.toString(),
    );
  }
}

/// Generic CRM table row (for linking to chat).
class CrmTableRow {
  final int id;
  final int tableId;
  final Map<String, dynamic> data;
  final String? displayTitle;

  const CrmTableRow({
    required this.id,
    required this.tableId,
    this.data = const {},
    this.displayTitle,
  });

  factory CrmTableRow.fromJson(Map<String, dynamic> json, int tableId) {
    final rowData = json['data'] is Map
        ? Map<String, dynamic>.from(json['data'] as Map)
        : <String, dynamic>{};

    // Try to extract a display title from common field names
    final title = (rowData['title'] ?? rowData['name'] ?? rowData['what'] ??
        rowData['subject'] ?? rowData['label'] ?? json['id'])?.toString();

    return CrmTableRow(
      id: json['id'] is int ? json['id'] : (int.tryParse('${json['id']}') ?? 0),
      tableId: tableId,
      data: rowData,
      displayTitle: title,
    );
  }
}
