import type { NavOrganization } from './types';

// Local storage key for nav organization
export const getStorageKey = (projectId: number) => `nav-org-${projectId}`;

// Load organization from localStorage
export const loadOrganization = (projectId: number): NavOrganization | null => {
  try {
    const stored = localStorage.getItem(getStorageKey(projectId));
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

// Save organization to localStorage
export const saveOrganization = (projectId: number, org: NavOrganization) => {
  localStorage.setItem(getStorageKey(projectId), JSON.stringify(org));
};
