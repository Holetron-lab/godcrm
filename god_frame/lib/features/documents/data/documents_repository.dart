import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../shared/utils/api_client.dart';

/// Document model from CRM Documents registry table (ID: 2709).
class Document {
  final int id;
  final String title;
  final String? description;
  final String? content;
  final String? status;
  final String? type;
  final String? category;
  final String? tags;
  final String? icon;
  final int? parentId;
  final int? spaceId;
  final int? tableId;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final Map<String, dynamic>? rawData;

  Document({
    required this.id,
    required this.title,
    this.description,
    this.content,
    this.status,
    this.type,
    this.category,
    this.tags,
    this.icon,
    this.parentId,
    this.spaceId,
    this.tableId,
    this.createdAt,
    this.updatedAt,
    this.rawData,
  });

  /// Whether this document has inline content.
  bool get hasContent => content != null && content!.isNotEmpty;

  /// Display type — category or type, whichever is available.
  String? get displayType => category ?? type;

  factory Document.fromJson(Map<String, dynamic> json) {
    final data = json['data'] as Map<String, dynamic>? ?? json;
    return Document(
      id: json['id'] as int? ?? data['id'] as int? ?? 0,
      // _registry uses 'name', legacy uses 'title'
      title: _str(data, ['name', 'Name', 'title', 'Title']) ?? 'Untitled',
      description: _str(data, ['description', 'Description', 'desc']),
      content: _str(data, ['content', 'Content', 'body', 'Body', 'text']),
      status: _str(data, ['status', 'Status']),
      type: _str(data, ['type', 'Type']),
      category: _str(data, ['category', 'Category']),
      tags: _str(data, ['tags', 'Tags']),
      icon: _str(data, ['icon', 'Icon']),
      parentId: _intVal(data, ['parent_id', 'parentId']),
      tableId: _intVal(data, ['table_id', 'tableId']),
      spaceId: json['space_id'] as int? ?? json['project_id'] as int? ??
          _intVal(data, ['space_id', 'project_id']),
      createdAt: _parseDate(json['created_at'] ?? data['created_at']),
      updatedAt: _parseDate(json['updated_at'] ?? data['updated_at']),
      rawData: data is Map<String, dynamic> ? Map<String, dynamic>.from(data) : null,
    );
  }

  static String? _str(Map<String, dynamic> data, List<String> keys) {
    for (final k in keys) {
      final v = data[k];
      if (v != null && v.toString().isNotEmpty) return v.toString();
    }
    return null;
  }

  static int? _intVal(Map<String, dynamic> data, List<String> keys) {
    for (final k in keys) {
      final v = data[k];
      if (v is int) return v;
      if (v is String) return int.tryParse(v);
    }
    return null;
  }

  static DateTime? _parseDate(dynamic v) {
    if (v == null) return null;
    return DateTime.tryParse(v.toString());
  }
}

/// Document content item from doc_* content table.
class DocumentContentItem {
  final int id;
  final String? level; // h1, h2, h3, text, divider, code, paragraph
  final int? order;
  final String? content;
  final String? contentEn;
  final String? contentRu;
  final String? imageUrl;
  final List<DocumentContentItem> children;

  DocumentContentItem({
    required this.id,
    this.level,
    this.order,
    this.content,
    this.contentEn,
    this.contentRu,
    this.imageUrl,
    this.children = const [],
  });

  factory DocumentContentItem.fromJson(Map<String, dynamic> json) {
    // Items may come flat (from API tree) or wrapped in 'data'
    final d = json['data'] is Map<String, dynamic>
        ? json['data'] as Map<String, dynamic>
        : json;
    // For direct table loads, content fields may use various naming
    final contentVal = d['content'] as String? ??
        d['content_en'] as String? ??
        d['content_ru'] as String? ??
        d['text'] as String? ??
        d['body'] as String? ??
        d['title'] as String?; // some doc_* tables use 'title' for section headers
    return DocumentContentItem(
      id: json['id'] as int? ?? d['id'] as int? ?? 0,
      level: d['level'] as String? ?? d['type'] as String?,
      order: d['order'] is int ? d['order'] as int
          : d['order_index'] is int ? d['order_index'] as int
          : int.tryParse('${d['order'] ?? d['order_index'] ?? ''}'),
      content: contentVal,
      contentEn: d['content_en'] as String?,
      contentRu: d['content_ru'] as String?,
      imageUrl: d['image_url'] as String? ?? d['image'] as String?,
      children: (json['children'] as List?)
              ?.map((c) => DocumentContentItem.fromJson(c as Map<String, dynamic>))
              .toList() ??
          (d['children'] as List?)
              ?.map((c) => DocumentContentItem.fromJson(c as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  /// Display content — prefer content_ru, fallback to content_en, then content.
  String get displayContent {
    if (contentRu != null && contentRu!.isNotEmpty) return contentRu!;
    if (contentEn != null && contentEn!.isNotEmpty) return contentEn!;
    return content ?? '';
  }

  bool get isHeading => level == 'h1' || level == 'h2' || level == 'h3';
  bool get isDivider => level == 'divider';
}

/// Full document content response.
class DocumentContent {
  final Map<String, dynamic>? document;
  final int? tableId;
  final List<DocumentContentItem> items;
  final List<DocumentContentItem> tree;
  final int count;

  DocumentContent({
    this.document,
    this.tableId,
    this.items = const [],
    this.tree = const [],
    this.count = 0,
  });

  factory DocumentContent.fromJson(Map<String, dynamic> json) {
    return DocumentContent(
      document: json['document'] as Map<String, dynamic>?,
      tableId: json['table_id'] as int?,
      items: (json['items'] as List?)
              ?.map((i) => DocumentContentItem.fromJson(i as Map<String, dynamic>))
              .toList() ??
          [],
      tree: (json['tree'] as List?)
              ?.map((t) => DocumentContentItem.fromJson(t as Map<String, dynamic>))
              .toList() ??
          [],
      count: json['count'] as int? ?? 0,
    );
  }
}

/// Document Atom — sub-sections of a document (table ID: 2710).
class DocumentAtom {
  final int id;
  final String? heading;
  final String? content;
  final int? order;
  final int? documentId;

  DocumentAtom({
    required this.id,
    this.heading,
    this.content,
    this.order,
    this.documentId,
  });

  factory DocumentAtom.fromJson(Map<String, dynamic> json) {
    final data = json['data'] as Map<String, dynamic>? ?? json;
    return DocumentAtom(
      id: json['id'] as int? ?? 0,
      heading: Document._str(data, ['heading', 'Heading', 'title', 'Title']),
      content: Document._str(data, ['content', 'Content', 'body', 'Body', 'text']),
      order: data['order'] as int? ?? data['Order'] as int?,
      documentId: Document._intVal({...json, ...data}, ['document_id', 'Document']),
    );
  }
}

/// Repository for Documents API operations.
class DocumentsRepository {
  final Dio _dio;

  /// _registry table — the authoritative document registry with table_id refs.
  static const int documentsTableId = 2197;
  /// Legacy documents table (kept for fallback).
  static const int legacyDocumentsTableId = 2709;
  static const int atomsTableId = 2710;

  DocumentsRepository(this._dio);

  /// Fetch all documents (with pagination support).
  Future<List<Document>> getDocuments({String? search}) async {
    try {
      List<Document> allDocs = [];
      int page = 1;
      int totalPages = 1;

      do {
        String path = '/tables/$documentsTableId/rows?page=$page&limit=100';
        if (search != null && search.isNotEmpty) {
          path += '&search=$search';
        }
        final resp = await _dio.get(path);
        final data = resp.data;
        List rows = [];
        if (data is Map) {
          final inner = data['data'];
          if (inner is Map) {
            if (inner['rows'] is List) {
              rows = inner['rows'] as List;
            }
            final pagination = inner['pagination'];
            if (pagination is Map) {
              totalPages = pagination['pages'] as int? ?? 1;
            }
          } else if (inner is List) {
            rows = inner;
          }
        } else if (data is List) {
          rows = data;
        }
        allDocs.addAll(rows.map((r) => Document.fromJson(r as Map<String, dynamic>)));
        page++;
      } while (page <= totalPages);

      return allDocs;
    } on DioException catch (e) {
      throw Exception('Failed to load documents: ${e.message}');
    }
  }

  /// Fetch a single document by ID.
  Future<Document> getDocument(int id) async {
    final resp = await _dio.get('/tables/$documentsTableId/rows/$id');
    final body = resp.data;
    if (body is Map && body['data'] is Map) {
      final inner = body['data'] as Map<String, dynamic>;
      if (inner['row'] is Map) {
        return Document.fromJson(inner['row'] as Map<String, dynamic>);
      }
    }
    return Document.fromJson(body as Map<String, dynamic>);
  }

  /// Fetch document content from doc_* content table.
  /// Tries the documents content API first, then falls back to direct table load
  /// using the document's table_id from _registry.
  Future<DocumentContent?> getDocumentContent(int documentId, {int? tableId}) async {
    // Strategy 1: Use the documents content API (auto-discovers by slug)
    try {
      final resp = await _dio.get(
        '/documents/$documentId/content',
        queryParameters: {'registry_table_id': documentsTableId},
      );
      final body = resp.data;
      if (body is Map && body['success'] == true && body['data'] is Map) {
        final content = DocumentContent.fromJson(body['data'] as Map<String, dynamic>);
        if (content.count > 0) return content;
      }
    } on DioException catch (e) {
      if (e.response?.statusCode != 400) {
        print('[Documents] Content API error for $documentId: ${e.message}');
      }
    } catch (e) {
      print('[Documents] Content API error for $documentId: $e');
    }

    // Strategy 2: If doc has table_id from _registry, load rows directly
    if (tableId != null && tableId > 0) {
      try {
        final resp = await _dio.get('/tables/$tableId/rows?limit=200');
        final body = resp.data;
        List rows = [];
        if (body is Map) {
          final inner = body['data'];
          if (inner is Map && inner['rows'] is List) {
            rows = inner['rows'] as List;
          } else if (inner is List) {
            rows = inner;
          }
        }
        if (rows.isNotEmpty) {
          final items = rows.map((r) =>
            DocumentContentItem.fromJson(r as Map<String, dynamic>)).toList();
          items.sort((a, b) => (a.order ?? 0).compareTo(b.order ?? 0));
          return DocumentContent(
            tableId: tableId,
            items: items,
            tree: items, // flat list treated as tree
            count: items.length,
          );
        }
      } catch (e) {
        print('[Documents] Direct table $tableId load error: $e');
      }
    }

    return null;
  }

  /// Fetch document atoms for a document.
  Future<List<DocumentAtom>> getDocumentAtoms(int documentId) async {
    try {
      // Try server-side search by document_id first
      final resp = await _dio.get('/tables/$atomsTableId/rows?limit=100&search=$documentId');
      final data = resp.data;
      List rows = [];
      if (data is Map) {
        final inner = data['data'];
        if (inner is Map) {
          if (inner['rows'] is List) rows = inner['rows'] as List;
        } else if (inner is List) {
          rows = inner;
        }
      } else if (data is List) {
        rows = data;
      }

      final atoms = rows
          .map((r) => DocumentAtom.fromJson(r as Map<String, dynamic>))
          .where((a) => a.documentId == documentId)
          .toList();
      atoms.sort((a, b) => (a.order ?? 0).compareTo(b.order ?? 0));
      return atoms;
    } catch (_) {
      return [];
    }
  }

  /// Create a new document.
  Future<Document> createDocument(Map<String, dynamic> data) async {
    final resp = await _dio.post(
      '/tables/$documentsTableId/rows',
      data: {'data': data},
    );
    return Document.fromJson(resp.data);
  }

  /// Update a document.
  Future<void> updateDocument(int id, Map<String, dynamic> data) async {
    await _dio.put(
      '/tables/$documentsTableId/rows/$id',
      data: {'data': data},
    );
  }
}

/// Repository provider.
final documentsRepositoryProvider = Provider<DocumentsRepository>((ref) {
  return DocumentsRepository(ref.watch(apiClientProvider));
});
