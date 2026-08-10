/// PES data models — maps to /api/v3/pes/* responses.

class PesStatus {
  final bool alive;
  final String mode;
  final PesIdentity identity;
  final PesEmotions emotions;
  final Map<String, double> traits;
  final double level;
  final int xp;
  final String phase;
  final PesStats stats;
  final DateTime? lastActivity;

  const PesStatus({
    required this.alive,
    required this.mode,
    required this.identity,
    required this.emotions,
    required this.traits,
    required this.level,
    required this.xp,
    required this.phase,
    required this.stats,
    this.lastActivity,
  });

  factory PesStatus.fromJson(Map<String, dynamic> json) {
    return PesStatus(
      alive: json['alive'] ?? false,
      mode: json['mode'] ?? 'unknown',
      identity: PesIdentity.fromJson(json['identity'] ?? {}),
      emotions: PesEmotions.fromJson(json['emotions'] ?? {}),
      traits: _parseTraits(json['traits']),
      level: (json['level'] ?? 0).toDouble(),
      xp: json['xp'] ?? 0,
      phase: json['phase'] ?? 'egg',
      stats: PesStats.fromJson(json['stats'] ?? {}),
      lastActivity: json['lastActivity'] != null
          ? DateTime.tryParse(json['lastActivity'].toString())
          : null,
    );
  }

  static Map<String, double> _parseTraits(dynamic raw) {
    if (raw is! Map) return {};
    return raw.map((k, v) => MapEntry(k.toString(), (v ?? 0).toDouble()));
  }
}

class PesIdentity {
  final String name;
  final String species;
  final String breed;
  final double seed;

  const PesIdentity({
    required this.name,
    required this.species,
    required this.breed,
    required this.seed,
  });

  factory PesIdentity.fromJson(Map<String, dynamic> json) {
    return PesIdentity(
      name: json['name'] ?? 'Unknown',
      species: json['species'] ?? 'unknown',
      breed: json['breed'] ?? 'unknown',
      seed: (json['seed'] ?? 0).toDouble(),
    );
  }
}

class PesEmotions {
  final String state;
  final double intensity;
  final double mood;
  final double energy;

  const PesEmotions({
    required this.state,
    required this.intensity,
    required this.mood,
    required this.energy,
  });

  factory PesEmotions.fromJson(Map<String, dynamic> json) {
    final current = json['current'] ?? json;
    return PesEmotions(
      state: current['state'] ?? 'neutral',
      intensity: (current['intensity'] ?? 0.5).toDouble(),
      mood: (current['mood'] ?? 0.5).toDouble(),
      energy: (current['energy'] ?? 0.5).toDouble(),
    );
  }
}

class PesStats {
  final int totalInteractions;
  final int daysAlive;
  final int commandsLearned;
  final int fetchesCompleted;

  const PesStats({
    required this.totalInteractions,
    required this.daysAlive,
    required this.commandsLearned,
    required this.fetchesCompleted,
  });

  factory PesStats.fromJson(Map<String, dynamic> json) {
    return PesStats(
      totalInteractions: json['totalInteractions'] ?? 0,
      daysAlive: json['daysAlive'] ?? 0,
      commandsLearned: json['commandsLearned'] ?? 0,
      fetchesCompleted: json['fetchesCompleted'] ?? 0,
    );
  }
}

class PesTimelineEntry {
  final String day;
  final int count;
  final int totalXp;

  const PesTimelineEntry({
    required this.day,
    required this.count,
    required this.totalXp,
  });

  factory PesTimelineEntry.fromJson(Map<String, dynamic> json) {
    return PesTimelineEntry(
      day: json['day'] ?? '',
      count: json['count'] ?? 0,
      totalXp: json['total_xp'] ?? json['totalXp'] ?? 0,
    );
  }
}

class PesXpEntry {
  final String actionType;
  final int xpGained;
  final String? timestamp;

  const PesXpEntry({
    required this.actionType,
    required this.xpGained,
    this.timestamp,
  });

  factory PesXpEntry.fromJson(Map<String, dynamic> json) {
    return PesXpEntry(
      actionType: json['action_type'] ?? json['actionType'] ?? '',
      xpGained: json['xp_gained'] ?? json['xpGained'] ?? 0,
      timestamp: json['timestamp']?.toString(),
    );
  }
}
