// ADR-207 §2.7 — the module catalog as `GET /module-registry` serves it
// (backend/routes/v3/module-registry.js, backend/services/ModuleRegistryService.js).
import type { ModuleBlueprint } from '@/features/module-install';

export const MODULE_ORIGINS = ['default', 'internal', 'external'] as const;
export type ModuleOrigin = (typeof MODULE_ORIGINS)[number];

export const MODULE_COMPONENTS = ['table', 'app', 'tile', 'agent', 'automation', 'service'] as const;
export type ModuleComponent = (typeof MODULE_COMPONENTS)[number];

/** A screenshot or a video of the module page gallery; the author uploads them with the module. */
export interface ModuleMedia {
  type: 'image' | 'video';
  url: string;
  title?: string;
  /** Poster of a video, or a smaller copy of an image for the thumbnail strip. */
  thumbnail_url?: string;
  /** WebVTT captions of a video. */
  captions_url?: string;
}

/** One market review. Reviews exist for `default` and `external` modules only (§2.7). */
export interface ModuleReview {
  id: number;
  author: string;
  /** 1–5 */
  rating: number;
  text?: string;
  created_at: string;
}

/** Catalog metadata an author adds to the blueprint next to the sections the installer reads. */
export interface CatalogBlueprint extends ModuleBlueprint {
  icon?: string;
  /** One or two sentences for the card and the module page header. */
  description?: string;
  /** The long story of the module page, Markdown. */
  readme?: string;
  author?: string;
  media?: ModuleMedia[];
}

/** The texts and the gallery of the module page the owner edits in place (`PATCH /module-registry/:key`); `media` replaces the whole list. */
export type ModuleMetaPatch = Pick<CatalogBlueprint, 'description' | 'readme' | 'media'>;

/** One registry entry, with the server's verdict on whether the current user may install it (§2.2 axis C). */
export interface CatalogModule {
  id: number;
  key: string;
  origin: ModuleOrigin;
  version: string;
  blueprint: CatalogBlueprint;
  publisher_space_id: number | null;
  status: 'draft' | 'published' | 'submitted' | 'audited' | 'rejected';
  checksum: string;
  category: string;
  components: ModuleComponent[];
  can_install: boolean;
  required_role: 'admin' | 'member';
  /** Market counters; shown for `default` and `external` only (§2.7). */
  rating?: number | null;
  installs?: number | null;
  reviews_count?: number | null;
  reviews?: ModuleReview[];
  updated_at?: string;
}

export interface CatalogFilters {
  origin?: ModuleOrigin;
  /** A module must contain every chosen component. */
  components: ModuleComponent[];
  category?: string;
  /** "I can install myself": only modules the current role may install. */
  canInstall: boolean;
  search: string;
}
