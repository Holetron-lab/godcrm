import { useState } from 'react';

export function usePanelEdit() {
  const [showAtomPicker, setShowAtomPicker] = useState(false);
  const [atomPickerTargetItemId, setAtomPickerTargetItemId] = useState<number | null>(null);

  const openPicker = (itemId: number) => {
    setAtomPickerTargetItemId(itemId);
    setShowAtomPicker(true);
  };

  const closePicker = () => {
    setShowAtomPicker(false);
    setAtomPickerTargetItemId(null);
  };

  return {
    showAtomPicker,
    atomPickerTargetItemId,
    openPicker,
    closePicker,
  };
}
