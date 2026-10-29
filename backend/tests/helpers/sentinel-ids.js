// Unreachable row ids for "does not exist" assertions — ADR-0009 §Phase 7
//
// Why this exists: suites used to hard-code `99999` / `999999` as the id of a
// row that "does not exist". On 2026-10-04 `widgets_id_seq` in the shared
// `godcrm_test` crossed 99999, a fixture widget landed on exactly that id,
// survived its teardown, and five "should reject non-existent widget" tests
// failed on a clean main (chat 3660, ticket 240245). `dashboards`, `spaces`
// and `users` are next in line.
//
// `2147483647` is int4 max — the largest value a `serial`/`integer` id column
// can hold, so no sequence can ever mint it and nothing inserts it by hand.
// It also fits every `bigint` id, every URL param and every zod `.int()` check.
//
// Usage:
//
//   import { NON_EXISTENT_ID } from '../../tests/helpers/sentinel-ids.js';
//
//   await expect(getWidgetById(NON_EXISTENT_ID)).resolves.toBeNull();
//   await request(app).get(`/api/v3/widgets/${NON_EXISTENT_ID}`).expect(404);

/** Largest int4 — an id no PostgreSQL sequence will ever reach. */
export const NON_EXISTENT_ID = 2147483647;

/** Same sentinel as a string, for query strings and JSON bodies that send ids as text. */
export const NON_EXISTENT_ID_STR = String(NON_EXISTENT_ID);
