import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { tablesApi } from '../api/tablesApi';
import { useTablesStore } from '../store/tablesStore';
import {
  guardMutation,
  useIsPublicReadOnly,
} from '@/features/public/PublicViewContext';

interface RowUpdateVariables {
  rowId: string;
  columnId: string;
  value: unknown;
  data: Record<string, unknown>;
}

// Pending updates waiting to be sent - simple structure
interface PendingUpdate {
  value: unknown;
  prevValue: unknown; // original store value captured before ANY optimistic edit in the debounce window
  timer: ReturnType<typeof setTimeout>;
}

// Store pending updates by key (tableId-rowId-columnId)
const pendingUpdates = new Map<string, PendingUpdate>();

// Get pending value for a cell
export const getPendingValue = (tableId: string, rowId: string, columnId: string): unknown | undefined => {
  const key = `${tableId}-${rowId}-${columnId}`;
  return pendingUpdates.get(key)?.value;
};

// Debounce delay - 1 second
const DEBOUNCE_MS = 1000;

export const useRowMutations = (tableId: string | null) => {
  const readOnly = useIsPublicReadOnly();
  const updateCell = useTablesStore((state) => state.updateCell);
  const flashCellSuccess = useTablesStore((state) => state.flashCellSuccess);
  const setError = useTablesStore((state) => state.setError);
  const openVerificationGate = useTablesStore((state) => state.openVerificationGate);
  const queryClient = useQueryClient();

  // Send the actual API request
  const sendUpdate = useCallback(async (tId: string, rowId: string, columnId: string, value: unknown, prevValue: unknown) => {
    try {
      await tablesApi.updateRow(tId, rowId, { [columnId]: value });
      flashCellSuccess(rowId, columnId);
      // Invalidate after successful API call
      queryClient.invalidateQueries({ queryKey: ['inline-nested-table-rows'] });
    } catch (error) {
      const err = error as Error & { code?: string; details?: Record<string, unknown> };
      // ADR-0011: intercept 409 VERIFICATION_REQUIRED / 403 VERIFICATION_IMMUTABLE
      // and surface the VerificationGateModal instead of a plain error toast.
      if (
        (err?.code === 'VERIFICATION_REQUIRED' || err?.code === 'VERIFICATION_IMMUTABLE') &&
        err?.details &&
        typeof err.details === 'object'
      ) {
        const d = err.details as {
          verification_column_id?: number;
          verification_column_name?: string;
          offending_column?: string;
          offending_value?: string;
        };
        if (d.verification_column_id && d.verification_column_name) {
          // Revert optimistic zustand update BEFORE opening the modal, so the user
          // sees the original value restored while they read the gate prompt.
          updateCell(tId, rowId, columnId, prevValue);
          openVerificationGate({
            tableId: tId,
            rowId,
            verificationColumnId: d.verification_column_id,
            verificationColumnName: d.verification_column_name,
            offendingColumn: d.offending_column ?? null,
            offendingValue: d.offending_value ?? null,
            // Snapshot the pre-edit value so the modal can persist a
            // { from, to } transition on the audit log entry.
            offendingPrevValue: prevValue,
            reason: err.code === 'VERIFICATION_IMMUTABLE' ? 'immutable' : 'required',
            message: err.message || 'Verification required',
          });
          return;
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to update row';
      setError(message);
    }
  }, [flashCellSuccess, setError, openVerificationGate, queryClient, updateCell]);

  // Schedule or update a pending API call
  const scheduleUpdate = useCallback((tId: string, rowId: string, columnId: string, value: unknown, prevValue: unknown) => {
    const key = `${tId}-${rowId}-${columnId}`;

    // Cancel existing timer for this cell, but preserve the ORIGINAL prevValue —
    // multiple keystrokes within the debounce window must still rollback to the
    // pre-edit state, not to an intermediate optimistic value.
    const existing = pendingUpdates.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const preservedPrev = existing ? existing.prevValue : prevValue;

    // Schedule new update after 1 second of inactivity
    const timer = setTimeout(() => {
      const pending = pendingUpdates.get(key);
      if (pending) {
        pendingUpdates.delete(key);
        sendUpdate(tId, rowId, columnId, pending.value, pending.prevValue);
      }
    }, DEBOUNCE_MS);

    // Store the pending update with latest value + preserved original
    pendingUpdates.set(key, { value, prevValue: preservedPrev, timer });
  }, [sendUpdate]);

  const mutation = useMutation({
    mutationFn: async (variables: RowUpdateVariables) => variables,
    onMutate: async (variables) => {
      if (!tableId) return;

      // Capture the current store value BEFORE we apply the optimistic update,
      // so that on 409 we can revert cleanly. Read directly via getState() to
      // avoid creating a store subscription / extra re-renders.
      const state = useTablesStore.getState();
      const row = state.rows[tableId]?.find((r) => String(r.id) === String(variables.rowId));
      const prevValue = row?.data?.[variables.columnId];

      // Update zustand store immediately
      updateCell(tableId, variables.rowId, variables.columnId, variables.value);

      // Schedule debounced API call
      scheduleUpdate(tableId, variables.rowId, variables.columnId, variables.value, prevValue);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to update row';
      setError(message);
    }
  });

  return guardMutation(mutation, readOnly, 'useRowMutations');
};
