import { useLanguage } from '@/shared/i18n/LanguageContext';
// ADR-0031 P6 — Frontend modal for spawning a ticket from a chat conversation.
// Backend: POST /api/v3/chat/conversations/:id/spawn-ticket
// Body: { ticket_data: { what, assigned_to, priority? }, message_ids? }
// Default behaviour (no message_ids) = move every eligible message to the new
// ticket chat, leaving stubs in the source.

import React, { useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { ParticipantSelector, type Participant } from '../../ParticipantSelector';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';
import { logger } from '@/shared/utils/logger';

export interface SpawnTicketResult {
  ticket_id: number;
  ticket_conversation_id: number;
  source_conversation_id: number;
  moved_count: number;
  source_message_ids: number[];
  target_message_ids: number[];
  spawned_from?: { table_id: number | null; row_id: number | null; conversation_id: number };
}

interface SpawnTicketModalProps {
  open: boolean;
  conversationId: number | null | undefined;
  onClose: () => void;
  onSuccess?: (result: SpawnTicketResult) => void;
}

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: "aiChat.ui.noPriority" },
  { value: 'low', label: "aiChat.ui.low" },
  { value: 'medium', label: "aiChat.ui.medium" },
  { value: 'high', label: "aiChat.ui.high" },
  { value: 'critical', label: "aiChat.ui.critical" },
];

export const SpawnTicketModal: React.FC<SpawnTicketModalProps> = ({
  open,
  conversationId,
  onClose,
  onSuccess,
}) => {
  const { t } = useLanguage();
  const [what, setWhat] = useState('');
  const [assignee, setAssignee] = useState<Participant | null>(null);
  const [priority, setPriority] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setWhat('');
    setAssignee(null);
    setPriority('');
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!conversationId) {
      showToast(t('aiChat.ui.couldNotIdentifyTheSourceChat'), 'error');
      return;
    }
    const trimmed = what.trim();
    if (!trimmed) {
      showToast(t('aiChat.ui.fillInTheTaskDescription'), 'error');
      return;
    }
    if (!assignee) {
      showToast(t('aiChat.ui.chooseAnAssignee'), 'error');
      return;
    }

    setSubmitting(true);
    try {
      const ticket_data: Record<string, unknown> = {
        what: trimmed,
        assigned_to: assignee.id,
      };
      if (priority) ticket_data.priority = priority;

      const resp = await apiClient.post<{ success: boolean; data: SpawnTicketResult }>(
        `/chat/conversations/${conversationId}/spawn-ticket`,
        { ticket_data },
      );

      if (resp?.success && resp.data) {
        showToast(
          t('aiChat.ui.ticketCreatedMessagesMoved', { id: resp.data.ticket_id, count: resp.data.moved_count }),
          'success',
        );
        onSuccess?.(resp.data);
        reset();
        onClose();
      } else {
        showToast(t('aiChat.ui.couldNotCreateTicket'), 'error');
      }
    } catch (err: any) {
      logger.error('SpawnTicketModal: spawn failed', err);
      const msg = typeof err?.message === 'string' ? err.message : t('aiChat.ui.errorCreatingTicket');
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !submitting && !!conversationId && !!what.trim() && !!assignee;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) handleClose(); }}
      title={t('aiChat.ui.createTicketFromChat')}
      description={t('aiChat.ui.allMessagesInThisChatWillBeMovedToTheNewTicketLinksWillRemainInTheOriginalChat')}
      size="md"
      primaryAction={{
        label: submitting ? t('auth.register.submitting') : t('aiChat.ui.createTicket'),
        onClick: handleSubmit,
        disabled: !canSubmit,
      }}
      secondaryAction={{
        label: t('aiChat.ui.cancel'),
        onClick: handleClose,
        disabled: submitting,
      }}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('aiChat.ui.whatNeedsToBeDone')}<span className="text-red-400">*</span>
          </label>
          <textarea
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={t('aiChat.ui.brieflyDescribeTheTask')}
            rows={3}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] resize-none disabled:opacity-60"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('aiChat.ui.assignee')}<span className="text-red-400">*</span>
          </label>
          <ParticipantSelector
            value={assignee}
            onSelect={setAssignee}
            showUsers
            showAgents
            placeholder={t('aiChat.ui.selectAUserOrAgent')}
            showStatus={false}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('aiChat.ui.priority')}</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] disabled:opacity-60"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p.value || 'none'} value={p.value}>{t(p.label)}</option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
};

export default SpawnTicketModal;
