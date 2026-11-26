import type { CatalogModule } from '../types';

const base = { publisher_space_id: null, status: 'published', category: 'general', checksum: 'a'.repeat(64) } as const;

/** A member's view of the registry: one module they may install, one that needs an administrator. */
export const kanban: CatalogModule = {
  ...base, id: 1, key: 'preset_kanban_board', origin: 'default', version: '2.0.0',
  blueprint: { key: 'preset_kanban_board', version: '2.0.0', title: 'Kanban', icon: '📋', description: 'Cards in columns by status' },
  components: ['table', 'app'], can_install: true, required_role: 'member', rating: 4.6, installs: 120,
};
export const agents: CatalogModule = {
  ...base, id: 2, key: 'ai_agents', origin: 'default', version: '2.1.0',
  blueprint: { key: 'ai_agents', version: '2.1.0', title: 'AI Agents', description: 'A team of agents', agents: [{ key: 'helper' }] },
  components: ['table', 'app', 'agent'], can_install: false, required_role: 'admin',
};
export const internal: CatalogModule = {
  ...base, id: 3, key: 'sla_rules', origin: 'internal', version: '1.0.0', publisher_space_id: 11, category: 'support',
  blueprint: { key: 'sla_rules', version: '1.0.0', title: 'SLA rules' },
  components: ['table'], can_install: true, required_role: 'member', rating: 5, installs: 3,
};
export const external: CatalogModule = {
  ...base, id: 4, key: 'mail_bridge', origin: 'external', version: '1.2.0', status: 'audited',
  blueprint: { key: 'mail_bridge', version: '1.2.0', title: 'Mail bridge' },
  components: ['service'], can_install: false, required_role: 'admin', rating: 4.1, installs: 57,
};
export const modules = [kanban, agents, internal, external];
