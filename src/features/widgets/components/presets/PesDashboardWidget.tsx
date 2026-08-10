import { useState } from 'react';
import {
  Dog,
  Loader2,
  AlertTriangle,
  Heart,
  Zap,
  Brain,
  Star,
  TrendingUp,
  Clock,
  RefreshCw,
  Eye,
  MessageSquare,
  Sparkles,
  Activity,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { PresetWidgetProps } from '../../types/widget.types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PesIdentity {
  name: string;
  breed: string;
  birthday: string;
  domain: string;
  seed: number;
}

interface PesEmotions {
  state: string;
  intensity: number;
  mood: number;
  energy: number;
  hunger: number;
  curiosity: number;
  loneliness: number;
}

interface PesStats {
  bugsFound: number;
  bugsSolved: number;
  fetchesTotal: number;
  commandsLearned: number;
  relationships: number;
  totalInteractions: number;
}

interface PesInteraction {
  id: number;
  actor: string;
  actionType: string;
  emotionBefore: string;
  emotionAfter: string;
  xpGained: number;
  timestamp: string;
}

interface PesStatus {
  alive: boolean;
  mode: string;
  identity: PesIdentity;
  emotions: PesEmotions;
  traits: Record<string, number>;
  level: number;
  xp: number;
  phase: string;
  stats: PesStats | null;
  recentInteractions: PesInteraction[];
  lastActivity: string | null;
  savedAt: string;
  error?: string;
}

// ─── Emotion Display ─────────────────────────────────────────────────────────

const EMOTION_ICONS: Record<string, string> = {
  idle: '😌', content: '☺️', playful: '🎾', happy: '😄',
  butt_wiggle: '🍑', zoomies: '⚡', play_bow: '🐕', greeting_frenzy: '🤗',
  puppy_eyes: '🥺', wanna_play: '🎮', velcro: '🤝', jealous: '😤', howl_sing: '🎵',
  alert: '⚠️', bark: '📢', herding: '🐑', bossy: '👑', puzzle_solving: '🧩', wrote_somewhere: '📝',
  grumble: '😒', dramatic_tantrum: '😭', stubborn_refuse: '🙅', sulking: '😔', side_eye: '👀',
  sleep: '💤', nap: '😴', sploot: '🫠', corgi_flop: '⬇️',
  scared: '😨', anxious: '😰', separation_stress: '💔',
  rage: '🔥', sneaky: '🤫', food_obsessed: '🍖',
};

const MODE_COLORS: Record<string, string> = {
  active: 'text-green-400',
  idle: 'text-yellow-400',
  sleeping: 'text-blue-400',
  away: 'text-zinc-500',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function PesDashboardWidget({ widget }: PresetWidgetProps) {
  const [tab, setTab] = useState<'overview' | 'traits' | 'history'>('overview');

  const { data: pesData, isLoading, error, refetch } = useQuery<PesStatus>({
    queryKey: ['pes', 'status'],
    queryFn: async () => {
      const res = await apiClient.get('/api/v3/pes/status');
      return res.data.data;
    },
    refetchInterval: 15_000,
  });

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        <span className="ml-2 text-zinc-500">Loading PES...</span>
      </div>
    );
  }

  // Error
  if (error || !pesData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-sm">PES unavailable</p>
        <button onClick={() => refetch()} className="text-xs text-blue-400 hover:underline">
          Retry
        </button>
      </div>
    );
  }

  // Not alive
  if (!pesData.alive) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-2">
        <Dog className="w-12 h-12 text-zinc-600" />
        <p className="text-sm">PES is not running</p>
      </div>
    );
  }

  const emotions = pesData.emotions;
  const identity = pesData.identity;
  const traits = pesData.traits;
  const stats = pesData.stats;

  return (
    <div className="h-full flex flex-col overflow-hidden text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">{EMOTION_ICONS[emotions?.state] || '🐕'}</span>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-zinc-100">{identity?.name || 'PES'}</span>
              <span className={cn('text-xs', MODE_COLORS[pesData.mode] || 'text-zinc-500')}>
                {pesData.mode}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Star className="w-3 h-3 text-yellow-500" />
              <span>Lv.{pesData.level}</span>
              <span className="text-zinc-700">|</span>
              <span>{pesData.xp} XP</span>
              <span className="text-zinc-700">|</span>
              <span>{pesData.phase}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        {(['overview', 'traits', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium transition-colors',
              tab === t
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            {t === 'overview' ? 'Overview' : t === 'traits' ? 'Traits' : 'History'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'overview' && (
          <OverviewTab emotions={emotions} stats={stats} mode={pesData.mode} identity={identity} />
        )}
        {tab === 'traits' && <TraitsTab traits={traits} />}
        {tab === 'history' && <HistoryTab interactions={pesData.recentInteractions} />}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-zinc-800 text-xs text-zinc-600 flex justify-between">
        <span>Auto-refresh: 15s</span>
        <span>{pesData.savedAt ? new Date(pesData.savedAt).toLocaleTimeString() : '—'}</span>
      </div>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({
  emotions,
  stats,
  mode,
  identity,
}: {
  emotions: PesEmotions;
  stats: PesStats | null;
  mode: string;
  identity: PesIdentity;
}) {
  return (
    <div className="space-y-3">
      {/* Vitals */}
      <div className="grid grid-cols-2 gap-2">
        <VitalBar label="Mood" value={emotions?.mood} icon={<Heart className="w-3 h-3" />} color="text-pink-400" bgColor="bg-pink-500" />
        <VitalBar label="Energy" value={emotions?.energy} icon={<Zap className="w-3 h-3" />} color="text-yellow-400" bgColor="bg-yellow-500" />
        <VitalBar label="Curiosity" value={emotions?.curiosity} icon={<Eye className="w-3 h-3" />} color="text-blue-400" bgColor="bg-blue-500" />
        <VitalBar label="Hunger" value={emotions?.hunger} icon={<Sparkles className="w-3 h-3" />} color="text-orange-400" bgColor="bg-orange-500" />
      </div>

      {/* Emotion State */}
      <div className="border border-zinc-800 rounded-lg p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-lg">{EMOTION_ICONS[emotions?.state] || '?'}</span>
            <span className="text-zinc-200 font-medium">{emotions?.state?.replace(/_/g, ' ')}</span>
          </div>
          <div className="text-xs text-zinc-500">
            intensity: {Math.round((emotions?.intensity || 0) * 100)}%
          </div>
        </div>
        {emotions?.loneliness > 0.3 && (
          <div className="mt-1 text-xs text-red-400/80">
            Loneliness: {Math.round(emotions.loneliness * 100)}%
          </div>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Interactions" value={stats.totalInteractions} icon={<MessageSquare className="w-3 h-3" />} />
          <StatCard label="Commands" value={stats.commandsLearned} icon={<Brain className="w-3 h-3" />} />
          <StatCard label="Bugs Found" value={stats.bugsFound} icon={<Activity className="w-3 h-3" />} />
        </div>
      )}

      {/* Identity */}
      <div className="text-xs text-zinc-600 space-y-0.5">
        <div>Breed: {identity?.breed} | Domain: {identity?.domain}</div>
        {identity?.birthday && (
          <div>Born: {new Date(identity.birthday).toLocaleDateString()}</div>
        )}
      </div>
    </div>
  );
}

// ─── Traits Tab ──────────────────────────────────────────────────────────────

const TRAIT_LABELS: Record<string, { label: string; emoji: string }> = {
  courage: { label: 'Courage', emoji: '🦁' },
  curiosity: { label: 'Curiosity', emoji: '🔍' },
  loyalty: { label: 'Loyalty', emoji: '💎' },
  stubbornness: { label: 'Stubbornness', emoji: '🪨' },
  playfulness: { label: 'Playfulness', emoji: '🎾' },
  drama: { label: 'Drama', emoji: '🎭' },
  foodDrive: { label: 'Food Drive', emoji: '🍖' },
  sassiness: { label: 'Sassiness', emoji: '💅' },
  aggression: { label: 'Aggression', emoji: '🔒' },
};

function TraitsTab({ traits }: { traits: Record<string, number> }) {
  if (!traits) return <div className="text-zinc-500 text-xs">No trait data</div>;

  return (
    <div className="space-y-2">
      {Object.entries(traits).map(([key, value]) => {
        const info = TRAIT_LABELS[key] || { label: key, emoji: '?' };
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-sm">{info.emoji}</span>
            <span className="text-xs text-zinc-400 w-24">{info.label}</span>
            <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  key === 'aggression' ? 'bg-red-600' : value > 0.6 ? 'bg-green-500' : value > 0.3 ? 'bg-yellow-500' : 'bg-zinc-600'
                )}
                style={{ width: `${Math.round(value * 100)}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 w-10 text-right">
              {Math.round(value * 100)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────

function HistoryTab({ interactions }: { interactions: PesInteraction[] }) {
  if (!interactions || interactions.length === 0) {
    return <div className="text-zinc-500 text-xs">No recent interactions</div>;
  }

  return (
    <div className="space-y-1.5">
      {interactions.map((i) => (
        <div key={i.id} className="flex items-center gap-2 text-xs border-b border-zinc-800/50 pb-1.5">
          <span className="text-zinc-600 w-14 flex-shrink-0">
            {i.timestamp ? new Date(i.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
          <span className="text-zinc-400 flex-1 truncate">
            {i.actor}: {i.actionType?.replace(/_/g, ' ')}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-zinc-600">{EMOTION_ICONS[i.emotionBefore] || '?'}</span>
            <span className="text-zinc-700">→</span>
            <span>{EMOTION_ICONS[i.emotionAfter] || '?'}</span>
          </div>
          {i.xpGained > 0 && (
            <span className="text-green-500 flex-shrink-0">+{i.xpGained}xp</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────────

function VitalBar({
  label,
  value,
  icon,
  color,
  bgColor,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}) {
  const pct = Math.round((value || 0) * 100);
  return (
    <div className="border border-zinc-800 rounded-lg p-2">
      <div className="flex items-center gap-1 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-xs text-zinc-400">{label}</span>
        <span className={cn('text-xs ml-auto font-medium', color)}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', bgColor)}
          style={{ width: `${pct}%`, opacity: 0.7 }}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="border border-zinc-800 rounded-lg p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-zinc-500 mb-0.5">{icon}</div>
      <div className="text-lg font-bold text-zinc-200">{value}</div>
      <div className="text-[10px] text-zinc-500">{label}</div>
    </div>
  );
}
