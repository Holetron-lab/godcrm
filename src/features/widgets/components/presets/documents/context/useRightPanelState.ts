import { useState } from 'react';
import type { RightPanelMode, AtomsPanelTab } from './types';

export function useRightPanelState() {
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>('settings');
  const [atomsPanelSearchQuery, setAtomsPanelSearchQuery] = useState('');
  const [atomsPanelTab, setAtomsPanelTab] = useState<AtomsPanelTab>('all-atoms');

  return {
    selectedItemId,
    setSelectedItemId,
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelMode,
    setRightPanelMode,
    atomsPanelSearchQuery,
    setAtomsPanelSearchQuery,
    atomsPanelTab,
    setAtomsPanelTab,
  };
}
