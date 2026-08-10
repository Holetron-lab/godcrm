import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/documents_repository.dart';

/// Documents list provider with auto-refresh.
final documentsProvider = FutureProvider.autoDispose<List<Document>>((ref) async {
  final repo = ref.watch(documentsRepositoryProvider);
  return repo.getDocuments();
});

/// Single document provider.
final documentProvider = FutureProvider.autoDispose.family<Document, int>((ref, id) async {
  final repo = ref.watch(documentsRepositoryProvider);
  return repo.getDocument(id);
});

/// Document atoms provider.
final documentAtomsProvider = FutureProvider.autoDispose.family<List<DocumentAtom>, int>((ref, docId) async {
  final repo = ref.watch(documentsRepositoryProvider);
  return repo.getDocumentAtoms(docId);
});

/// Document content provider — loads from doc_* content table via API.
/// First fetches the document to get its table_id, then loads content.
final documentContentProvider = FutureProvider.autoDispose.family<DocumentContent?, int>((ref, docId) async {
  final repo = ref.watch(documentsRepositoryProvider);
  // Get document first to extract table_id from _registry
  try {
    final doc = await ref.watch(documentProvider(docId).future);
    return repo.getDocumentContent(docId, tableId: doc.tableId);
  } catch (_) {
    return repo.getDocumentContent(docId);
  }
});

/// Search query state.
final documentsSearchProvider = StateProvider<String>((ref) => '');

/// Status filter state.
final documentsStatusFilterProvider = StateProvider<String?>((ref) => null);

/// Type filter state.
final documentsTypeFilterProvider = StateProvider<String?>((ref) => null);

/// Space filter state.
final documentsSpaceFilterProvider = StateProvider<int?>((ref) => null);

/// Filtered documents based on search and filters.
final filteredDocumentsProvider = FutureProvider.autoDispose<List<Document>>((ref) async {
  final search = ref.watch(documentsSearchProvider);
  final statusFilter = ref.watch(documentsStatusFilterProvider);
  final typeFilter = ref.watch(documentsTypeFilterProvider);
  final spaceFilter = ref.watch(documentsSpaceFilterProvider);
  final repo = ref.watch(documentsRepositoryProvider);

  var docs = await repo.getDocuments(search: search.isNotEmpty ? search : null);

  // Apply status filter
  if (statusFilter != null) {
    docs = docs.where((d) =>
        d.status?.toLowerCase() == statusFilter.toLowerCase()).toList();
  }

  // Apply type filter (matches type or category)
  if (typeFilter != null) {
    docs = docs.where((d) =>
        d.type?.toLowerCase() == typeFilter.toLowerCase() ||
        d.category?.toLowerCase() == typeFilter.toLowerCase()).toList();
  }

  // Apply space filter
  if (spaceFilter != null) {
    docs = docs.where((d) => d.spaceId == spaceFilter).toList();
  }

  return docs;
});

/// Available statuses derived from loaded documents.
final documentStatusesProvider = FutureProvider.autoDispose<List<String>>((ref) async {
  final repo = ref.watch(documentsRepositoryProvider);
  final docs = await repo.getDocuments();
  final statuses = <String>{};
  for (final d in docs) {
    if (d.status != null && d.status!.isNotEmpty) statuses.add(d.status!);
  }
  return statuses.toList()..sort();
});

/// Available types derived from loaded documents (type + category).
final documentTypesProvider = FutureProvider.autoDispose<List<String>>((ref) async {
  final repo = ref.watch(documentsRepositoryProvider);
  final docs = await repo.getDocuments();
  final types = <String>{};
  for (final d in docs) {
    if (d.type != null && d.type!.isNotEmpty) types.add(d.type!);
    if (d.category != null && d.category!.isNotEmpty) types.add(d.category!);
  }
  return types.toList()..sort();
});
