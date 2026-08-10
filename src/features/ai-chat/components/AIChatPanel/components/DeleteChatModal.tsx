/**
 * DeleteChatModal — styled confirmation for chat deletion.
 * ADR-0059 §4.2: replaces native window.confirm.
 */

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

export interface DeleteChatModalProps {
  open: boolean;
  chatTitle?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function DeleteChatModal({ open, chatTitle, onCancel, onConfirm }: DeleteChatModalProps) {
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[70] w-[95vw] max-w-[420px] -translate-x-1/2 -translate-y-1/2',
            'rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl focus:outline-none',
            'p-6 flex flex-col items-center text-center gap-4'
          )}
          aria-describedby="delete-chat-modal-body"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
            <Trash2 className="h-6 w-6 text-red-400" aria-hidden="true" />
          </div>

          <Dialog.Title className="text-lg font-semibold text-[var(--text-primary)]">
            Удалить чат?
          </Dialog.Title>

          <Dialog.Description
            id="delete-chat-modal-body"
            className="text-sm text-[var(--text-secondary)] leading-relaxed"
          >
            {chatTitle ? (
              <>
                Чат <em className="not-italic font-medium text-[var(--text-primary)]">«{chatTitle}»</em>{' '}
                и все сообщения будут удалены без возможности восстановления.
              </>
            ) : (
              <>Этот чат и все сообщения будут удалены без возможности восстановления.</>
            )}
          </Dialog.Description>

          <div className="mt-2 flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={pending}
              className="sm:flex-1"
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirm}
              disabled={pending}
              className="sm:flex-1"
            >
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Удаляю…
                </span>
              ) : (
                'Удалить навсегда'
              )}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
