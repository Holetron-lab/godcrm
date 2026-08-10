/**
 * PanelRouter Component
 * ADR-097 Phase 5: Centralizes panel switching logic from AIChatPanel.tsx
 *
 * Replaces the inline `renderPanelContent()` switch block (lines 3326–3335)
 * and the 6 `renderXxxPanel()` functions that were inline in the monolith.
 *
 * Accepts the active panel tab and renders the corresponding panel component.
 * Each panel component has been previously extracted into its own file
 * (ContactsPanel, AgentsPanel, HistoryPanel, InboxPanel, TicketsPanel, SettingsPanel).
 *
 * For panels that are still rendered inline in AIChatPanel.tsx (like the inline
 * renderTasksPanel/renderInboxPanel), this router accepts pre-rendered ReactNode
 * via the `overrides` prop, allowing incremental migration.
 */

import React from 'react';
import type { PanelTab } from '../../types';

// ─── Panel component imports ─────────────────────────────────────────
import { ContactsPanel } from './ContactsPanel';
import type { ComponentProps } from 'react';
import { AgentsPanel } from './AgentsPanel';
// HistoryPanel removed — Ticket #81448: replaced by enhanced Inbox
import { InboxPanel } from './InboxPanel';
import { TicketsPanel } from './TicketsPanel';
import { SettingsPanel } from './SettingsPanel';

// ─── Prop types derived from each panel ──────────────────────────────

type ContactsPanelProps = ComponentProps<typeof ContactsPanel>;
type AgentsPanelProps = ComponentProps<typeof AgentsPanel>;
// HistoryPanelProps removed — Ticket #81448
type InboxPanelProps = ComponentProps<typeof InboxPanel>;
type TicketsPanelProps = ComponentProps<typeof TicketsPanel>;
type SettingsPanelProps = ComponentProps<typeof SettingsPanel>;

/**
 * Props for PanelRouter.
 *
 * `activePanel` drives which panel is rendered. Panel-specific props
 * are grouped under their respective keys. Only the props for the
 * active panel need to be fully populated — the rest can be undefined.
 *
 * The `overrides` map allows parent components to inject pre-rendered
 * content for panels that have not yet been fully extracted into
 * standalone components. This facilitates incremental migration.
 */
interface PanelRouterProps {
  /** Currently active panel tab */
  activePanel: PanelTab;

  /**
   * Optional pre-rendered content per panel.
   * If an override exists for the active panel, it takes priority over
   * the component-based rendering. This allows AIChatPanel to continue
   * using its inline render functions during the transition period.
   */
  overrides?: Partial<Record<PanelTab, React.ReactNode>>;

  /** Props forwarded to ContactsPanel when activePanel === 'contacts' */
  contactsProps?: ContactsPanelProps;
  /** Props forwarded to AgentsPanel when activePanel === 'ai-agents' */
  agentsProps?: AgentsPanelProps;
  // historyProps removed — Ticket #81448
  /** Props forwarded to InboxPanel when activePanel === 'inbox' */
  inboxProps?: InboxPanelProps;
  /** Props forwarded to TicketsPanel when activePanel === 'tasks' */
  ticketsProps?: TicketsPanelProps;
  /** Props forwarded to SettingsPanel when activePanel === 'settings' */
  settingsProps?: SettingsPanelProps;
}

/**
 * PanelRouter renders the correct side panel based on `activePanel`.
 *
 * Rendering priority for each panel:
 *   1. If `overrides[activePanel]` exists, render that (escape hatch for migration).
 *   2. If the corresponding `xxxProps` object is provided, render the extracted component.
 *   3. Otherwise, render null (panel not configured).
 *
 * When `activePanel` is `'none'`, nothing is rendered.
 */
export const PanelRouter: React.FC<PanelRouterProps> = ({
  activePanel,
  overrides,
  contactsProps,
  agentsProps,
  inboxProps,
  ticketsProps,
  settingsProps,
}) => {
  // No panel active — render nothing
  if (activePanel === 'none') {
    return null;
  }

  // Check for override first (migration escape hatch)
  const override = overrides?.[activePanel];
  if (override !== undefined) {
    return <>{override}</>;
  }

  // Route to the correct panel component
  switch (activePanel) {
    case 'contacts':
      if (!contactsProps) return null;
      return <ContactsPanel {...contactsProps} />;

    case 'ai-agents':
      if (!agentsProps) return null;
      return <AgentsPanel {...agentsProps} />;

    // case 'history' removed — Ticket #81448: replaced by enhanced Inbox

    case 'inbox':
      if (!inboxProps) return null;
      return <InboxPanel {...inboxProps} />;

    case 'tasks':
      if (!ticketsProps) return null;
      return <TicketsPanel {...ticketsProps} />;

    case 'settings':
      if (!settingsProps) return null;
      return <SettingsPanel {...settingsProps} />;

    default: {
      // Exhaustive check — TypeScript will warn if a PanelTab case is missing
      const _exhaustive: never = activePanel;
      return null;
    }
  }
};

// Display name for React DevTools
PanelRouter.displayName = 'PanelRouter';
