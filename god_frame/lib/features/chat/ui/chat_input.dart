import 'dart:io';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../../../core/theme.dart';
import '../data/models.dart';

/// Pending attachment before upload.
class PendingAttachment {
  final String path;
  final String name;
  final int? size;
  final bool isImage;

  const PendingAttachment({
    required this.path,
    required this.name,
    this.size,
    this.isImage = false,
  });
}

/// Chat input bar with text field, @mention autocomplete (agents + contacts),
/// and a 2x2 action grid: [attach, link] / [mic, send].
class ChatInput extends StatefulWidget {
  final void Function(String text, List<PendingAttachment> attachments) onSend;
  final bool enabled;
  final List<MentionableUser> users;
  final VoidCallback? onLinkRow;
  final VoidCallback? onSchedule;

  const ChatInput({
    super.key,
    required this.onSend,
    this.enabled = true,
    this.users = const [],
    this.onLinkRow,
    this.onSchedule,
  });

  @override
  ChatInputState createState() => ChatInputState();
}

// Pre-computed colors to avoid withOpacity() in build loops
const _kAgentBgColor = Color(0x26536DFE); // GodTheme.primary @ 0.15
const _kAccentBgColor = Color(0x26FF9100); // GodTheme.accent @ 0.15
const _kPrimaryBg01 = Color(0x1A536DFE); // GodTheme.primary @ 0.1
const _kErrorBg005 = Color(0x0DFF5252); // GodTheme.error @ 0.05
const _kErrorBg01 = Color(0x1AFF5252); // GodTheme.error @ 0.1
const _kPurpleBg01 = Color(0x1A9C27B0); // Colors.purple @ 0.1
const _kOrangeBg01 = Color(0x1AFF9800); // Colors.orange @ 0.1
const _kMutedBg03 = Color(0x4D9E9E9E); // GodTheme.textMuted @ 0.3
const _kMutedDisabled = Color(0x4D9E9E9E); // GodTheme.textMuted @ 0.3

class ChatInputState extends State<ChatInput> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();

  /// Current text content (used by parent for scheduling).
  String get currentText => _controller.text.trim();

  /// Clear the input field.
  void clearText() {
    _controller.clear();
    setState(() => _attachments.clear());
  }
  final _layerLink = LayerLink();
  bool _hasText = false;
  final List<PendingAttachment> _attachments = [];

  // @mention state
  bool _showMentionOverlay = false;
  String _mentionQuery = '';
  OverlayEntry? _overlayEntry;
  List<MentionableUser> _lastFiltered = [];

  // Toolbar toggle (like AI chat panel "+" button)
  bool _showToolbar = false;

  // Voice recognition state
  final stt.SpeechToText _speech = stt.SpeechToText();
  bool _isListening = false;
  bool _speechAvailable = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTextChanged);
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    try {
      _speechAvailable = await _speech.initialize(
        onStatus: (status) {
          if (status == 'notListening' || status == 'done') {
            if (mounted) setState(() => _isListening = false);
          }
        },
        onError: (error) {
          print('[Speech] Error: ${error.errorMsg}');
          if (mounted) {
            setState(() => _isListening = false);
            // Only show truly critical errors — suppress common non-critical ones
            // that happen after successful recognition or during normal lifecycle
            const suppressedErrors = {
              'error_no_match',        // No speech detected (not critical)
              'error_speech_timeout',  // Timeout after recognition finished
              'error_busy',            // Engine busy (will retry)
              'error_recognizer_busy', // Recognizer busy
              'error_client',          // Client-side issue, usually transient
              'error_server',          // Transient server error
            };
            if (!suppressedErrors.contains(error.errorMsg)) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Speech error: ${error.errorMsg}'),
                  backgroundColor: GodTheme.error,
                  duration: const Duration(seconds: 3),
                ),
              );
            }
          }
        },
      );
    } catch (e) {
      print('[Speech] Init failed: $e');
      _speechAvailable = false;
    }
  }

  @override
  void dispose() {
    _removeOverlay();
    _controller.removeListener(_onTextChanged);
    _controller.dispose();
    _focusNode.dispose();
    if (_isListening) _speech.stop();
    super.dispose();
  }

  void _onTextChanged() {
    final hasText = _controller.text.trim().isNotEmpty;
    if (hasText != _hasText) {
      setState(() => _hasText = hasText);
    }

    // Detect @mention trigger
    _checkMentionTrigger();
  }

  void _checkMentionTrigger() {
    final text = _controller.text;
    final cursorPos = _controller.selection.baseOffset;

    if (cursorPos <= 0 || cursorPos > text.length) {
      _hideMentionOverlay();
      return;
    }

    // Find the last '@' before cursor
    final textBeforeCursor = text.substring(0, cursorPos);
    final lastAt = textBeforeCursor.lastIndexOf('@');

    if (lastAt == -1) {
      _hideMentionOverlay();
      return;
    }

    // Check that '@' is at start or after a space
    if (lastAt > 0 && textBeforeCursor[lastAt - 1] != ' ' && textBeforeCursor[lastAt - 1] != '\n') {
      _hideMentionOverlay();
      return;
    }

    // Check no space between @ and cursor (still typing mention)
    final query = textBeforeCursor.substring(lastAt + 1);
    if (query.contains(' ') || query.contains('\n')) {
      _hideMentionOverlay();
      return;
    }

    _mentionQuery = query.toLowerCase();
    _showMentionList();
  }

  void _showMentionList() {
    final filtered = widget.users.where((u) {
      final name = u.name.toLowerCase();
      return name.contains(_mentionQuery);
    }).toList();

    if (filtered.isEmpty) {
      _hideMentionOverlay();
      return;
    }

    _lastFiltered = filtered;

    // Reuse existing overlay — just mark it dirty
    if (_overlayEntry != null) {
      _overlayEntry!.markNeedsBuild();
      return;
    }

    _showMentionOverlay = true;

    _overlayEntry = OverlayEntry(
      builder: (context) => Positioned(
        width: MediaQuery.sizeOf(context).width - 16,
        child: CompositedTransformFollower(
          link: _layerLink,
          showWhenUnlinked: false,
          offset: Offset(0, -8 - (_lastFiltered.length.clamp(1, 5) * 52.0)),
          child: Material(
            elevation: 8,
            borderRadius: BorderRadius.circular(12),
            color: GodTheme.surface,
            child: Container(
              constraints: const BoxConstraints(maxHeight: 260),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: GodTheme.border),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: ListView.builder(
                  padding: EdgeInsets.zero,
                  shrinkWrap: true,
                  itemCount: _lastFiltered.length,
                  itemBuilder: (context, index) {
                    final user = _lastFiltered[index];
                    return InkWell(
                      key: ValueKey('mention_${user.slug}'),
                      onTap: () => _insertMention(user),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        child: Row(
                          children: [
                            Container(
                              width: 32,
                              height: 32,
                              decoration: BoxDecoration(
                                color: user.isAgent
                                    ? _kAgentBgColor
                                    : _kAccentBgColor,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Center(
                                child: Icon(
                                  user.isAgent
                                      ? Icons.smart_toy_outlined
                                      : Icons.person_outlined,
                                  color: user.isAgent
                                      ? GodTheme.primary
                                      : GodTheme.accent,
                                  size: 18,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Flexible(
                                        child: Text(
                                          user.name,
                                          style: const TextStyle(
                                            color: GodTheme.textPrimary,
                                            fontWeight: FontWeight.w600,
                                            fontSize: 14,
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      if (user.isAgent) ...[
                                        const SizedBox(width: 6),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                                          decoration: BoxDecoration(
                                            color: _kAgentBgColor,
                                            borderRadius: BorderRadius.circular(4),
                                          ),
                                          child: const Text(
                                            'AI',
                                            style: TextStyle(
                                              color: GodTheme.primary,
                                              fontSize: 9,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  if (user.description != null)
                                    Text(
                                      user.description!,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: GodTheme.textMuted,
                                        fontSize: 12,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                            if (user.isAgent && user.isActive)
                              Container(
                                width: 8,
                                height: 8,
                                decoration: const BoxDecoration(
                                  color: GodTheme.success,
                                  shape: BoxShape.circle,
                                ),
                              ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
        ),
      ),
    );

    Overlay.of(context).insert(_overlayEntry!);
  }

  void _insertMention(MentionableUser user) {
    final text = _controller.text;
    final cursorPos = _controller.selection.baseOffset;
    final textBeforeCursor = text.substring(0, cursorPos);
    final lastAt = textBeforeCursor.lastIndexOf('@');

    if (lastAt == -1) return;

    final before = text.substring(0, lastAt);
    final after = text.substring(cursorPos);
    // ADR-116: Insert structured invocation token <<@slug>> for agents,
    // plain @name for humans (matching web AI Chat Panel behavior).
    final token = user.isAgent ? '<<@${user.slug}>>' : '@${user.name}';
    final newText = '$before$token $after';

    _controller.text = newText;
    final newCursor = before.length + token.length + 1; // +1 for space
    _controller.selection = TextSelection.collapsed(offset: newCursor);

    _hideMentionOverlay();
    _focusNode.requestFocus();
  }

  void _hideMentionOverlay() {
    _showMentionOverlay = false;
    _removeOverlay();
  }

  void _removeOverlay() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  // Voice recording
  Future<void> _toggleListening() async {
    if (!_speechAvailable) {
      // Try to reinitialize
      await _initSpeech();
      if (!_speechAvailable) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Speech recognition not available on this device'),
              backgroundColor: GodTheme.error,
            ),
          );
        }
        return;
      }
    }

    if (_isListening) {
      await _speech.stop();
      setState(() => _isListening = false);
    } else {
      setState(() => _isListening = true);
      await _speech.listen(
        onResult: (result) {
          if (result.recognizedWords.isNotEmpty) {
            final currentText = _controller.text;
            final cursorPos = _controller.selection.baseOffset;

            if (cursorPos >= 0 && cursorPos <= currentText.length) {
              final before = currentText.substring(0, cursorPos);
              final after = currentText.substring(cursorPos);
              final space = before.isNotEmpty && !before.endsWith(' ') ? ' ' : '';
              _controller.text = '$before$space${result.recognizedWords}$after';
              _controller.selection = TextSelection.collapsed(
                offset: cursorPos + space.length + result.recognizedWords.length,
              );
            } else {
              // Append at end
              final space = currentText.isNotEmpty && !currentText.endsWith(' ') ? ' ' : '';
              _controller.text = '$currentText$space${result.recognizedWords}';
              _controller.selection = TextSelection.collapsed(
                offset: _controller.text.length,
              );
            }
          }

          if (result.finalResult) {
            setState(() => _isListening = false);
          }
        },
        listenFor: const Duration(seconds: 30),
        pauseFor: const Duration(seconds: 3),
        localeId: 'ru_RU', // Default to Russian, can be changed
        cancelOnError: false,
        listenMode: stt.ListenMode.dictation,
      );
    }
  }

  bool get _canSend => (_hasText || _attachments.isNotEmpty) && widget.enabled;

  void _handleSend() {
    final text = _controller.text.trim();
    if (!_canSend) return;
    _hideMentionOverlay();
    widget.onSend(text, List.from(_attachments));
    _controller.clear();
    setState(() => _attachments.clear());
    _focusNode.requestFocus();
  }

  void _removeAttachment(int index) {
    setState(() => _attachments.removeAt(index));
  }

  Future<void> _showAttachOptions() async {
    final result = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: GodTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 4,
                margin: const EdgeInsets.only(bottom: 12),
                decoration: BoxDecoration(
                  color: _kMutedBg03,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              ListTile(
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _kPrimaryBg01,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.camera_alt, color: GodTheme.primary, size: 20),
                ),
                title: const Text('Take Photo', style: TextStyle(color: GodTheme.textPrimary)),
                subtitle: const Text('Use camera', style: TextStyle(color: GodTheme.textMuted, fontSize: 12)),
                onTap: () => Navigator.pop(ctx, 'camera'),
              ),
              ListTile(
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _kPurpleBg01,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.photo_library, color: Colors.purple, size: 20),
                ),
                title: const Text('Gallery', style: TextStyle(color: GodTheme.textPrimary)),
                subtitle: const Text('Choose image', style: TextStyle(color: GodTheme.textMuted, fontSize: 12)),
                onTap: () => Navigator.pop(ctx, 'gallery'),
              ),
              ListTile(
                leading: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: _kOrangeBg01,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(Icons.folder, color: Colors.orange, size: 20),
                ),
                title: const Text('File', style: TextStyle(color: GodTheme.textPrimary)),
                subtitle: const Text('Any document', style: TextStyle(color: GodTheme.textMuted, fontSize: 12)),
                onTap: () => Navigator.pop(ctx, 'file'),
              ),
            ],
          ),
        ),
      ),
    );

    if (result == null) return;

    switch (result) {
      case 'camera':
        await _pickFromCamera();
        break;
      case 'gallery':
        await _pickFromGallery();
        break;
      case 'file':
        await _pickFiles();
        break;
    }
  }

  Future<void> _pickFromCamera() async {
    try {
      final picker = ImagePicker();
      final image = await picker.pickImage(source: ImageSource.camera, imageQuality: 85);
      if (image != null) {
        final file = File(image.path);
        final size = await file.length();
        setState(() {
          _attachments.add(PendingAttachment(
            path: image.path,
            name: image.name,
            size: size,
            isImage: true,
          ));
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Camera error: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _pickFromGallery() async {
    try {
      final picker = ImagePicker();
      final images = await picker.pickMultiImage(imageQuality: 85);
      for (final image in images) {
        final file = File(image.path);
        final size = await file.length();
        setState(() {
          _attachments.add(PendingAttachment(
            path: image.path,
            name: image.name,
            size: size,
            isImage: true,
          ));
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Gallery error: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _pickFiles() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        type: FileType.any,
      );
      if (result != null) {
        for (final file in result.files) {
          if (file.path != null) {
            final isImg = _isImageExt(file.extension ?? '');
            setState(() {
              _attachments.add(PendingAttachment(
                path: file.path!,
                name: file.name,
                size: file.size,
                isImage: isImg,
              ));
            });
          }
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('File picker error: $e'),
            backgroundColor: GodTheme.error,
          ),
        );
      }
    }
  }

  bool _isImageExt(String ext) {
    final lower = ext.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].contains(lower);
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)}KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)}MB';
  }

  /// Build a single 36x36 grid button.
  Widget _gridButton({
    required IconData icon,
    required Color iconColor,
    Color? bgColor,
    VoidCallback? onPressed,
  }) {
    return SizedBox(
      width: 36,
      height: 36,
      child: IconButton(
        onPressed: onPressed,
        icon: Icon(icon, size: 18, color: iconColor),
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints(
          minWidth: 36,
          minHeight: 36,
          maxWidth: 36,
          maxHeight: 36,
        ),
        style: IconButton.styleFrom(
          backgroundColor: bgColor ?? Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
    );
  }

  /// Toolbar button used inside the expandable toolbar strip.
  Widget _toolbarButton({
    required IconData icon,
    required String label,
    required Color iconColor,
    Color? bgColor,
    VoidCallback? onPressed,
  }) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: bgColor ?? Colors.transparent,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: iconColor),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(color: iconColor, fontSize: 12, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: GodTheme.surface,
        border: Border(top: BorderSide(color: GodTheme.border, width: 1)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Attachment preview row
          if (_attachments.isNotEmpty)
            Container(
              padding: const EdgeInsets.only(left: 12, right: 12, top: 8),
              child: SizedBox(
                height: 72,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _attachments.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final att = _attachments[index];
                    return _AttachmentPreview(
                      key: ValueKey('att_${att.path}'),
                      attachment: att,
                      onRemove: () => _removeAttachment(index),
                    );
                  },
                ),
              ),
            ),

          // Expandable toolbar (like AI chat panel)
          AnimatedSize(
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOut,
            alignment: Alignment.topCenter,
            child: _showToolbar
                ? Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                    decoration: const BoxDecoration(
                      border: Border(bottom: BorderSide(color: GodTheme.border, width: 0.5)),
                    ),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          // Attach file
                          _toolbarButton(
                            icon: Icons.attach_file_rounded,
                            label: 'File',
                            iconColor: widget.enabled ? GodTheme.textSecondary : _kMutedDisabled,
                            onPressed: widget.enabled ? _showAttachOptions : null,
                          ),
                          const SizedBox(width: 4),
                          // Link row
                          _toolbarButton(
                            icon: Icons.link_rounded,
                            label: 'Link',
                            iconColor: widget.enabled ? GodTheme.textSecondary : _kMutedDisabled,
                            onPressed: widget.enabled ? widget.onLinkRow : null,
                          ),
                          const SizedBox(width: 4),
                          // Vertical divider
                          Container(width: 1, height: 20, color: GodTheme.border),
                          const SizedBox(width: 4),
                          // Schedule
                          _toolbarButton(
                            icon: Icons.schedule_rounded,
                            label: 'Schedule',
                            iconColor: widget.enabled && widget.onSchedule != null
                                ? const Color(0xFFF59E0B)
                                : _kMutedDisabled,
                            bgColor: const Color(0x1AF59E0B),
                            onPressed: widget.enabled ? widget.onSchedule : null,
                          ),
                        ],
                      ),
                    ),
                  )
                : const SizedBox.shrink(),
          ),

          // Input row: [TextField] [2x2 grid]
          // Grid: [Attach] [+/Tools]  /  [Send] [Mic]
          CompositedTransformTarget(
            link: _layerLink,
            child: Padding(
              padding: EdgeInsets.only(
                left: 8,
                right: 8,
                top: 2,
                bottom: 4 + MediaQuery.viewPaddingOf(context).bottom,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  // Text input
                  Expanded(
                    child: Container(
                      constraints: const BoxConstraints(maxHeight: 120),
                      child: TextField(
                        controller: _controller,
                        focusNode: _focusNode,
                        enabled: widget.enabled,
                        minLines: 2,
                        maxLines: null,
                        textInputAction: TextInputAction.newline,
                        style: const TextStyle(fontSize: 15),
                        decoration: InputDecoration(
                          hintText: _isListening ? 'Listening...' : 'Message... (@ to mention)',
                          hintStyle: TextStyle(
                            color: _isListening ? GodTheme.error : GodTheme.textMuted,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide(
                              color: _isListening ? GodTheme.error : GodTheme.border,
                            ),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide(
                              color: _isListening ? GodTheme.error : GodTheme.border,
                            ),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(24),
                            borderSide: BorderSide(
                              color: _isListening ? GodTheme.error : GodTheme.primary,
                            ),
                          ),
                          filled: true,
                          fillColor: _isListening
                              ? _kErrorBg005
                              : GodTheme.surfaceLight,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                          isDense: true,
                        ),
                      ),
                    ),
                  ),

                  const SizedBox(width: 6),

                  // Action grid: 2x2 (like AI chat panel)
                  // [Attach]  [+ Tools]
                  // [Send]    [Mic]
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Top row: [Attach] [+ Tools]
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _gridButton(
                            icon: Icons.attach_file_rounded,
                            iconColor: widget.enabled
                                ? GodTheme.textSecondary
                                : _kMutedDisabled,
                            onPressed: widget.enabled ? _showAttachOptions : null,
                          ),
                          const SizedBox(width: 4),
                          // Plus button — toggles toolbar
                          SizedBox(
                            width: 36,
                            height: 36,
                            child: IconButton(
                              onPressed: () => setState(() => _showToolbar = !_showToolbar),
                              icon: AnimatedRotation(
                                turns: _showToolbar ? 0.125 : 0, // 45 degrees
                                duration: const Duration(milliseconds: 200),
                                child: Icon(
                                  Icons.add_rounded,
                                  size: 20,
                                  color: _showToolbar ? GodTheme.primary : GodTheme.textSecondary,
                                ),
                              ),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(
                                minWidth: 36, minHeight: 36,
                                maxWidth: 36, maxHeight: 36,
                              ),
                              style: IconButton.styleFrom(
                                backgroundColor: _showToolbar ? _kPrimaryBg01 : Colors.transparent,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      // Bottom row: [Send] [Mic]
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // Send button
                          SizedBox(
                            width: 36,
                            height: 36,
                            child: IconButton(
                              onPressed: _canSend ? _handleSend : null,
                              icon: Icon(Icons.send_rounded, size: 16,
                                color: _canSend ? Colors.white : _kMutedDisabled),
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(
                                minWidth: 36, minHeight: 36,
                                maxWidth: 36, maxHeight: 36,
                              ),
                              style: IconButton.styleFrom(
                                backgroundColor: _canSend ? GodTheme.primary : _kPrimaryBg01,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          // Mic button
                          _gridButton(
                            icon: _isListening ? Icons.mic_off_rounded : Icons.mic_rounded,
                            iconColor: _isListening
                                ? GodTheme.error
                                : (widget.enabled
                                    ? GodTheme.textSecondary
                                    : _kMutedDisabled),
                            bgColor: _isListening ? _kErrorBg01 : null,
                            onPressed: widget.enabled ? _toggleListening : null,
                          ),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Preview chip for a pending attachment.
class _AttachmentPreview extends StatelessWidget {
  final PendingAttachment attachment;
  final VoidCallback onRemove;

  const _AttachmentPreview({
    super.key,
    required this.attachment,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: attachment.isImage ? 64 : 120,
          height: 64,
          decoration: BoxDecoration(
            color: GodTheme.surfaceLight,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: GodTheme.border),
          ),
          child: attachment.isImage
              ? ClipRRect(
                  borderRadius: BorderRadius.circular(9),
                  child: Image.file(
                    File(attachment.path),
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const Icon(
                      Icons.image,
                      color: GodTheme.textMuted,
                      size: 24,
                    ),
                  ),
                )
              : Padding(
                  padding: const EdgeInsets.all(6),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        _getFileIcon(attachment.name),
                        color: GodTheme.textSecondary,
                        size: 20,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        attachment.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: GodTheme.textSecondary,
                          fontSize: 9,
                        ),
                      ),
                      if (attachment.size != null)
                        Text(
                          _formatSize(attachment.size!),
                          style: const TextStyle(
                            color: GodTheme.textMuted,
                            fontSize: 8,
                          ),
                        ),
                    ],
                  ),
                ),
        ),
        // Remove button
        Positioned(
          top: -6,
          right: -6,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              width: 20,
              height: 20,
              decoration: BoxDecoration(
                color: GodTheme.error,
                shape: BoxShape.circle,
                border: Border.all(color: GodTheme.surface, width: 1.5),
              ),
              child: const Icon(Icons.close, size: 12, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }

  IconData _getFileIcon(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return Icons.picture_as_pdf;
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) return Icons.description;
    if (lower.endsWith('.xls') || lower.endsWith('.xlsx')) return Icons.table_chart;
    if (lower.endsWith('.mp4') || lower.endsWith('.mov')) return Icons.videocam;
    if (lower.endsWith('.mp3') || lower.endsWith('.wav')) return Icons.audiotrack;
    if (lower.endsWith('.zip') || lower.endsWith('.rar')) return Icons.archive;
    return Icons.insert_drive_file;
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '${bytes}B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(0)}KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)}MB';
  }
}
