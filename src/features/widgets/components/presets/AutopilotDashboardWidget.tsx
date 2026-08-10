import { useState, useCallback } from 'react';
import {
  Bot,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Pause,
  RefreshCw,
  Activity,
  TrendingUp,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { PresetWidgetProps } from '../../types/widget.types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PipelineCounts {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface AgentStat {
  agent_name: string;
  agent_user_id: number;
  total_jobs: number;
  completed: number;
  failed: number;
  active: number;
  pending: number;
  avg_duration_sec: number | null;
}

interface ActiveJob {
  id: number;
  job_id: string;
  agent_name: string;
  agent_user_id: number;
  agent_row_id: number;
  status: 'pending' | 'processing';
  created_at: string;
  started_at: string | null;
  timeout_at: string | null;
  attempts: number;
  max_attempts: number;
  conversation_id: number;
  context: string | null;
}

interface RecentJob {
  id: number;
  job_id: string;
  agent_name: string;
  agent_user_id: number;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
  error_message: string | null;
  conversation_id: number;
}

interface ErrorJob {
  id: number;
  job_id: string;
  agent_name: string;
  agent_user_id: number;
  error_message: string;
  created_at: string;
  completed_at: string | null;
  attempts: number;
  conversation_id: number;
}

interface ThroughputBucket {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
  processing: number;
}

interface DashboardData {
  pipeline: PipelineCounts;
  agents: AgentStat[];
  activeJobs: ActiveJob[];
  recentJobs: RecentJob[];
  throughput: {
    last_24h: ThroughputBucket;
    last_7d: ThroughputBucket;
  };
  errors: ErrorJob[];
  generated_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  Orchestrator: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'Developer Ralph': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Developer: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  Frontend: 'bg-green-500/20 text-green-300 border-green-500/30',
  'Frontend QA': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  'Test Runner': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  Architect: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
};

function getAgentColor(name: string) {
  return AGENT_COLORS[name] || 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30';
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || isNaN(seconds)) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/20', label: 'Pending' },
  processing: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Processing' },
  completed: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/20', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20', label: 'Failed' },
  cancelled: { icon: Pause, color: 'text-zinc-400', bg: 'bg-zinc-500/20', label: 'Cancelled' },
} as const;

// ─── Sub-components ──────────────────────────────────────────────────────────

function PipelineBar({ pipeline }: { pipeline: PipelineCounts }) {
  const total = pipeline.pending + pipeline.processing + pipeline.completed + pipeline.failed + pipeline.cancelled;
  if (total === 0) return null;

  const segments = [
    { key: 'completed', count: pipeline.completed, color: 'bg-green-500', label: 'Done' },
    { key: 'processing', count: pipeline.processing, color: 'bg-blue-500', label: 'Active' },
    { key: 'pending', count: pipeline.pending, color: 'bg-yellow-500', label: 'Queued' },
    { key: 'failed', count: pipeline.failed, color: 'bg-red-500', label: 'Failed' },
    { key: 'cancelled', count: pipeline.cancelled, color: 'bg-zinc-500', label: 'Cancelled' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 h-3 rounded-full overflow-hidden bg-zinc-800">
        {segments.map(s => s.count > 0 && (
          <div
            key={s.key}
            className={cn(s.color, 'h-full transition-all duration-500')}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map(s => (
          <div key={s.key} className="flex items-center gap-1.5">
            <div className={cn('w-2 h-2 rounded-full', s.color)} />
            <span className="text-zinc-400">{s.label}</span>
            <span className="text-zinc-200 font-medium">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent, activeJobs }: { agent: AgentStat; activeJobs: ActiveJob[] }) {
  const currentJobs = activeJobs.filter(j => j.agent_user_id === agent.agent_user_id);
  const successRate = agent.total_jobs > 0
    ? Math.round((agent.completed / agent.total_jobs) * 100)
    : 0;

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2 transition-colors',
      agent.active > 0 ? 'border-blue-500/40 bg-blue-500/5' :
      agent.failed > 0 ? 'border-red-500/30 bg-red-500/5' :
      'border-zinc-700/50 bg-zinc-800/30'
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', agent.active > 0 ? 'bg-blue-400 animate-pulse' : agent.pending > 0 ? 'bg-yellow-400' : 'bg-zinc-500')} />
          <span className={cn('text-sm font-medium px-2 py-0.5 rounded border', getAgentColor(agent.agent_name))}>
            {agent.agent_name}
          </span>
        </div>
        <span className="text-xs text-zinc-500">#{agent.agent_user_id}</span>
      </div>

      {/* Current task */}
      {currentJobs.length > 0 ? (
        <div className="text-xs space-y-1">
          {currentJobs.map(job => (
            <div key={job.id} className="flex items-center gap-1.5 text-blue-300">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="truncate">Job #{job.id} ({job.status})</span>
              {job.started_at && <span className="text-zinc-500 ml-auto flex-shrink-0">{timeAgo(job.started_at)}</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">Idle</div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span title="Completed"><CheckCircle2 className="w-3 h-3 inline text-green-400" /> {agent.completed}</span>
        <span title="Failed"><XCircle className="w-3 h-3 inline text-red-400" /> {agent.failed}</span>
        <span title="Success rate">{successRate}%</span>
        <span title="Avg duration" className="ml-auto">{formatDuration(agent.avg_duration_sec)}</span>
      </div>
    </div>
  );
}

function ThroughputCard({ label, data }: { label: string; data: ThroughputBucket }) {
  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/30 p-3 space-y-1">
      <div className="text-xs text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-zinc-100">{data.total}</div>
      <div className="flex gap-3 text-xs">
        <span className="text-green-400">{data.completed} done</span>
        {data.failed > 0 && <span className="text-red-400">{data.failed} failed</span>}
        {data.processing > 0 && <span className="text-blue-400">{data.processing} active</span>}
      </div>
    </div>
  );
}

function ErrorRow({ err, onCancel }: { err: ErrorJob; onCancel?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-zinc-800 last:border-0 py-2">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
        <span className="text-xs text-zinc-300 font-medium">{err.agent_name}</span>
        <span className="text-xs text-zinc-500">Job #{err.id}</span>
        <span className="text-xs text-zinc-600 ml-auto">{err.completed_at ? timeAgo(err.completed_at) : timeAgo(err.created_at)}</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
      </div>
      {expanded && (
        <div className="mt-1 ml-5 text-xs text-red-300/80 bg-red-500/10 rounded p-2 font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
          {err.error_message || 'No error message'}
        </div>
      )}
    </div>
  );
}

function RecentJobRow({ job }: { job: RecentJob }) {
  const cfg = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.cancelled;
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-zinc-800/50 last:border-0 text-xs">
      <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', cfg.color, job.status === 'processing' && 'animate-spin')} />
      <span className="text-zinc-300 font-medium w-24 truncate">{job.agent_name}</span>
      <span className="text-zinc-500">#{job.id}</span>
      {job.attempts > 1 && <span className="text-orange-400 text-[10px]">x{job.attempts}</span>}
      <span className="text-zinc-600 ml-auto">{timeAgo(job.created_at)}</span>
    </div>
  );
}

// ─── Main Widget ─────────────────────────────────────────────────────────────

export function AutopilotDashboardWidget({ widget }: PresetWidgetProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'errors' | 'history'>('overview');

  const { data: dashboard, isLoading, error: fetchError } = useQuery<DashboardData>({
    queryKey: ['autopilot', 'dashboard'],
    queryFn: async () => {
      const res = await apiClient.get('/api/v3/ai/autopilot/dashboard');
      return res.data.data;
    },
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const cancelMutation = useMutation({
    mutationFn: async (jobId: number) => {
      await apiClient.post(`/api/v3/ai/autopilot/jobs/${jobId}/cancel`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot', 'dashboard'] });
    },
  });

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['autopilot', 'dashboard'] });
  }, [queryClient]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  // Error state
  if (fetchError || !dashboard) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-red-400">
        <AlertTriangle className="w-6 h-6" />
        <p className="text-sm">Failed to load autopilot data</p>
        <button onClick={handleRefresh} className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  const { pipeline, agents, activeJobs, recentJobs, throughput, errors } = dashboard;

  return (
    <div className="h-full flex flex-col overflow-hidden text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-medium">Autopilot</span>
          <span className="text-xs text-zinc-500">
            {activeJobs.length} active
          </span>
          {pipeline.failed > 0 && (
            <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
              {pipeline.failed} failed
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Tab pills */}
          {(['overview', 'errors', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'text-xs px-2 py-1 rounded transition-colors capitalize',
                activeTab === tab ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              {tab}
              {tab === 'errors' && errors.length > 0 && (
                <span className="ml-1 text-red-400">({errors.length})</span>
              )}
            </button>
          ))}
          <button onClick={handleRefresh} className="ml-2 p-1 text-zinc-500 hover:text-zinc-300 rounded">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {activeTab === 'overview' && (
          <>
            {/* Pipeline bar */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Pipeline</div>
              <PipelineBar pipeline={pipeline} />
            </div>

            {/* Throughput cards */}
            <div className="grid grid-cols-2 gap-3">
              <ThroughputCard label="Last 24h" data={throughput.last_24h} />
              <ThroughputCard label="Last 7 days" data={throughput.last_7d} />
            </div>

            {/* Agent cards */}
            <div>
              <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Agents (7d)</div>
              {agents.length === 0 ? (
                <div className="text-xs text-zinc-600 py-4 text-center">No agent activity in last 7 days</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {agents.map(agent => (
                    <AgentCard key={agent.agent_user_id} agent={agent} activeJobs={activeJobs} />
                  ))}
                </div>
              )}
            </div>

            {/* Active jobs with cancel buttons */}
            {activeJobs.length > 0 && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Active Jobs</div>
                <div className="space-y-1">
                  {activeJobs.map(job => (
                    <div key={job.id} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <Loader2 className={cn('w-3.5 h-3.5 flex-shrink-0', job.status === 'processing' ? 'animate-spin text-blue-400' : 'text-yellow-400')} />
                      <span className="text-zinc-300 font-medium">{job.agent_name}</span>
                      <span className="text-zinc-500">#{job.id}</span>
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px]', STATUS_CONFIG[job.status].bg, STATUS_CONFIG[job.status].color)}>
                        {job.status}
                      </span>
                      {job.started_at && <span className="text-zinc-600">{timeAgo(job.started_at)}</span>}
                      <button
                        onClick={() => cancelMutation.mutate(job.id)}
                        disabled={cancelMutation.isPending}
                        className="ml-auto text-red-400/70 hover:text-red-400 hover:bg-red-500/10 px-1.5 py-0.5 rounded transition-colors"
                        title="Cancel job"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'errors' && (
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Recent Failures</div>
            {errors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
                <CheckCircle2 className="w-8 h-8 mb-2 text-green-500/50" />
                <p className="text-sm">No recent failures</p>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/20 px-3">
                {errors.map(err => (
                  <ErrorRow key={err.id} err={err} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-2">Recent Jobs</div>
            {recentJobs.length === 0 ? (
              <div className="text-xs text-zinc-600 py-4 text-center">No jobs yet</div>
            ) : (
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/20 px-3">
                {recentJobs.map(job => (
                  <RecentJobRow key={job.id} job={job} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-600 flex-shrink-0">
        <span>Auto-refresh: 10s</span>
        <span>Updated {dashboard.generated_at ? timeAgo(dashboard.generated_at) : '-'}</span>
      </div>
    </div>
  );
}
