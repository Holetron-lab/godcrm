/**
 * BDD routes — thin router that composes per-resource submodules.
 *
 * ADR-156 Phase 5A + 5D, ADR-0003 §C-4 + Phase 2.
 *
 * Endpoints (all mounted under /api/v3/bdd):
 *   POST   /tests/:id/runs                 (tests.js — ADR-156 Phase 5A)
 *   POST   /acceptance/:docId/confirm      (acceptance.js — ADR-156 App.C §2.6)
 *   GET    /specs?source_doc_id=<id>       (specs.js)
 *   POST   /criteria/:id/enroll-start      (enrollments.js)
 *   POST   /criteria/:id/enroll-confirm    (enrollments.js)
 *   POST   /criteria/:id/verify            (transitions.js — canonical)
 *   POST   /criteria/:id/confirm           (transitions.js — legacy alias)
 *   POST   /criteria/:id/waive             (transitions.js)
 *   POST   /criteria/:id/escalate          (escalation.js — ADR-0003 Phase 2)
 *   POST   /criteria/:id/resolve           (escalation.js — ADR-0003 Phase 2)
 *   GET    /events                         (events.js — SSE)
 */

import { Router } from 'express';

import registerTestRoutes from './tests.js';
import registerAcceptanceRoutes from './acceptance.js';
import registerSpecsRoutes from './specs.js';
import registerEnrollmentRoutes from './enrollments.js';
import registerTransitionRoutes from './transitions.js';
import registerEscalationRoutes from './escalation.js';
import registerEventRoutes from './events.js';

// Re-export named helpers used by scripts/encrypt-totp-secrets.js migration and
// by smoke tests — preserved for backward compatibility with the monolithic
// bdd.js that previously exposed them at line 616.
export { encryptSecret, decryptSecret } from './shared.js';

const router = Router();

registerTestRoutes(router);
registerAcceptanceRoutes(router);
registerSpecsRoutes(router);
registerEnrollmentRoutes(router);
registerTransitionRoutes(router);
registerEscalationRoutes(router);
registerEventRoutes(router);

export default router;
