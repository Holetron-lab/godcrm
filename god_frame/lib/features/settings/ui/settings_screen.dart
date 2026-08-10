import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:go_router/go_router.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../../../core/config.dart';
import '../../../core/theme.dart';
import '../../../shared/utils/api_client.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/providers/auth_provider.dart';
import '../../frame/providers/frame_connection_provider.dart';
import '../providers/app_lock_provider.dart';
import '../providers/todo_view_provider.dart';
import '../../chat/data/models.dart';
import '../../chat/providers/conversations_provider.dart';
import 'set_pin_screen.dart';
import 'voice_commands_screen.dart';

/// Settings screen — server config, account, Frame management.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _serverCtrl = TextEditingController();
  bool _isEditingServer = false;

  @override
  void initState() {
    super.initState();
    _loadServerUrl();
  }

  Future<void> _loadServerUrl() async {
    final repo = ref.read(authRepositoryProvider);
    final url = await repo.getServerUrl();
    _serverCtrl.text = url;
  }

  @override
  void dispose() {
    _serverCtrl.dispose();
    super.dispose();
  }

  Future<void> _testApiConnection(BuildContext context) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );

    try {
      final dio = ref.read(apiClientProvider);
      final results = <String>[];

      // Test 1: Check /auth/me
      try {
        final resp = await dio.get(AppConfig.mePath);
        results.add('Auth: ${resp.statusCode} OK');
      } on DioException catch (e) {
        results.add('Auth: ${e.response?.statusCode ?? 'FAIL'} - ${e.response?.data?['error'] ?? e.message}');
      }

      // Test 2: Check conversations endpoint
      try {
        final resp = await dio.get(AppConfig.conversationsPath);
        final data = resp.data;
        final count = data is Map && data['data'] is List
            ? (data['data'] as List).length
            : '?';
        results.add('Chat: ${resp.statusCode} OK ($count conversations)');
      } on DioException catch (e) {
        results.add('Chat: ${e.response?.statusCode ?? 'FAIL'} - ${e.response?.data?['error'] ?? e.message}');
      }

      // Test 3: Check frame/noa endpoint (GET -> 405 expected = endpoint exists)
      try {
        final resp = await dio.get(AppConfig.frameNoaPath);
        results.add('Voice: ${resp.statusCode} OK');
      } on DioException catch (e) {
        final code = e.response?.statusCode;
        if (code == 405 || code == 400) {
          results.add('Voice: Endpoint exists (needs POST)');
        } else {
          results.add('Voice: ${code ?? 'FAIL'} - ${e.response?.data?['error'] ?? e.message}');
        }
      }

      if (mounted) Navigator.pop(context); // Close loading dialog

      if (mounted) {
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('API Connection Test'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Server: ${_serverCtrl.text.isNotEmpty ? _serverCtrl.text : AppConfig.defaultBaseUrl}',
                  style: const TextStyle(fontSize: 12, color: GodTheme.textMuted),
                ),
                const SizedBox(height: 12),
                ...results.map((r) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        r.contains('OK') || r.contains('exists')
                            ? Icons.check_circle
                            : Icons.error,
                        size: 16,
                        color: r.contains('OK') || r.contains('exists')
                            ? GodTheme.success
                            : GodTheme.error,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(r, style: const TextStyle(fontSize: 13)),
                      ),
                    ],
                  ),
                )),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK'),
              ),
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) Navigator.pop(context);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Test failed: $e'), backgroundColor: GodTheme.error),
        );
      }
    }
  }

  Widget _buildSecuritySection() {
    final lockState = ref.watch(appLockProvider);

    String lockLabel;
    IconData lockIcon;
    switch (lockState.type) {
      case AppLockType.pin:
        lockLabel = 'PIN-код';
        lockIcon = Icons.pin_outlined;
        break;
      case AppLockType.biometric:
        lockLabel = 'Отпечаток / Face ID';
        lockIcon = Icons.fingerprint;
        break;
      case AppLockType.none:
        lockLabel = 'Отключено';
        lockIcon = Icons.lock_open_outlined;
        break;
    }

    return _SectionCard(
      title: 'Безопасность',
      children: [
        ListTile(
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: lockState.enabled
                    ? [GodTheme.success, GodTheme.accent]
                    : [GodTheme.textMuted.withOpacity(0.3), GodTheme.textMuted.withOpacity(0.1)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(lockIcon, color: lockState.enabled ? Colors.white : GodTheme.textMuted, size: 24),
          ),
          title: const Text('Блокировка приложения', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(lockLabel, style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13)),
          trailing: Switch(
            value: lockState.enabled,
            activeColor: GodTheme.primary,
            onChanged: (enabled) async {
              if (enabled) {
                _showLockTypeDialog();
              } else {
                ref.read(appLockProvider.notifier).disable();
              }
            },
          ),
        ),
        if (lockState.enabled && lockState.type == AppLockType.pin)
          ListTile(
            leading: const SizedBox(width: 44),
            title: const Text('Изменить PIN', style: TextStyle(fontSize: 14)),
            trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted, size: 20),
            dense: true,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SetPinScreen()),
              );
            },
          ),
      ],
    );
  }

  Widget _buildTodoViewSection() {
    final todoSettings = ref.watch(todoViewProvider);
    final statusesAsync = ref.watch(ticketStatusesProvider);
    final statuses = statusesAsync.valueOrNull ?? List<TicketStatus>.from(defaultTicketStatuses);

    return _SectionCard(
      title: 'Список задач (Todo)',
      children: [
        // Enable toggle
        ListTile(
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: todoSettings.enabled
                    ? [GodTheme.primary, GodTheme.accent]
                    : [GodTheme.textMuted.withOpacity(0.3), GodTheme.textMuted.withOpacity(0.1)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.checklist_rounded,
                color: todoSettings.enabled ? Colors.white : GodTheme.textMuted, size: 24),
          ),
          title: const Text('Режим Todo', style: TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('Тикеты как чеклист с галочками',
              style: TextStyle(color: GodTheme.textSecondary, fontSize: 13)),
          trailing: Switch(
            value: todoSettings.enabled,
            activeColor: GodTheme.primary,
            onChanged: (v) => ref.read(todoViewProvider.notifier).setEnabled(v),
          ),
        ),

        // Done status selector
        ListTile(
          leading: const SizedBox(width: 44),
          title: const Text('Статус "Выполнено"', style: TextStyle(fontSize: 14)),
          subtitle: Text(
            todoSettings.doneStatus.replaceAll('_', ' '),
            style: const TextStyle(color: GodTheme.primary, fontSize: 13),
          ),
          trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted, size: 20),
          dense: true,
          onTap: () {
            showModalBottomSheet(
              context: context,
              backgroundColor: GodTheme.card,
              shape: const RoundedRectangleBorder(
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              builder: (ctx) => SafeArea(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const SizedBox(height: 12),
                    Container(width: 40, height: 4, decoration: BoxDecoration(
                      color: GodTheme.textMuted, borderRadius: BorderRadius.circular(2),
                    )),
                    const SizedBox(height: 16),
                    const Text('На какой статус ставить при галочке',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 12),
                    ...statuses.map((s) {
                      final isSelected = s.name.toLowerCase() == todoSettings.doneStatus.toLowerCase();
                      return ListTile(
                        leading: Container(
                          width: 28, height: 28,
                          decoration: BoxDecoration(
                            color: s.color.withOpacity(isSelected ? 0.25 : 0.1),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Icon(Icons.circle, color: s.color, size: 12),
                        ),
                        title: Text(
                          s.name.replaceAll('_', ' '),
                          style: TextStyle(
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w400,
                            color: isSelected ? s.color : GodTheme.textPrimary,
                          ),
                        ),
                        trailing: isSelected
                            ? Icon(Icons.check_circle, color: s.color, size: 20)
                            : null,
                        onTap: () {
                          ref.read(todoViewProvider.notifier).setDoneStatus(s.name);
                          Navigator.pop(ctx);
                        },
                      );
                    }),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            );
          },
        ),

        // Visible statuses filter
        ListTile(
          leading: const SizedBox(width: 44),
          title: const Text('Показывать статусы', style: TextStyle(fontSize: 14)),
          subtitle: Text(
            todoSettings.visibleStatuses.isEmpty
                ? 'Все статусы'
                : todoSettings.visibleStatuses.map((s) => s.replaceAll('_', ' ')).join(', '),
            style: const TextStyle(color: GodTheme.textSecondary, fontSize: 13),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted, size: 20),
          dense: true,
          onTap: () {
            showModalBottomSheet(
              context: context,
              backgroundColor: GodTheme.card,
              shape: const RoundedRectangleBorder(
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              builder: (ctx) => StatefulBuilder(
                builder: (ctx, setSheetState) {
                  final visible = ref.watch(todoViewProvider).visibleStatuses;
                  return SafeArea(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(height: 12),
                        Container(width: 40, height: 4, decoration: BoxDecoration(
                          color: GodTheme.textMuted, borderRadius: BorderRadius.circular(2),
                        )),
                        const SizedBox(height: 16),
                        const Text('Какие статусы показывать',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        const Text('Пустой выбор = показать все',
                            style: TextStyle(fontSize: 12, color: GodTheme.textMuted)),
                        const SizedBox(height: 12),
                        // Clear all button
                        if (visible.isNotEmpty)
                          TextButton(
                            onPressed: () {
                              ref.read(todoViewProvider.notifier).setVisibleStatuses([]);
                              setSheetState(() {});
                            },
                            child: const Text('Сбросить (показать все)'),
                          ),
                        ...statuses.map((s) {
                          final isChecked = visible.any(
                              (v) => v.toLowerCase() == s.name.toLowerCase());
                          return CheckboxListTile(
                            value: isChecked,
                            activeColor: s.color,
                            title: Row(
                              children: [
                                Container(
                                  width: 12, height: 12,
                                  decoration: BoxDecoration(
                                    color: s.color,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(s.name.replaceAll('_', ' ')),
                              ],
                            ),
                            onChanged: (_) {
                              ref.read(todoViewProvider.notifier).toggleVisibleStatus(s.name);
                              setSheetState(() {});
                            },
                          );
                        }),
                        const SizedBox(height: 8),
                      ],
                    ),
                  );
                },
              ),
            );
          },
        ),
      ],
    );
  }

  Future<void> _showLockTypeDialog() async {
    final notifier = ref.read(appLockProvider.notifier);
    final canBio = await notifier.canUseBiometrics();

    if (!mounted) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: GodTheme.card,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 12),
            Container(width: 40, height: 4, decoration: BoxDecoration(
              color: GodTheme.textMuted, borderRadius: BorderRadius.circular(2),
            )),
            const SizedBox(height: 16),
            const Text('Выберите тип блокировки',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.pin_outlined, color: GodTheme.primary),
              title: const Text('PIN-код'),
              subtitle: const Text('4-значный код', style: TextStyle(color: GodTheme.textSecondary)),
              onTap: () async {
                Navigator.pop(ctx);
                final result = await Navigator.push<bool>(
                  context,
                  MaterialPageRoute(builder: (_) => const SetPinScreen()),
                );
                if (result != true && mounted) {
                  // User cancelled — don't enable
                }
              },
            ),
            if (canBio)
              ListTile(
                leading: const Icon(Icons.fingerprint, color: GodTheme.primary),
                title: const Text('Отпечаток / Face ID'),
                subtitle: const Text('Биометрия + резервный PIN', style: TextStyle(color: GodTheme.textSecondary)),
                onTap: () async {
                  Navigator.pop(ctx);
                  // First set a backup PIN, then enable biometric
                  final result = await Navigator.push<bool>(
                    context,
                    MaterialPageRoute(builder: (_) => const SetPinScreen()),
                  );
                  if (result == true && mounted) {
                    // PIN was set — now switch type to biometric
                    // The PIN is already saved by SetPinScreen, just change type
                    await notifier.enableBiometric();
                  }
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  /// Build Frame section safely — isolated from BLE errors.
  Widget _buildFrameSection() {
    // Use Consumer to isolate BLE provider errors from the rest of settings.
    return Consumer(
      builder: (context, ref, _) {
        FrameState? frameState;
        try {
          // Only READ (don't watch) to avoid triggering provider creation
          // on every rebuild. The frame provider auto-connects on its own.
          frameState = ref.watch(frameConnectionProvider);
        } catch (_) {
          // BLE not available or provider crashed — show safe fallback
        }

        final isConnected = frameState?.isConnected ?? false;
        return _SectionCard(
          title: 'Brilliant Frame',
          children: [
            ListTile(
              leading: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: isConnected
                        ? [GodTheme.frameBle, GodTheme.accent]
                        : [GodTheme.textMuted.withOpacity(0.3), GodTheme.textMuted.withOpacity(0.1)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.diamond_outlined,
                  color: isConnected ? Colors.white : GodTheme.textMuted,
                  size: 24,
                ),
              ),
              title: Text(
                isConnected
                    ? frameState!.device?.name ?? 'Frame Connected'
                    : 'Brilliant Frame',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                isConnected
                    ? 'Connected  |  ${frameState!.device?.rssi ?? 0} dBm'
                    : 'Tap to connect your glasses',
                style: TextStyle(
                  color: isConnected ? GodTheme.frameBle : GodTheme.textSecondary,
                  fontSize: 13,
                ),
              ),
              trailing: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: isConnected
                      ? GodTheme.frameBle.withOpacity(0.1)
                      : GodTheme.surfaceLight,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  isConnected ? Icons.bluetooth_connected : Icons.bluetooth_searching,
                  color: isConnected ? GodTheme.frameBle : GodTheme.textMuted,
                  size: 20,
                ),
              ),
              onTap: () => context.push('/frame'),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authStateProvider);
    final user = authState.valueOrNull?.user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Настройки'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // User info card
          if (user != null)
            _SectionCard(
              title: 'Аккаунт',
              children: [
                ListTile(
                  leading: CircleAvatar(
                    backgroundColor: GodTheme.primary.withOpacity(0.15),
                    child: Text(
                      user.name.isNotEmpty ? user.name[0].toUpperCase() : '?',
                      style: const TextStyle(color: GodTheme.primary, fontWeight: FontWeight.w700),
                    ),
                  ),
                  title: Text(user.name),
                  subtitle: Text(user.email, style: const TextStyle(color: GodTheme.textSecondary)),
                ),
              ],
            ),

          const SizedBox(height: 16),

          // Server settings
          _SectionCard(
            title: 'Сервер',
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _serverCtrl,
                        enabled: _isEditingServer,
                        style: const TextStyle(fontSize: 14),
                        decoration: InputDecoration(
                          labelText: 'CRM Server URL',
                          hintText: 'https://crm.hltrn.cc',
                          prefixIcon: const Icon(Icons.dns_outlined, size: 20),
                          border: _isEditingServer ? null : InputBorder.none,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: Icon(
                        _isEditingServer ? Icons.check : Icons.edit,
                        color: _isEditingServer ? GodTheme.success : GodTheme.textMuted,
                      ),
                      onPressed: () async {
                        if (_isEditingServer) {
                          // Save
                          await ref
                              .read(authStateProvider.notifier)
                              .setServerUrl(_serverCtrl.text.trim());
                          if (mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Server URL updated')),
                            );
                          }
                        }
                        setState(() => _isEditingServer = !_isEditingServer);
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),

          const SizedBox(height: 16),

          // Brilliant Frame — isolated in Consumer for crash safety
          _buildFrameSection(),

          const SizedBox(height: 16),

          // Voice Commands
          _SectionCard(
            title: 'Голос',
            children: [
              ListTile(
                leading: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [GodTheme.primary, GodTheme.accent],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.mic_rounded, color: Colors.white, size: 24),
                ),
                title: const Text(
                  'Голосовые команды',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                subtitle: const Text(
                  'Настройки голосовых команд, Gemini Live, агент',
                  style: TextStyle(color: GodTheme.textSecondary, fontSize: 13),
                ),
                trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const VoiceCommandsScreen()),
                ),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // Security / App Lock
          _buildSecuritySection(),

          const SizedBox(height: 16),

          // Todo View Settings
          _buildTodoViewSection(),

          const SizedBox(height: 16),

          // Debug / API Test
          _SectionCard(
            title: 'Отладка',
            children: [
              ListTile(
                leading: const Icon(Icons.network_check, color: GodTheme.accent),
                title: const Text('Тест API'),
                subtitle: const Text('Проверить доступность сервера', style: TextStyle(color: GodTheme.textSecondary)),
                onTap: () => _testApiConnection(context),
              ),
              ListTile(
                leading: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFEF4444), Color(0xFFF97316)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.bug_report, color: Colors.white, size: 24),
                ),
                title: const Text('Debug Console', style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: const Text('Логи, устройство, API, хранилище', style: TextStyle(color: GodTheme.textSecondary, fontSize: 13)),
                trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted),
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const _DebugConsoleScreen()),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.bluetooth_searching, color: GodTheme.frameBle),
                title: const Text('BLE Debug'),
                subtitle: const Text('Brilliant Frame логи', style: TextStyle(color: GodTheme.textSecondary, fontSize: 13)),
                trailing: const Icon(Icons.chevron_right, color: GodTheme.textMuted),
                onTap: () => context.push('/debug'),
              ),
            ],
          ),

          const SizedBox(height: 16),

          // About
          _SectionCard(
            title: 'О приложении',
            children: [
              const ListTile(
                leading: Icon(Icons.info_outline, color: GodTheme.textSecondary),
                title: Text('GOD Frame'),
                subtitle: Text('v1.36.0', style: TextStyle(color: GodTheme.textSecondary)),
              ),
              ListTile(
                leading: const Icon(Icons.code, color: GodTheme.textSecondary),
                title: const Text('Сервер'),
                subtitle: Text(
                  _serverCtrl.text.isNotEmpty ? _serverCtrl.text : AppConfig.defaultBaseUrl,
                  style: const TextStyle(color: GodTheme.textSecondary),
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Logout button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
              onPressed: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Выйти'),
                    content: const Text('Вы уверены, что хотите выйти?'),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: const Text('Отмена'),
                      ),
                      TextButton(
                        onPressed: () => Navigator.pop(ctx, true),
                        child: const Text('Выйти', style: TextStyle(color: GodTheme.error)),
                      ),
                    ],
                  ),
                );
                if (confirmed == true) {
                  ref.read(authStateProvider.notifier).logout();
                }
              },
              icon: const Icon(Icons.logout, color: GodTheme.error),
              label: const Text('Выйти', style: TextStyle(color: GodTheme.error)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: GodTheme.error),
              ),
            ),
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final List<Widget> children;

  const _SectionCard({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 16, top: 12, bottom: 4),
            child: Text(
              title,
              style: const TextStyle(
                color: GodTheme.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// Debug Console — comprehensive app debug screen
// ═══════════════════════════════════════════════════════════════

class _DebugConsoleScreen extends ConsumerStatefulWidget {
  const _DebugConsoleScreen();

  @override
  ConsumerState<_DebugConsoleScreen> createState() => _DebugConsoleScreenState();
}

class _DebugConsoleScreenState extends ConsumerState<_DebugConsoleScreen> {
  final List<_DebugLogEntry> _logs = [];
  bool _isRunning = false;
  String _deviceInfo = 'Loading...';
  String _appInfo = 'Loading...';
  String _storageInfo = 'Loading...';
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadInfo();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _log(String category, String message, {bool isError = false}) {
    setState(() {
      _logs.add(_DebugLogEntry(
        time: DateTime.now(),
        category: category,
        message: message,
        isError: isError,
      ));
    });
    // Auto-scroll
    Future.delayed(const Duration(milliseconds: 50), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 100),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _loadInfo() async {
    // App info
    try {
      final info = await PackageInfo.fromPlatform();
      setState(() {
        _appInfo = '${info.appName} v${info.version}+${info.buildNumber}\n'
            'Package: ${info.packageName}';
      });
    } catch (e) {
      setState(() => _appInfo = 'Error: $e');
    }

    // Device info
    try {
      final deviceInfo = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final android = await deviceInfo.androidInfo;
        setState(() {
          _deviceInfo = '${android.brand} ${android.model}\n'
              'Android ${android.version.release} (SDK ${android.version.sdkInt})\n'
              'ABI: ${android.supportedAbis.join(", ")}\n'
              'Security: ${android.version.securityPatch ?? "N/A"}';
        });
      } else if (Platform.isIOS) {
        final ios = await deviceInfo.iosInfo;
        setState(() {
          _deviceInfo = '${ios.name} (${ios.model})\n'
              'iOS ${ios.systemVersion}';
        });
      }
    } catch (e) {
      setState(() => _deviceInfo = 'Error: $e');
    }

    // Storage info
    try {
      final baseUrl = await getCurrentBaseUrl();
      final token = getCachedToken();
      final tokenPreview = token != null && token.length > 20
          ? '${token.substring(0, 10)}...${token.substring(token.length - 6)}'
          : token ?? 'null';
      setState(() {
        _storageInfo = 'Base URL: $baseUrl\n'
            'Token: $tokenPreview\n'
            'Token type: ${token?.startsWith("sk-") == true ? "API Key" : "JWT"}';
      });
    } catch (e) {
      setState(() => _storageInfo = 'Error: $e');
    }
  }

  Future<void> _runFullDiagnostic() async {
    if (_isRunning) return;
    setState(() {
      _isRunning = true;
      _logs.clear();
    });

    _log('SYSTEM', 'Starting diagnostic...');

    // 1. Auth check
    _log('AUTH', 'Testing /auth/me...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get(AppConfig.mePath);
      final user = resp.data?['data'];
      if (user is Map) {
        _log('AUTH', 'OK — ${user['name']} (${user['email']})');
      } else {
        _log('AUTH', 'OK — status ${resp.statusCode}');
      }
    } on DioException catch (e) {
      _log('AUTH', 'FAIL ${e.response?.statusCode} — ${e.response?.data?['error'] ?? e.message}', isError: true);
    } catch (e) {
      _log('AUTH', 'ERROR: $e', isError: true);
    }

    // 2. Conversations
    _log('CHAT', 'Testing /conversations...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get(AppConfig.conversationsPath);
      final data = resp.data;
      final count = data is Map && data['data'] is List
          ? (data['data'] as List).length
          : '?';
      _log('CHAT', 'OK — $count conversations');
    } on DioException catch (e) {
      _log('CHAT', 'FAIL ${e.response?.statusCode}', isError: true);
    } catch (e) {
      _log('CHAT', 'ERROR: $e', isError: true);
    }

    // 3. Tickets
    _log('TICKETS', 'Testing /tables/1708/rows...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get('/tables/1708/rows');
      final data = resp.data;
      int? count;
      if (data is Map) {
        final rows = data['data'];
        if (rows is Map && rows['rows'] is List) {
          count = (rows['rows'] as List).length;
        } else if (rows is List) {
          count = rows.length;
        }
      }
      _log('TICKETS', 'OK — ${count ?? "?"} tickets');
    } on DioException catch (e) {
      _log('TICKETS', 'FAIL ${e.response?.statusCode}', isError: true);
    } catch (e) {
      _log('TICKETS', 'ERROR: $e', isError: true);
    }

    // 4. Documents
    _log('DOCS', 'Testing /tables/2709/rows...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get('/tables/2709/rows');
      final data = resp.data;
      int? count;
      if (data is Map) {
        final rows = data['data'];
        if (rows is Map && rows['rows'] is List) {
          count = (rows['rows'] as List).length;
        } else if (rows is List) {
          count = rows.length;
        }
      }
      _log('DOCS', 'OK — ${count ?? "?"} documents');
    } on DioException catch (e) {
      _log('DOCS', 'FAIL ${e.response?.statusCode}', isError: true);
    } catch (e) {
      _log('DOCS', 'ERROR: $e', isError: true);
    }

    // 5. Spaces
    _log('SPACES', 'Testing /spaces...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get('/spaces');
      final data = resp.data;
      if (data is Map && data['data'] is List) {
        final spaces = data['data'] as List;
        _log('SPACES', 'OK — ${spaces.length} spaces: ${spaces.map((s) => s['name']).join(", ")}');
      } else {
        _log('SPACES', 'OK — status ${resp.statusCode}');
      }
    } on DioException catch (e) {
      _log('SPACES', 'FAIL ${e.response?.statusCode}', isError: true);
    } catch (e) {
      _log('SPACES', 'ERROR: $e', isError: true);
    }

    // 6. File upload test (no actual file)
    _log('UPLOAD', 'Testing upload endpoint...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get('/uploads/');
      _log('UPLOAD', 'Endpoint reachable — status ${resp.statusCode}');
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code == 404 || code == 405 || code == 403) {
        _log('UPLOAD', 'Endpoint exists (${code})');
      } else {
        _log('UPLOAD', 'Status $code', isError: code == null || code >= 500);
      }
    } catch (e) {
      _log('UPLOAD', 'ERROR: $e', isError: true);
    }

    // 7. Voice/NOA
    _log('VOICE', 'Testing /frame/noa...');
    try {
      final dio = ref.read(apiClientProvider);
      final resp = await dio.get(AppConfig.frameNoaPath);
      _log('VOICE', 'OK — status ${resp.statusCode}');
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code == 405 || code == 400) {
        _log('VOICE', 'Endpoint exists (needs POST)');
      } else {
        _log('VOICE', 'FAIL $code', isError: true);
      }
    } catch (e) {
      _log('VOICE', 'ERROR: $e', isError: true);
    }

    _log('SYSTEM', 'Diagnostic complete.');
    setState(() => _isRunning = false);
  }

  void _copyLogs() {
    final text = _logs.map((l) {
      final time = '${l.time.hour.toString().padLeft(2, '0')}:'
          '${l.time.minute.toString().padLeft(2, '0')}:'
          '${l.time.second.toString().padLeft(2, '0')}';
      return '[$time] [${l.category}] ${l.message}';
    }).join('\n');

    final full = '=== GOD CRM Debug ===\n'
        '$_appInfo\n\n'
        '--- Device ---\n$_deviceInfo\n\n'
        '--- Storage ---\n$_storageInfo\n\n'
        '--- Logs ---\n$text';

    Clipboard.setData(ClipboardData(text: full));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Debug info copied'), duration: Duration(seconds: 1)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Debug Console'),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy, size: 20),
            tooltip: 'Copy all',
            onPressed: _logs.isNotEmpty ? _copyLogs : null,
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 20),
            tooltip: 'Clear logs',
            onPressed: _logs.isNotEmpty
                ? () => setState(() => _logs.clear())
                : null,
          ),
        ],
      ),
      body: Column(
        children: [
          // Info cards
          Container(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _InfoCard(title: 'App', content: _appInfo)),
                const SizedBox(width: 8),
                Expanded(child: _InfoCard(title: 'Device', content: _deviceInfo)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: _InfoCard(title: 'Storage', content: _storageInfo),
          ),
          const SizedBox(height: 8),

          // Run diagnostic button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: _isRunning ? null : _runFullDiagnostic,
                icon: _isRunning
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.play_arrow, size: 20),
                label: Text(_isRunning ? 'Running...' : 'Run Full Diagnostic'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFEF4444),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Divider(height: 1),

          // Log output
          Expanded(
            child: _logs.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.terminal, size: 48, color: GodTheme.textMuted),
                        SizedBox(height: 12),
                        Text('Нажми "Run Full Diagnostic"',
                            style: TextStyle(color: GodTheme.textMuted)),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    itemCount: _logs.length,
                    itemBuilder: (context, i) {
                      final log = _logs[i];
                      final time = '${log.time.hour.toString().padLeft(2, '0')}:'
                          '${log.time.minute.toString().padLeft(2, '0')}:'
                          '${log.time.second.toString().padLeft(2, '0')}';
                      return Padding(
                        key: ValueKey('log_$i'),
                        padding: const EdgeInsets.symmetric(vertical: 1),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(time,
                                style: const TextStyle(
                                  fontSize: 10, fontFamily: 'monospace',
                                  color: GodTheme.textMuted,
                                )),
                            const SizedBox(width: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                              decoration: BoxDecoration(
                                color: _categoryColor(log.category).withOpacity(0.15),
                                borderRadius: BorderRadius.circular(3),
                              ),
                              child: Text(log.category,
                                  style: TextStyle(
                                    fontSize: 9, fontFamily: 'monospace',
                                    fontWeight: FontWeight.bold,
                                    color: _categoryColor(log.category),
                                  )),
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(log.message,
                                  style: TextStyle(
                                    fontSize: 11, fontFamily: 'monospace',
                                    color: log.isError ? GodTheme.error : GodTheme.textPrimary,
                                  )),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Color _categoryColor(String cat) {
    switch (cat) {
      case 'AUTH': return const Color(0xFF22C55E);
      case 'CHAT': return const Color(0xFF3B82F6);
      case 'TICKETS': return const Color(0xFFF59E0B);
      case 'DOCS': return const Color(0xFF8B5CF6);
      case 'SPACES': return const Color(0xFF14B8A6);
      case 'UPLOAD': return const Color(0xFFF97316);
      case 'VOICE': return const Color(0xFFEC4899);
      case 'SYSTEM': return GodTheme.textMuted;
      default: return GodTheme.textSecondary;
    }
  }
}

class _DebugLogEntry {
  final DateTime time;
  final String category;
  final String message;
  final bool isError;

  _DebugLogEntry({
    required this.time,
    required this.category,
    required this.message,
    this.isError = false,
  });
}

class _InfoCard extends StatelessWidget {
  final String title;
  final String content;

  const _InfoCard({required this.title, required this.content});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: GodTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: GodTheme.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(
                fontSize: 10, fontWeight: FontWeight.w700,
                color: GodTheme.textMuted, letterSpacing: 0.5,
              )),
          const SizedBox(height: 4),
          Text(content,
              style: const TextStyle(
                fontSize: 11, fontFamily: 'monospace',
                color: GodTheme.textSecondary, height: 1.4,
              )),
        ],
      ),
    );
  }
}
