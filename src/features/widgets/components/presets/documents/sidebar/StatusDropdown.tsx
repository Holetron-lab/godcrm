import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { useDocumentsContext } from '../DocumentsContext';
import {
  getStatusChipClass,
  getStatusDotClass,
  type DocumentRegistryItem,
  type StatusOption,
} from '../../../../types/documents.types';

interface StatusDropdownProps {
  doc: DocumentRegistryItem;
  registryTableId: number | null;
  onUpdate: () => void;
  /** 'sm' = tiny sidebar chip (default). 'md' = readable meta-row chip that inherits parent font-size. */
  size?: 'sm' | 'md';
}

export function StatusDropdown({ doc, registryTableId, onUpdate, size = 'sm' }: StatusDropdownProps) {
  const ctx = useDocumentsContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const buttonRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4,
        left: rect.left,
      });
    }
    setIsOpen(true);
  };

  const handleStatusChange = async (option: StatusOption) => {
    if (!registryTableId || option.id === doc.status_id) {
      setIsOpen(false);
      return;
    }

    setIsUpdating(true);
    try {
      await tablesApi.updateRow(String(registryTableId), String(doc.id), {
        status_id: option.id,
        status: option.slug,
      });
      onUpdate();
    } catch (error) {
      // ADR-0011: when the registry has a verification-gated column on
      // status_id, backend answers 409 VERIFICATION_REQUIRED / 403
      // VERIFICATION_IMMUTABLE. tablesApi.updateRow attaches { code, details }
      // to the thrown Error — surface the global VerificationGateModal so the
      // user can enter their TOTP and re-attempt.
      const err = error as Error & { code?: string; details?: Record<string, unknown> };
      if (
        (err?.code === 'VERIFICATION_REQUIRED' || err?.code === 'VERIFICATION_IMMUTABLE') &&
        err.details &&
        typeof err.details === 'object'
      ) {
        const d = err.details as {
          verification_column_id?: number;
          verification_column_name?: string;
          offending_column?: string;
          offending_value?: string;
        };
        if (d.verification_column_id && d.verification_column_name) {
          useTablesStore.getState().openVerificationGate({
            tableId: String(registryTableId),
            rowId: String(doc.id),
            verificationColumnId: d.verification_column_id,
            verificationColumnName: d.verification_column_name,
            offendingColumn: d.offending_column ?? 'status_id',
            offendingValue: d.offending_value ?? String(option.id),
            offendingPrevValue: doc.status_id ?? null,
            reason: err.code === 'VERIFICATION_IMMUTABLE' ? 'immutable' : 'required',
            message: err.message || 'Verification required',
          });
          setIsOpen(false);
          return;
        }
      }
      logger.error('Failed to update status:', error);
    } finally {
      setIsUpdating(false);
      setIsOpen(false);
    }
  };

  const current = ctx.resolveStatus(doc);
  const chip = getStatusChipClass(current ?? doc.status);
  const chipLabel = current?.label ?? doc.status ?? 'draft';

  const sizeClass = size === 'md'
    ? 'px-2.5 py-0.5 font-medium'          // inherits parent font-size
    : 'px-1.5 py-0.5 text-[9px] font-medium';

  // ADR-105: read-only mode renders a static badge, not a dropdown
  if (ctx.isReadOnly) {
    return (
      <span className={cn('rounded shrink-0', sizeClass, chip.className)} style={chip.style}>
        {current?.icon && <span className="mr-1">{current.icon}</span>}
        {chipLabel}
      </span>
    );
  }

  return (
    <>
      <span
        ref={buttonRef}
        onClick={handleOpen}
        className={cn(
          'rounded shrink-0 cursor-pointer hover:ring-1 hover:ring-blue-500/50 transition-all',
          sizeClass,
          chip.className,
          isUpdating && 'opacity-50'
        )}
        style={chip.style}
      >
        {isUpdating ? '...' : (
          <>
            {current?.icon && <span className="mr-1">{current.icon}</span>}
            {chipLabel}
          </>
        )}
      </span>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg py-1 min-w-[120px]"
          style={{ top: menuPosition.top, left: menuPosition.left }}
          // The menu is portaled to <body>, but React synthetic events still
          // bubble through the component tree to the parent row's onClick
          // (which selects/opens the doc). Stop it here so changing status in
          // the sidebar doesn't also navigate into the document.
          onClick={(e) => e.stopPropagation()}
        >
          {ctx.statusOptions.map(option => {
            const dot = getStatusDotClass(option);
            return (
              <button
                key={option.id}
                onClick={(e) => { e.stopPropagation(); handleStatusChange(option); }}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-tertiary)]',
                  option.id === current?.id && 'bg-[var(--bg-tertiary)]'
                )}
              >
                <span className={cn('w-2 h-2 rounded-full', dot.className)} style={dot.style} />
                {option.icon && <span>{option.icon}</span>}
                {option.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
