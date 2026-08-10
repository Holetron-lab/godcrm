# Column Settings Components

Components for configuring various column types in UniversalTable.

## Created Components

### 1. SelectColumnSettings.tsx
**Purpose:** Settings for columns of type `select` and `multi-select`

**Functionality:**
- Option management (add, remove, edit)
- Nested options (sub-options)
- Formula for computing the value
- Automatic collection of unique values from table data
- Link to a table (if configured)
- Color configuration for options

**UI components used:** Input, Select, Button

---

### 2. CheckboxColumnSettings.tsx
**Purpose:** Settings for columns of type `checkbox`

**Functionality:**
- Display style selection (checkbox, toggle, emoji)
- Value configuration for TRUE/FALSE
- Preview of all styles

**UI components used:** Input, Select

---

### 3. UrlColumnSettings.tsx
**Purpose:** Settings for columns of type `url`

**Functionality:**
- Display style selection (link, button, minimal, badge)
- Color configuration for button/badge
- Multiple links
- URL prefix and suffix
- Custom link text
- Style preview

**UI components used:** Input, Select

---

### 4. VectorColumnSettings.tsx
**Purpose:** Settings for columns of type `vector`

**Functionality:**
- Formula for vectorization (with support for {{column_name}} variables)
- Prefix and suffix
- Result preview

**UI components used:** Input

---

### 5. ButtonColumnSettings.tsx
**Purpose:** Settings for columns of type `button`

**Functionality:**
- Button text
- Icon selection
- Button style (primary, secondary, ghost, danger)
- Action type (automation, URL, copy, custom)
- Settings for each action type

**UI components used:** Input, Select

---

### 6. RelationColumnSettings.tsx
**Purpose:** Settings for columns of type `relation`

**Functionality:**
- Column mapping (value, display, description, color)
- Storage format (JSON, ID, array of IDs)
- Display style (badge, inline, card)
- Placeholder for the case when no table is selected

**UI components used:** Select

---

### 7. DateColumnSettings.tsx
**Purpose:** Settings for columns of type `date` and `datetime`

**Functionality:**
- Storage format (ISO, EU, US, Unix)
- Display format (default, relative, full, short)
- For datetime: show seconds, time zone selection
- Information about automatic format detection

**UI components used:** Select, Switch

---

### 8. FileColumnSettings.tsx
**Purpose:** Settings for columns of type `file`

**Functionality:**
- Save format (full link, file name, path)
- Prefix and suffix
- Usage examples
- Format preview

**UI components used:** Input, Select

---

## Common Structure

All components follow a single structure:

```typescript
import React from 'react';
import { ColumnSettingsProps } from './types';

export const ComponentName: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns,
  rows,
  tableId,
  projectId,
}) => {
  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        [Emoji] Settings [Type]
      </h4>
      
      {/* Settings */}
    </div>
  );
};
```

## Using setDraft

All components use an updater function to update state:

```typescript
setDraft(prev => ({
  ...prev,
  config: {
    ...prev.config,
    [configKey]: { ...prev.config?.[configKey], [property]: value }
  }
}))
```

This ensures immutability and correct interaction with React state.

## Integration

Import the components from the index file:

```typescript
import {
  SelectColumnSettings,
  CheckboxColumnSettings,
  UrlColumnSettings,
  VectorColumnSettings,
  ButtonColumnSettings,
  RelationColumnSettings,
  DateColumnSettings,
  FileColumnSettings,
} from './column-settings';
```

Use them depending on the column type:

```typescript
{draft.type === 'select' && (
  <SelectColumnSettings
    draft={draft}
    setDraft={setDraft}
    allColumns={allColumns}
    rows={rows}
    tableId={tableId}
    projectId={projectId}
  />
)}
```

## Notes

- TableColumnSettings is not included in this set (it will be created separately)
- The components use the existing design system (CSS variables)
- All components are responsive and support dark theme
- Simplified versions of the original settings from ColumnSettingsDrawer
