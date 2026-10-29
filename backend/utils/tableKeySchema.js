import { z } from 'zod';

export const tableKeySchema = z.string().min(1).refine(
  (value) => !/[^A-Za-z0-9_]/.test(value),
  'Table key must contain only Latin letters, digits and underscores; use display_name for a localized title'
);
