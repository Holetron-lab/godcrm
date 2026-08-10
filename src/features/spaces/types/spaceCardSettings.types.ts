// Space Card Settings Types

export type SpaceCardSize = 'full' | 'threeQuarter' | 'half' | 'quarter';
export type SpaceCardHeight = 'single' | 'double';

export interface SpaceCardSettings {
  size: SpaceCardSize;
  height?: SpaceCardHeight;
  showProjects: boolean;
  showDashboards: boolean;
  showUsers: boolean;
  showDescription: boolean;
  order: number;
}

export interface SpaceLayoutConfig {
  [spaceId: number]: SpaceCardSettings;
}

export const defaultSpaceCardSettings: SpaceCardSettings = {
  size: 'quarter',
  showProjects: true,
  showDashboards: true,
  showUsers: false,
  showDescription: true,
  order: 0
};
