/**
 * Connector-backed tool definitions + handlers — ADR-0028 Phase 4 (a).
 *
 * These tools exercise Space Connectors as their auth source. They are
 * registered with `requires_connector` so the executor pre-flights the
 * lookup; the handler reads the access_token from `context.injected_connector`.
 *
 * Add a new connector-backed tool by:
 *   1. Append a definition to `CONNECTOR_TOOL_DEFS` with `requires_connector`.
 *   2. Register a handler in `connectorToolHandlers`.
 *   3. Re-export from `tool-definitions/index.js` (already imports this file).
 *
 * Security: the access_token comes via `context.injected_connector.access_token`
 * — never logged, never returned in tool output, never passed to LLM.
 */

import axios from 'axios';

import { aiLogger } from '../../utils/logger.js';

const log = aiLogger.child({ module: 'connector_tools' });

// ─── Tool definitions (OpenAI function-calling schema) ──────────────

export const CONNECTOR_TOOL_DEFS = [
  {
    type: 'function',
    requires_connector: 'figma',
    function: {
      name: 'figma_get_file',
      description:
        'Fetch a Figma file metadata + node tree using the active Figma connector ' +
        'in the current space. Returns name, lastModified, document outline.',
      parameters: {
        type: 'object',
        properties: {
          file_key: {
            type: 'string',
            description: 'Figma file key (the `XXX` in figma.com/file/XXX/...).',
          },
          depth: {
            type: 'number',
            description: 'How deep to traverse the node tree (default 1, max 4).',
          },
        },
        required: ['file_key'],
      },
    },
  },
  {
    type: 'function',
    requires_connector: 'slack',
    function: {
      name: 'slack_post_message',
      description:
        'Post a message to a Slack channel using the active Slack connector in the current space.',
      parameters: {
        type: 'object',
        properties: {
          channel: {
            type: 'string',
            description: 'Channel ID (preferred) or name with leading #.',
          },
          text: {
            type: 'string',
            description: 'Message text. Slack mrkdwn supported.',
          },
        },
        required: ['channel', 'text'],
      },
    },
  },
  {
    type: 'function',
    requires_connector: 'github',
    function: {
      name: 'github_get_user',
      description:
        'Return authenticated user profile (login, name, email, public_repos) ' +
        'via the active GitHub connector in the current space. Smoke test for ' +
        'GitHub connector wiring.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ─── Requirements lookup (consumed by executor) ─────────────────────
//
// Map: tool_name → required connector type_slug. Built once at import.

export const connectorRequirements = Object.fromEntries(
  CONNECTOR_TOOL_DEFS.filter((t) => t.requires_connector).map((t) => [
    t.function.name,
    t.requires_connector,
  ])
);

// ─── Handlers ───────────────────────────────────────────────────────

function getInjected(context, expected) {
  const inj = context?.injected_connector;
  if (!inj || inj.type_slug !== expected || !inj.access_token) {
    // Should never happen — executor pre-flights. Defensive belt.
    return null;
  }
  return inj;
}

async function figma_get_file(args, _userId, context) {
  const inj = getInjected(context, 'figma');
  if (!inj) return { error: 'connector_not_injected', expected: 'figma' };
  const fileKey = args?.file_key;
  if (!fileKey || typeof fileKey !== 'string') {
    return { error: 'bad_args', message: 'file_key is required' };
  }
  const depth = Math.min(Math.max(Number(args?.depth ?? 1), 1), 4);
  try {
    const res = await axios.get(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`, {
      params: { depth },
      headers: { Authorization: `Bearer ${inj.access_token}` },
      timeout: 20_000,
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      return { error: `figma_http_${res.status}`, message: res.data?.err || res.data?.message || null };
    }
    const data = res.data || {};
    return {
      name: data.name,
      lastModified: data.lastModified,
      version: data.version,
      thumbnailUrl: data.thumbnailUrl,
      role: data.role,
      document_id: data.document?.id,
      top_level_pages: (data.document?.children || []).map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        child_count: Array.isArray(p.children) ? p.children.length : 0,
      })),
      account_label: inj.account_label,
    };
  } catch (err) {
    log.warn({ err: err?.message, fileKey }, 'figma_get_file failed');
    return { error: 'figma_request_failed', message: err?.message || 'unknown' };
  }
}

async function slack_post_message(args, _userId, context) {
  const inj = getInjected(context, 'slack');
  if (!inj) return { error: 'connector_not_injected', expected: 'slack' };
  const channel = args?.channel;
  const text = args?.text;
  if (!channel || !text) {
    return { error: 'bad_args', message: 'channel and text are required' };
  }
  try {
    const { data } = await axios.post(
      'https://slack.com/api/chat.postMessage',
      { channel, text },
      {
        headers: {
          Authorization: `Bearer ${inj.access_token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        timeout: 10_000,
        validateStatus: () => true,
      }
    );
    if (!data?.ok) {
      return { error: `slack_${data?.error || 'unknown'}`, message: data?.error || null };
    }
    return {
      ok: true,
      channel: data.channel,
      ts: data.ts,
      account_label: inj.account_label,
    };
  } catch (err) {
    log.warn({ err: err?.message, channel }, 'slack_post_message failed');
    return { error: 'slack_request_failed', message: err?.message || 'unknown' };
  }
}

async function github_get_user(_args, _userId, context) {
  const inj = getInjected(context, 'github');
  if (!inj) return { error: 'connector_not_injected', expected: 'github' };
  try {
    const res = await axios.get('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${inj.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'godcrm-connectors',
      },
      timeout: 10_000,
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      return { error: `github_http_${res.status}`, message: res.data?.message || null };
    }
    const u = res.data || {};
    return {
      login: u.login,
      name: u.name,
      email: u.email,
      public_repos: u.public_repos,
      followers: u.followers,
      account_label: inj.account_label,
    };
  } catch (err) {
    log.warn({ err: err?.message }, 'github_get_user failed');
    return { error: 'github_request_failed', message: err?.message || 'unknown' };
  }
}

export const connectorToolHandlers = {
  figma_get_file,
  slack_post_message,
  github_get_user,
};

export default { CONNECTOR_TOOL_DEFS, connectorRequirements, connectorToolHandlers };
