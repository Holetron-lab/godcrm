import { X, Save, ArrowLeft } from 'lucide-react';

interface WidgetEditorHeaderProps {
  title: string;
  icon: string;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}

export function WidgetEditorHeader({
  title,
  icon,
  onTitleChange,
  onIconChange,
  onSave,
  onCancel,
  isSaving,
}: WidgetEditorHeaderProps) {
  return (
    <div className="h-14 border-b bg-white flex items-center justify-between px-4">
      {/* Left: Back button + Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="p-2 hover:bg-gray-100 rounded transition"
          title="Back to dashboard"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          {/* Icon Picker */}
          <input
            type="text"
            value={icon}
            onChange={(e) => onIconChange(e.target.value)}
            className="w-12 text-center text-2xl border rounded px-1"
            maxLength={2}
            title="Widget icon (emoji)"
          />

          {/* Title Input */}
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="text-lg font-semibold border-none focus:outline-none focus:ring-2 focus:ring-primary-500 rounded px-2 py-1"
            placeholder="Widget Title"
          />
        </div>
      </div>

      {/* Right: Save/Cancel buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition"
          disabled={isSaving}
        >
          Cancel
        </button>
        
        <button
          onClick={onSave}
          disabled={isSaving}
          className="px-4 py-2 bg-primary-600 text-white hover:bg-primary-700 rounded transition flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {isSaving ? 'Saving...' : 'Save Widget'}
        </button>
      </div>
    </div>
  );
}
