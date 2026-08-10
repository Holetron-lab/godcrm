import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme.dart';
import '../providers/pes_provider.dart';
import 'widgets/pixel_pet_widget.dart';
import 'widgets/pet_stats_bar.dart';
import 'widgets/traits_radar.dart';

/// PES Home Screen — the main pet interface.
/// Neo-tamagotchi style: dark, pixel art pet, live stats.
class PesHomeScreen extends ConsumerWidget {
  const PesHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(pesStatusProvider);

    return Scaffold(
      backgroundColor: GodTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'PES',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            letterSpacing: 3,
            color: GodTheme.textPrimary,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: GodTheme.textSecondary),
            onPressed: () => ref.read(pesStatusProvider.notifier).refresh(),
          ),
        ],
      ),
      body: statusAsync.when(
        loading: () => const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(color: GodTheme.primary),
              SizedBox(height: 16),
              Text(
                'Connecting to pet...',
                style: TextStyle(color: GodTheme.textMuted),
              ),
            ],
          ),
        ),
        error: (err, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off, size: 48, color: GodTheme.textMuted),
              const SizedBox(height: 16),
              Text(
                'Cannot reach PES',
                style: const TextStyle(
                    color: GodTheme.textSecondary, fontSize: 16),
              ),
              const SizedBox(height: 8),
              Text(
                err.toString(),
                style: const TextStyle(color: GodTheme.textMuted, fontSize: 12),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.read(pesStatusProvider.notifier).refresh(),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (status) => _PesHomeBody(status: status),
      ),
    );
  }
}

class _PesHomeBody extends StatelessWidget {
  final dynamic status;

  const _PesHomeBody({required this.status});

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async {
        // Pull to refresh handled by provider
      },
      color: GodTheme.primary,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        children: [
          const SizedBox(height: 8),
          // Alive indicator
          if (status.alive)
            Center(
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: GodTheme.success.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: GodTheme.success.withOpacity(0.3)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: GodTheme.success,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'ONLINE',
                      style: TextStyle(
                        fontSize: 11,
                        color: GodTheme.success,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 16),

          // Pixel Pet — centered, large
          Center(
            child: PixelPetWidget(status: status, size: 220),
          ),
          const SizedBox(height: 24),

          // Stats bar
          PetStatsBar(status: status),
          const SizedBox(height: 16),

          // Traits radar
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: GodTheme.card,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: GodTheme.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'TRAITS',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: GodTheme.textMuted,
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: 8),
                Center(
                  child: TraitsRadar(traits: status.traits, size: 200),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Quick actions
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  icon: Icons.pets,
                  label: 'Pet',
                  onTap: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('*wags tail*')),
                    );
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  icon: Icons.restaurant,
                  label: 'Feed',
                  onTap: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('*nom nom*')),
                    );
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  icon: Icons.sports_esports,
                  label: 'Play',
                  onTap: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('*zoomies!*')),
                    );
                  },
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: GodTheme.card,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: GodTheme.border),
          ),
          child: Column(
            children: [
              Icon(icon, color: GodTheme.primaryLight, size: 28),
              const SizedBox(height: 6),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: GodTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
