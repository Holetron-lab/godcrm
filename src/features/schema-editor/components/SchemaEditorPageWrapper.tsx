import { ReactFlowProvider } from '@xyflow/react';
import { SchemaEditorPage as SchemaEditorPageInner } from './SchemaEditorPage';

/**
 * Wrapper component that provides ReactFlow context
 */
export const SchemaEditorPageWithProvider = () => {
  return (
    <ReactFlowProvider>
      <SchemaEditorPageInner />
    </ReactFlowProvider>
  );
};
