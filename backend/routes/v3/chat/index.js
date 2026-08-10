/**
 * Chat module — thin router that imports all controllers and wires up routes.
 * This is a pure structural refactoring of the original chat.js (5725 lines).
 */

import { Router } from 'express';

// Controller registration functions
import registerConversationCrudRoutes from './conversationCrudController.js';
import registerConversationExtrasRoutes from './conversationExtrasController.js';
import registerMessageRoutes from './messageController.js';
import registerStreamRoutes from './streamController.js';
import registerTaskRowRoutes from './taskRowController.js';
import registerParticipantRoutes from './participantController.js';
import registerToolApprovalRoutes from './toolApprovalController.js';
import registerStepsRoutes from './stepsController.js';
import registerSummaryRoutes from './summaryController.js';
import registerConversationSummaryRoutes from './conversationSummaryController.js';
import registerCallRoutes from './callController.js';
import registerScheduledMessageRoutes from './scheduledMessageController.js';
import registerNotificationPrefsRoutes from './notificationPrefsController.js';
import registerPinRoutes from './pinController.js';

// Re-export named exports for backward compatibility (original line 1215)
export {
  MAX_DELEGATION_DEPTH, MAX_MENTIONS_PER_RESPONSE,
  _activeDelegationChains, getDelegationChain, clearDelegationChain,
} from './chatAgentDelegation.js';

export {
  parseMentions, parseDelegations,
  parseInvocationMentions, parseInvocationCommands,
  parseReferenceMentions, parseReferenceCommands,
} from './chatShared.js';

// Build router
const router = Router();

registerConversationCrudRoutes(router);
registerConversationExtrasRoutes(router);
registerMessageRoutes(router);
registerStreamRoutes(router);
registerTaskRowRoutes(router);
registerParticipantRoutes(router);
registerToolApprovalRoutes(router);
registerStepsRoutes(router);
registerSummaryRoutes(router);
registerConversationSummaryRoutes(router);
registerCallRoutes(router);
registerScheduledMessageRoutes(router);
registerNotificationPrefsRoutes(router);
registerPinRoutes(router);

export default router;
