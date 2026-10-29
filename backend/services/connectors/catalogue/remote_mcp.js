// Branded choices share the same transport; neither bypasses remote authorization.
export const remoteMcpTypes = [
  ['custom_mcp', 'Remote MCP', '🔌'],
  ['custom_blender_mcp', 'Blender MCP (HTTPS)', '🧊'],
  ['custom_godcrm_mcp', 'GodCRM MCP (HTTPS)', '🌐'],
].map(([slug, display_name, icon]) => ({
  slug, display_name, icon, auth_kind: 'mcp', scopes_default: [], scopes_choices: [],
  refresh_supported: false,
  fields: [
    { key: 'url', label: 'MCP HTTPS URL', type: 'text', required: true },
    { key: 'bearer_token', label: 'Bearer token', type: 'password', required: false },
  ],
}));
export const isRemoteMcp = (slug) => remoteMcpTypes.some((type) => type.slug === slug);
