import { useState } from 'react';
import type { DocumentItem } from '../../../../types/documents.types';

export function useAtomsState() {
  const [atomModalItem, setAtomModalItem] = useState<DocumentItem | null>(null);
  const [atomKey, setAtomKey] = useState('');
  const [atomTitle, setAtomTitle] = useState('');
  const [showAtomModal, setShowAtomModal] = useState(false);
  const [selectedItemForAtom, setSelectedItemForAtom] = useState<DocumentItem | null>(null);
  const [atomSections, setAtomSections] = useState<Record<number, { enabled: boolean; key: string; title: string }>>({});

  const [showConvertToAtomModal, setShowConvertToAtomModal] = useState(false);
  const [convertToAtomItem, setConvertToAtomItem] = useState<DocumentItem | null>(null);

  const [showConvertToTicketModal, setShowConvertToTicketModal] = useState(false);
  const [convertToTicketItem, setConvertToTicketItem] = useState<DocumentItem | null>(null);

  const [atomsViewMode, setAtomsViewMode] = useState(false);
  const [atomsDisplayMode, setAtomsDisplayMode] = useState<'list' | 'cards'>('cards');

  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());

  return {
    atomModalItem,
    setAtomModalItem,
    atomKey,
    setAtomKey,
    atomTitle,
    setAtomTitle,
    showAtomModal,
    setShowAtomModal,
    selectedItemForAtom,
    setSelectedItemForAtom,
    atomSections,
    setAtomSections,
    showConvertToAtomModal,
    setShowConvertToAtomModal,
    convertToAtomItem,
    setConvertToAtomItem,
    showConvertToTicketModal,
    setShowConvertToTicketModal,
    convertToTicketItem,
    setConvertToTicketItem,
    atomsViewMode,
    setAtomsViewMode,
    atomsDisplayMode,
    setAtomsDisplayMode,
    expandedNodes,
    setExpandedNodes,
  };
}
