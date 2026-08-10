/**
 * useCall — thin selector hooks over the call store.
 * ADR-0059 §4.3.
 */

import { useCallStore } from './callStore';

export function useCall() {
  return useCallStore();
}

export function useCallState() {
  return useCallStore((s) => s.state);
}

export function useCallActive() {
  return useCallStore((s) => s.state !== 'idle');
}

export function useCallConversationId() {
  return useCallStore((s) => s.conversationId);
}
