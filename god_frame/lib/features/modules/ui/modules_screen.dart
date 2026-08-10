import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/theme.dart';
import '../../../core/router.dart';
import 'package:go_router/go_router.dart';

/// Which modules are "installed" on the bottom nav bar.
final installedModulesProvider =
    StateNotifierProvider<InstalledModulesNotifier, Set<String>>((ref) {
  return InstalledModulesNotifier();
});

class InstalledModulesNotifier extends StateNotifier<Set<String>> {
  InstalledModulesNotifier() : super({}) {
    _load();
  }

  static const _key = 'installed_modules';

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_key);
    if (list != null) {
      state = list.toSet();
    }
  }

  Future<void> toggle(String moduleId) async {
    final newSet = Set<String>.from(state);
    if (newSet.contains(moduleId)) {
      newSet.remove(moduleId);
    } else {
      newSet.add(moduleId);
    }
    state = newSet;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_key, newSet.toList());
  }

  bool isInstalled(String moduleId) => state.contains(moduleId);
}

/// Module definition.
class AppModule {
  final String id;
  final String name;
  final String description;
  final IconData icon;
  final IconData activeIcon;
  final String route;
  final Color color;

  const AppModule({
    required this.id,
    required this.name,
    required this.description,
    required this.icon,
    required this.activeIcon,
    required this.route,
    required this.color,
  });
}

/// All available modules.
const allModules = [
  AppModule(
    id: 'pes',
    name: 'PES',
    description: 'Neo-tamagotchi pet companion',
    icon: Icons.pets_outlined,
    activeIcon: Icons.pets,
    route: Routes.pes,
    color: Color(0xFF10B981),
  ),
  AppModule(
    id: 'documents',
    name: 'Documents',
    description: 'Knowledge base & documentation',
    icon: Icons.description_outlined,
    activeIcon: Icons.description,
    route: Routes.documents,
    color: Color(0xFF6366F1),
  ),
  AppModule(
    id: 'contacts',
    name: 'Contacts',
    description: 'People & organizations',
    icon: Icons.people_outline,
    activeIcon: Icons.people,
    route: Routes.contacts,
    color: Color(0xFF0EA5E9),
  ),
  AppModule(
    id: 'frame',
    name: 'Frame',
    description: 'Brilliant Frame glasses',
    icon: Icons.smart_toy_outlined,
    activeIcon: Icons.smart_toy,
    route: Routes.frame,
    color: Color(0xFFF59E0B),
  ),
  AppModule(
    id: 'voice',
    name: 'Voice Mode',
    description: 'Hands-free voice assistant',
    icon: Icons.mic_none,
    activeIcon: Icons.mic,
    route: Routes.voiceMode,
    color: Color(0xFFEC4899),
  ),
];

class ModulesScreen extends ConsumerWidget {
  const ModulesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final installed = ref.watch(installedModulesProvider);

    return Scaffold(
      backgroundColor: GodTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Modules',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: GodTheme.textPrimary,
          ),
        ),
      ),
      body: ListView.builder(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        itemCount: allModules.length,
        itemBuilder: (context, index) {
          final module = allModules[index];
          final isInstalled = installed.contains(module.id);

          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Material(
              color: GodTheme.card,
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                onTap: () => context.go(module.route),
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: GodTheme.border),
                  ),
                  child: Row(
                    children: [
                      // Module icon
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: module.color.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          module.icon,
                          color: module.color,
                          size: 24,
                        ),
                      ),
                      const SizedBox(width: 16),
                      // Name + description
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              module.name,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                                color: GodTheme.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              module.description,
                              style: const TextStyle(
                                fontSize: 13,
                                color: GodTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      // Install toggle
                      Column(
                        children: [
                          IconButton(
                            icon: Icon(
                              isInstalled
                                  ? Icons.push_pin
                                  : Icons.push_pin_outlined,
                              color: isInstalled
                                  ? GodTheme.primary
                                  : GodTheme.textMuted,
                              size: 20,
                            ),
                            tooltip: isInstalled
                                ? 'Remove from nav bar'
                                : 'Add to nav bar',
                            onPressed: () {
                              ref
                                  .read(installedModulesProvider.notifier)
                                  .toggle(module.id);
                            },
                            constraints: const BoxConstraints(
                              minWidth: 36,
                              minHeight: 36,
                            ),
                            padding: EdgeInsets.zero,
                          ),
                          if (isInstalled)
                            const Text(
                              'Pinned',
                              style: TextStyle(
                                fontSize: 9,
                                color: GodTheme.primary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(width: 4),
                      // Arrow to open
                      const Icon(
                        Icons.chevron_right,
                        color: GodTheme.textMuted,
                        size: 20,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
