/** usePanelContent — ADR-119 modular panel renderers. */
import React from 'react';
import type { PanelContentDeps } from './PanelContentTypes';
import { ContactsPanelContent } from './ContactsPanelContent';
import { AgentsPanelContent } from './AgentsPanelContent';
import { InboxPanelContent } from './InboxPanelContent';
import { TasksPanelContent } from './TasksPanelContent';
import { SettingsPanelContent } from './SettingsPanelContent';

export type { PanelContentDeps } from './PanelContentTypes';

export function renderPanelContentFromDeps(deps: PanelContentDeps): React.ReactNode {
  switch (deps.activePanel) {
    case 'contacts': return <ContactsPanelContent {...deps} />;
    case 'ai-agents': return <AgentsPanelContent {...deps} />;
    case 'inbox': return <InboxPanelContent {...deps} />;
    case 'tasks': return <TasksPanelContent {...deps} />;
    case 'settings': return <SettingsPanelContent {...deps} />;
    default: return null;
  }
}
