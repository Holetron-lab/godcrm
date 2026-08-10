import 'package:flutter/material.dart';
import '../../../../core/theme.dart';
import '../../data/pes_models.dart';

/// Compact stats display for the pet — mood, energy, level, XP.
class PetStatsBar extends StatelessWidget {
  final PesStatus status;

  const PetStatsBar({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: GodTheme.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: GodTheme.border),
      ),
      child: Column(
        children: [
          // Name + Level
          Row(
            children: [
              Text(
                status.identity.name.toUpperCase(),
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: GodTheme.textPrimary,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: GodTheme.primary.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'LV ${status.level.toStringAsFixed(1)}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: GodTheme.primaryLight,
                  ),
                ),
              ),
              const Spacer(),
              _EmotionBadge(state: status.emotions.state),
            ],
          ),
          const SizedBox(height: 12),
          // XP bar
          _ProgressBar(
            label: 'XP',
            value: (status.xp % 100) / 100,
            trailingText: '${status.xp} XP',
            color: GodTheme.primary,
          ),
          const SizedBox(height: 8),
          // Mood + Energy
          Row(
            children: [
              Expanded(
                child: _ProgressBar(
                  label: 'MOOD',
                  value: status.emotions.mood,
                  color: _moodColor(status.emotions.mood),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ProgressBar(
                  label: 'ENERGY',
                  value: status.emotions.energy,
                  color: _energyColor(status.emotions.energy),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          // Quick stats row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _StatChip(
                  icon: Icons.calendar_today,
                  label: '${status.stats.daysAlive}d'),
              _StatChip(
                  icon: Icons.touch_app,
                  label: '${status.stats.totalInteractions}'),
              _StatChip(
                  icon: Icons.terminal,
                  label: '${status.stats.commandsLearned}'),
              _StatChip(
                  icon: Icons.pets,
                  label: status.phase),
            ],
          ),
        ],
      ),
    );
  }

  Color _moodColor(double mood) {
    if (mood > 0.7) return GodTheme.success;
    if (mood > 0.4) return GodTheme.warning;
    return GodTheme.error;
  }

  Color _energyColor(double energy) {
    if (energy > 0.6) return GodTheme.accent;
    if (energy > 0.3) return GodTheme.warning;
    return GodTheme.error;
  }
}

class _EmotionBadge extends StatelessWidget {
  final String state;

  const _EmotionBadge({required this.state});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: GodTheme.surfaceLight,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: GodTheme.border),
      ),
      child: Text(
        _emotionEmoji(state),
        style: const TextStyle(fontSize: 14),
      ),
    );
  }

  String _emotionEmoji(String state) {
    const map = {
      'happy': '😊 happy',
      'excited': '🤩 excited',
      'playful': '🎮 playful',
      'curious': '🔍 curious',
      'content': '😌 content',
      'neutral': '😐 neutral',
      'sleepy': '😴 sleepy',
      'bored': '😒 bored',
      'lonely': '🥺 lonely',
      'anxious': '😰 anxious',
      'alert': '🚨 alert',
      'zoomies': '⚡ zoomies',
      'focused': '🎯 focused',
      'proud': '🏆 proud',
      'grateful': '🙏 grateful',
      'mischievous': '😈 mischief',
    };
    return map[state] ?? '🐾 $state';
  }
}

class _ProgressBar extends StatelessWidget {
  final String label;
  final double value;
  final String? trailingText;
  final Color color;

  const _ProgressBar({
    required this.label,
    required this.value,
    required this.color,
    this.trailingText,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: GodTheme.textMuted,
                letterSpacing: 1,
              ),
            ),
            if (trailingText != null) ...[
              const Spacer(),
              Text(
                trailingText!,
                style: TextStyle(
                  fontSize: 10,
                  color: color,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: value.clamp(0, 1),
            backgroundColor: GodTheme.surfaceLight,
            valueColor: AlwaysStoppedAnimation(color),
            minHeight: 6,
          ),
        ),
      ],
    );
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _StatChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: GodTheme.textMuted),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            color: GodTheme.textSecondary,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}
