import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/router.dart';
import '../../core/theme.dart';
import '../../features/chat/providers/conversations_provider.dart';
import '../../features/modules/ui/modules_screen.dart';

/// Computed provider: total unread count across all conversations.
final totalUnreadProvider = Provider<int>((ref) {
  final conversations = ref.watch(conversationsProvider).valueOrNull;
  if (conversations == null) return 0;
  int total = 0;
  for (final c in conversations) {
    total += c.unreadCount;
  }
  return total;
});

/// Main app shell with bottom navigation bar.
class MainShell extends ConsumerWidget {
  final Widget child;

  const MainShell({super.key, required this.child});

  /// Build tabs list dynamically based on installed modules.
  static List<_TabItem> _buildTabs(Set<String> installedModules) {
    final tabs = <_TabItem>[
      const _TabItem(icon: Icons.apps_outlined, activeIcon: Icons.apps, label: 'Modules', path: Routes.modules),
      const _TabItem(icon: Icons.chat_bubble_outline, activeIcon: Icons.chat_bubble, label: 'Chat', path: Routes.chat),
      const _TabItem(icon: Icons.assignment_outlined, activeIcon: Icons.assignment, label: 'Tickets', path: Routes.tickets),
    ];

    // Add pinned modules
    for (final module in allModules) {
      if (installedModules.contains(module.id)) {
        tabs.add(_TabItem(
          icon: module.icon,
          activeIcon: module.activeIcon,
          label: module.name,
          path: module.route,
        ));
      }
    }

    tabs.add(const _TabItem(icon: Icons.settings_outlined, activeIcon: Icons.settings, label: 'More', path: Routes.settings));

    return tabs;
  }

  int _currentIndex(BuildContext context, List<_TabItem> tabs) {
    final location = GoRouterState.of(context).matchedLocation;
    for (var i = 0; i < tabs.length; i++) {
      if (location.startsWith(tabs[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final installedModules = ref.watch(installedModulesProvider);
    final tabs = _buildTabs(installedModules);
    final index = _currentIndex(context, tabs);
    final clampedIndex = index.clamp(0, tabs.length - 1);

    final totalUnread = ref.watch(totalUnreadProvider);

    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: GodTheme.border, width: 1)),
        ),
        child: BottomNavigationBar(
          currentIndex: clampedIndex,
          onTap: (i) => context.go(tabs[i].path),
          type: BottomNavigationBarType.fixed,
          selectedFontSize: 11,
          unselectedFontSize: 10,
          items: tabs.asMap().entries.map((entry) {
            final i = entry.key;
            final tab = entry.value;

            // Add unread badge to Chat tab
            if (tab.path == Routes.chat && totalUnread > 0) {
              return BottomNavigationBarItem(
                icon: Badge(
                  label: Text(
                    totalUnread > 99 ? '99+' : '$totalUnread',
                    style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600),
                  ),
                  backgroundColor: GodTheme.error,
                  child: Icon(tab.icon),
                ),
                activeIcon: Badge(
                  label: Text(
                    totalUnread > 99 ? '99+' : '$totalUnread',
                    style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600),
                  ),
                  backgroundColor: GodTheme.error,
                  child: Icon(tab.activeIcon),
                ),
                label: tab.label,
              );
            }

            return BottomNavigationBarItem(
              icon: Icon(tab.icon),
              activeIcon: Icon(tab.activeIcon),
              label: tab.label,
            );
          }).toList(),
        ),
      ),
    );
  }
}

class _TabItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final String path;

  const _TabItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.path,
  });
}
