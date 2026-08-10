/**
 * Labs Widget - placeholder (MindWorkflow moved to laboratory branch)
 * @see ADR-043: Laboratories Feature
 */
import React from 'react';

interface LabsWidgetProps {
  widgetId: string;
  spaceId?: number;
  config?: {
    title?: string;
    projectId?: string;
  };
}

const LabsWidget: React.FC<LabsWidgetProps> = () => {
  return (
    <div className="h-full w-full bg-slate-900 overflow-hidden flex items-center justify-center">
      <div className="text-slate-400 text-center">
        <p className="text-lg font-medium">Labs — MindWorkflow</p>
        <p className="text-sm mt-2">Frozen. See branch: laboratory</p>
      </div>
    </div>
  );
};

export default LabsWidget;
