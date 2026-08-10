/**
 * useProjectSelection - 4-state selection for projects/folders in nav tree
 * States cycle: none -> self -> all -> children-only -> none
 */

import { useCallback, useState } from 'react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { ParentSelectionState } from './navTreeTypes';

export const useProjectSelection = () => {
  const {
    selectedTables,
    toggleTableSelection,
    selectAllTablesInProject,
    clearTableSelection,
  } = useSchemaEditorStore();

  const [selectedProjects, setSelectedProjects] = useState<Map<number, ParentSelectionState>>(new Map());

  const handleToggleSelect = useCallback((tableId: number) => {
    toggleTableSelection(tableId);
  }, [toggleTableSelection]);

  // Smart 4-state toggle for projects/folders
  const handleToggleProjectSelect = useCallback((projectId: number, childTableIds: number[]) => {
    setSelectedProjects(prev => {
      const next = new Map(prev);
      const currentState = prev.get(projectId) || 'none';

      // State machine: none -> self -> all -> children-only -> none
      let newState: ParentSelectionState;
      switch (currentState) {
        case 'none':
          newState = 'self';
          break;
        case 'self':
          newState = 'all';
          // Add all children to selectedTables via store
          selectAllTablesInProject(childTableIds);
          break;
        case 'all':
          newState = 'children-only';
          break;
        case 'children-only':
          newState = 'none';
          // Remove all children from selectedTables - toggle each
          childTableIds.forEach(id => {
            if (selectedTables.has(id)) {
              toggleTableSelection(id);
            }
          });
          break;
        default:
          newState = 'none';
      }

      if (newState === 'none') {
        next.delete(projectId);
      } else {
        next.set(projectId, newState);
      }
      return next;
    });
  }, [selectAllTablesInProject, selectedTables, toggleTableSelection]);

  const handleClearSelection = useCallback(() => {
    clearTableSelection();
    setSelectedProjects(new Map());
  }, [clearTableSelection]);

  return {
    selectedTables,
    selectedProjects,
    handleToggleSelect,
    handleToggleProjectSelect,
    handleClearSelection,
  };
};
