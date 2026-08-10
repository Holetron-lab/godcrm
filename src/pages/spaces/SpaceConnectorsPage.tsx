/**
 * ADR-0028 Phase 3 — Space Connectors page (OAuth callback landing).
 *
 * Primary UI now lives in EditSpaceModal → "Connectors" tab. This route
 * (/spaces/:spaceId/settings/connectors) is preserved as the OAuth callback
 * target; the tab body handles ?connected=:id flash + URL cleanup.
 */
import { useParams } from 'react-router-dom';
import { Plug } from 'lucide-react';
import { SpaceConnectorsTab } from '@/features/connectors/components/SpaceConnectorsTab';

export function SpaceConnectorsPage() {
  const { spaceId: spaceIdParam } = useParams<{ spaceId: string }>();
  const spaceId = spaceIdParam ? Number(spaceIdParam) : NaN;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
          <Plug className="w-7 h-7 text-primary-500" />
          Connectors
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          OAuth and API keys shared by MCP tools, agents, and automations in this space.
        </p>
      </div>
      <SpaceConnectorsTab spaceId={spaceId} />
    </div>
  );
}

export default SpaceConnectorsPage;
