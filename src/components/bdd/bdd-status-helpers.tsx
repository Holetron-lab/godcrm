/**
 * BDD status/priority/filter helpers — shared between BddCompanionPanel and
 * TaskListWidget (bdd_mode). Keeps badge/icon/filter semantics in one place so
 * ADR-0003 state vocabulary stays consistent across all surfaces.
 */

import {
  CheckCircle2,
  Clock,
  Circle,
  AlertTriangle,
  XCircle,
  RotateCcw,
  ArrowUpCircle,
} from 'lucide-react';

export type BddStatus =
  | 'pending'
  | 'in_progress'
  | 'agent_claimed'
  | 'human_confirmed'
  | 'verified'
  | 'waived'
  | 'failed'
  | 'regressed'
  | 'escalated'
  | string;

export type BddPriority = 'must' | 'should' | 'could' | 'wont' | string;

export type BddFilter = 'all' | 'locked' | 'unlocked' | 'regressed';

export const BDD_FILTERS: BddFilter[] = ['all', 'locked', 'unlocked', 'regressed'];

export const BDD_FILTER_LABELS: Record<BddFilter, string> = {
  all: 'All',
  locked: 'Locked',
  unlocked: 'Unlocked',
  regressed: 'Regressed',
};

export function isVerified(status?: string | null): boolean {
  return status === 'verified' || status === 'human_confirmed';
}

export function isRegressed(status?: string | null): boolean {
  return status === 'regressed';
}

export function matchesBddFilter(status: string | null | undefined, filter: BddFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'locked':
      return isVerified(status);
    case 'regressed':
      return isRegressed(status);
    case 'unlocked':
      return !isVerified(status) && !isRegressed(status);
    default:
      return true;
  }
}

export function bddStatusIcon(status?: string | null) {
  if (isVerified(status)) {
    return <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" aria-label="verified" />;
  }
  if (isRegressed(status)) {
    return <RotateCcw className="w-4 h-4 text-red-600 dark:text-red-400" aria-label="regressed" />;
  }
  switch (status) {
    case 'agent_claimed':
      return <Clock className="w-4 h-4 text-amber-500 dark:text-amber-400" aria-label="agent claimed" />;
    case 'waived':
      return <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" aria-label="waived" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" aria-label="failed" />;
    case 'in_progress':
      return <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400" aria-label="in progress" />;
    case 'escalated':
      return <ArrowUpCircle className="w-4 h-4 text-orange-500 dark:text-orange-400" aria-label="escalated" />;
    case 'pending':
    default:
      return <Circle className="w-4 h-4 text-gray-400 dark:text-gray-500" aria-label="pending" />;
  }
}

export function bddStateBadge(status?: string | null): { label: string; cls: string } {
  if (isVerified(status)) return { label: 'verified', cls: 'bg-green-500/20 text-green-700 dark:text-green-300' };
  if (isRegressed(status)) return { label: 'regressed', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' };
  switch (status) {
    case 'agent_claimed':
      return { label: 'claimed', cls: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' };
    case 'failed':
      return { label: 'failed', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' };
    case 'waived':
      return { label: 'waived', cls: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-300' };
    case 'in_progress':
      return { label: 'in progress', cls: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' };
    case 'escalated':
      return { label: 'escalated', cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-300' };
    case 'pending':
    default:
      return { label: 'pending', cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' };
  }
}

export function bddPriorityBadge(priority?: string | null): { label: string; cls: string } | null {
  if (!priority) return null;
  const key = String(priority).toLowerCase();
  switch (key) {
    case 'must':
      return { label: 'must', cls: 'bg-red-500/20 text-red-700 dark:text-red-300' };
    case 'should':
      return { label: 'should', cls: 'bg-orange-500/20 text-orange-700 dark:text-orange-300' };
    case 'could':
      return { label: 'could', cls: 'bg-blue-500/20 text-blue-700 dark:text-blue-300' };
    case 'wont':
    case "won't":
      return { label: "won't", cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' };
    default:
      return { label: key, cls: 'bg-gray-500/20 text-gray-600 dark:text-gray-400' };
  }
}
