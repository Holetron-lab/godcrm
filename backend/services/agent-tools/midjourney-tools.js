import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { midjourneySettings, requestMidjourney } from '../connectors/midjourney.js';

export const MIDJOURNEY_TOOL_DEFS = [
  {
    type: 'function', requires_connector: 'midjourney',
    function: {
      name: 'midjourney_image_generate',
      description: 'Generate an image through the current space’s Midjourney relay and subscription. Returns an opaque task_id immediately; poll midjourney_check_task every 10–30 seconds. Uses credits. Never automatically retry an uncertain submission. Configure the relay in space settings first.',
      parameters: { type: 'object', properties: { prompt: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['prompt'], additionalProperties: false },
    },
  },
  {
    type: 'function', requires_connector: 'midjourney',
    function: {
      name: 'midjourney_check_task',
      description: 'Check a Midjourney generation once using the opaque task_id from midjourney_image_generate in this space. SUCCESS returns image_url (relay-hosted, may expire); FAILURE is terminal. Do not pass a raw relay task ID.',
      parameters: { type: 'object', properties: { task_id: { type: 'string', maxLength: 8192 } }, required: ['task_id'], additionalProperties: false },
    },
  },
];

const upstreamId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const submitResponse = z.object({ code: z.union([z.literal(1), z.literal(21), z.literal(22)]), result: upstreamId });
const taskResponse = z.object({
  id: upstreamId,
  status: z.enum(['NOT_START', 'SUBMITTED', 'IN_PROGRESS', 'FAILURE', 'SUCCESS']),
  progress: z.string().max(16).nullish(),
  imageUrl: z.string().max(8192).nullish(),
});

function relayContext(context) {
  const connector = context?.injected_connector;
  if (connector?.type_slug !== 'midjourney' || !process.env.JWT_SECRET) throw new Error('Missing relay context');
  const spaceId = z.coerce.number().int().positive().parse(context.spaceId ?? context.space_id);
  const settings = midjourneySettings.parse({ url: connector.custom_fields?.url, access_token: connector.access_token });
  return { settings, audience: `midjourney:${spaceId}`, relay: settings.url.replace(/\/+$/, '') };
}

export const midjourneyToolHandlers = {
  async midjourney_image_generate(args, _userId, context) {
    const input = z.object({ prompt: z.string().trim().min(1).max(4000) }).strict().safeParse(args);
    if (!input.success) return { error: 'bad_args', message: 'Provide only a non-empty prompt (up to 4000 characters).' };
    let scope;
    try { scope = relayContext(context); } catch { return { error: 'connector_missing', required_connector: 'midjourney' }; }
    try {
      const response = await requestMidjourney(scope.settings, '/submit/imagine', submitResponse, input.data);
      // Bind the handle to the space + relay; no task table or cross-space reads.
      const task_id = jwt.sign({ upstream_id: response.result, relay: scope.relay }, process.env.JWT_SECRET,
        { algorithm: 'HS256', audience: scope.audience, expiresIn: '30d' });
      return { async: true, task_id, status: 'SUBMITTED' };
    } catch {
      return { error: 'midjourney_submit_failed', message: 'Relay submission failed or its outcome is unknown. Check the relay before retrying; a retry may create another paid generation.' };
    }
  },
  async midjourney_check_task(args, _userId, context) {
    const input = z.object({ task_id: z.string().min(1).max(8192) }).strict().safeParse(args);
    if (!input.success) return { error: 'bad_args', message: 'Provide the task_id returned by midjourney_image_generate.' };
    let scope, task;
    try {
      scope = relayContext(context);
      task = z.object({ upstream_id: upstreamId, relay: z.literal(scope.relay) }).parse(
        jwt.verify(input.data.task_id, process.env.JWT_SECRET, { algorithms: ['HS256'], audience: scope.audience })
      );
    } catch { return { error: 'invalid_task', message: 'Task handle is invalid, expired, or belongs to another space or relay.' }; }
    try {
      const response = await requestMidjourney(scope.settings, `/task/${task.upstream_id}/fetch`, taskResponse);
      if (response.id !== task.upstream_id) throw new Error('Task mismatch');
      let image_url;
      if (response.status === 'SUCCESS') {
        image_url = z.string().url().refine(value => {
          const url = new URL(value);
          return url.protocol === 'https:' && !url.username && !url.password;
        }).parse(response.imageUrl);
      }
      return {
        task_id: input.data.task_id, status: response.status,
        async: !['SUCCESS', 'FAILURE'].includes(response.status),
        ...(response.progress ? { progress: response.progress } : {}),
        ...(image_url ? { image_url } : {}),
      };
    } catch { return { error: 'midjourney_check_failed', message: 'Could not read a valid task result from the relay.' }; }
  },
};
