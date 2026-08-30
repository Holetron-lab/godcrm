import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mailApi, type MailLabelInput } from '../api/mailApi';
import type { MailLabel } from '../types';

/**
 * ADR-173 §P4.B — mail label read/write hooks. Labels are space-scoped (not
 * per-connector: a rule/label belongs to the space, applies across every
 * connected mailbox), so the label queries key on `spaceId` alone.
 *
 * The label-filtered message list keys under the shared `['mail','messages',
 * spaceId, …]` umbrella so every existing `invalidateQueries({queryKey:['mail',
 * 'messages', spaceId]})` (sync, PATCH, tag/untag) refreshes it for free.
 */

const keys = {
  labels: (spaceId: number | undefined) => ['mail', 'labels', spaceId] as const,
};

/** Space labels for the rail + toolbar + manager (each carries `messageCount`). */
export function useMailLabels(spaceId: number | undefined) {
  return useQuery<MailLabel[]>({
    queryKey: keys.labels(spaceId),
    queryFn: () => mailApi.labels.list(spaceId!),
    enabled: Number.isFinite(spaceId),
    staleTime: 30_000,
  });
}

/** Invalidate the label list + every message list (chips/counts shift on write). */
function invalidateLabelsAndMessages(
  qc: ReturnType<typeof useQueryClient>,
  spaceId: number | undefined
) {
  qc.invalidateQueries({ queryKey: keys.labels(spaceId) });
  qc.invalidateQueries({ queryKey: ['mail', 'messages', spaceId] });
  qc.invalidateQueries({ queryKey: ['mail', 'message', spaceId] });
}

/** Create a label (optionally with an auto-tag rule). */
export function useCreateLabel(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MailLabelInput) => mailApi.labels.create(spaceId!, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.labels(spaceId) }),
  });
}

/** Patch a label (rename, recolor, toggle toolbar/enabled, edit rules). */
export function useUpdateLabel(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<MailLabelInput> }) =>
      mailApi.labels.update(spaceId!, id, patch),
    // Rules/name/color changes don't retroactively re-tag (that's `apply`), so the
    // message lists don't need invalidating here — just the label list.
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.labels(spaceId) }),
  });
}

/** Delete a label — cascade drops its join rows, so message chips shift too. */
export function useDeleteLabel(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => mailApi.labels.remove(spaceId!, id),
    onSuccess: () => invalidateLabelsAndMessages(qc, spaceId),
  });
}

/** Backfill a rule over existing messages ("Применить к существующим"). */
export function useApplyLabel(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => mailApi.labels.apply(spaceId!, id),
    onSuccess: () => invalidateLabelsAndMessages(qc, spaceId),
  });
}

/** Manual tag / untag a single message (toolbar quick-tag, chip remove). */
export function useTagMessage(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ msgId, labelId }: { msgId: string; labelId: number }) =>
      mailApi.labels.tag(spaceId!, msgId, labelId),
    onSuccess: () => invalidateLabelsAndMessages(qc, spaceId),
  });
}

export function useUntagMessage(spaceId: number | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ msgId, labelId }: { msgId: string; labelId: number }) =>
      mailApi.labels.untag(spaceId!, msgId, labelId),
    onSuccess: () => invalidateLabelsAndMessages(qc, spaceId),
  });
}
