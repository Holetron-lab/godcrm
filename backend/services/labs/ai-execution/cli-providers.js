/**
 * CLI-based AI provider execution functions (Claude Code, GitHub Copilot).
 *
 * Extracted from ai-execution-service.js
 * @see ADR-072: Claude Code CLI Integration
 */

import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { dirname, resolve as resolvePath } from 'node:path';
import { apiLogger } from '../../../utils/logger.js';
import { prepareCodexWorkspace } from './codex-workspace.js';
import { killProcessTree, trackChildProcess, untrackChildProcess } from './process-management.js';
import { buildMcpGateEnv } from '../../connectors/mcpGate.js';
import { buildOpsGateEnv } from '../../ops/opsGate.js';

// ADR-0053 Phase C3 — absolute path to the PreToolUse hook script.
// Computed once at module load (cli-providers.js → ../../../../scripts/).
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PERMISSION_HOOK = resolvePath(__dirname, '../../../../scripts/agent-permission-hook.js');
// ADR-0181 — Stop hook that frees this loop's write-reservations at turn end.
const AGENT_RESERVATION_RELEASE_HOOK = resolvePath(__dirname, '../../../../scripts/agent-reservation-release-hook.js');

/**
 * Optional per-run controls shared by the claude-code and codex adapters (additive; every
 * existing caller passes neither and sees no change):
 *   - `signal` (AbortSignal): aborted BEFORE spawn → reject with AbortError, nothing is spawned;
 *     aborted AFTER spawn → the process tree is killed. Lets a short-lease caller (Neo16 turn)
 *     cancel a run that is still preparing instead of discovering a late child.
 *   - `permissionsFailClosed` (boolean): the run must never gain a tool through an outage —
 *     AGENT_PERMS=bypass is refused for it (hooks are mandatory), and the PreToolUse hook is told
 *     to deny on every degraded path (AGENT_PERMS_FAIL_CLOSED=1, see scripts/agent-permission-hook.js).
 */
function abortError(signal) {
  const err = new Error(`CLI run aborted before spawn${signal?.reason ? `: ${signal.reason}` : ''}`);
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}
const bypassRefused = () => new Error('AGENT_PERMS=bypass is not allowed for a fail-closed run: the permission hook is mandatory');
/** Kill the tree when the caller aborts; detached once the child has closed. */
function bindAbort(signal, child) {
  if (!signal) return;
  const onAbort = () => killProcessTree(child.pid, child);
  signal.addEventListener('abort', onAbort, { once: true });
  child.on('close', () => signal.removeEventListener('abort', onAbort));
}

/**
 * Execute AI request using Claude Code CLI
 * Local terminal agent with file and shell access
 * @see ADR-072: Claude Code CLI Integration
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} Execution result
 */
export async function executeClaudeCode(params) {
  const { model, messages, systemPrompt, maxTokens, maxTurns, onEvent, onSpawn, agentId, spaceId, jobId, signal, permissionsFailClosed } = params;
  if (signal?.aborted) throw abortError(signal);
  const { spawn } = await import('child_process');
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');

  // Build prompt with conversation history
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]?.content || '';
  const historyMessages = nonSystemMessages.slice(0, -1);

  let fullPrompt = lastMessage;
  if (historyMessages.length > 0) {
    const historyText = historyMessages
      .map(m => `[${m.role === 'assistant' ? 'Assistant' : 'User'}]: ${m.content}`)
      .join('\n\n');
    fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\n[User]: ${lastMessage}`;
  }

  const context = systemPrompt || '';

  // FIX: Write system prompt to temp file to avoid E2BIG when system prompt is long.
  // Previously passed as --system-prompt CLI arg, which counts toward Linux ARG_MAX (~2MB).
  // Long agent system prompts (with skills, bound row context, summaries) can easily exceed this.
  let systemPromptFile = null;
  if (context) {
    try {
      const tmpDir = os.tmpdir();
      systemPromptFile = path.join(tmpDir, `claude-sysprompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      fs.writeFileSync(systemPromptFile, context);
    } catch (tmpErr) {
      apiLogger.warn({ err: tmpErr.message }, 'Failed to write system prompt to temp file, falling back to CLI arg');
      systemPromptFile = null;
    }
  }

  // MCP-kind connectors (Settings → Connectors): a gate token lands in the child
  // env only for the agent/space the server pins while the connector is on.
  // Never throws, never delays a turn — see services/connectors/mcpGate.js.
  const mcpGateEnv = await buildMcpGateEnv({ agentId, spaceId, jobId });
  // Ops profiles (diagnostics / local-qa): same contract — a token only while a
  // live grant exists for this agent in this space. See services/ops/opsGate.js.
  const opsGateEnv = await buildOpsGateEnv({ agentId, spaceId, jobId });

  return new Promise((resolve, reject) => {
    // stream-json gives us tool_use/tool_result events in real-time.
    //
    // FIX: Pass prompt via stdin (-p -) instead of CLI argument to avoid E2BIG
    // when conversation history is long. Linux ARG_MAX (~2MB) is easily exceeded
    // by agents with many restart cycles or long chat histories.
    //
    // ADR-0053 Phase C3: server-side PreToolUse hook gates every tool call.
    //   - Default mode: --settings injects the hook command; no --allowedTools
    //     whitelist (everything goes through the hook, which checks
    //     CRITICAL_DENIES + _command_policies on each call).
    //   - AGENT_PERMS=bypass (opt-in, non-root only) — adds
    //     --dangerously-skip-permissions and skips the hook. Reserved for
    //     emergency rollback if the hook misbehaves; do NOT use under root.
    const agentPermsMode = (process.env.AGENT_PERMS || 'hook').toLowerCase();
    const dropSystemPromptFile = () => { if (systemPromptFile) { try { fs.unlinkSync(systemPromptFile); } catch { /* ignore */ } } };
    if (permissionsFailClosed && agentPermsMode === 'bypass') {
      dropSystemPromptFile();
      return reject(bypassRefused());
    }

    const args = [
      '-p', '-',
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
    ];

    if (agentPermsMode === 'bypass') {
      args.push('--dangerously-skip-permissions');
    } else {
      // ADR-0181: the Stop hook releases the reservations this worker took.
      // Each turn is a fresh `claude -p` with a NEW session UUID, so without it
      // the lock outlives the turn and the same agent's next turn is denied by
      // its own reservation for the full TTL.
      const hookSettings = {
        hooks: {
          PreToolUse: [{
            matcher: '*',
            hooks: [{ type: 'command', command: `node ${AGENT_PERMISSION_HOOK}` }],
          }],
          Stop: [{
            hooks: [{ type: 'command', command: `node ${AGENT_RESERVATION_RELEASE_HOOK}` }],
          }],
        },
      };
      args.push('--settings', JSON.stringify(hookSettings));
    }

    // Fleet-wide model. Gera put the whole agent fleet on Fable 5 while the Max
    // subscription lasts ("выжимаем максимум пока дают"). This function is the
    // single funnel EVERY claude-code agent passes through (agent-loop, agent-job,
    // both chat controllers), so overriding the alias here moves the entire fleet
    // at once — no per-agent DB edits, no scattered hardcodes. Verified live:
    // `claude --print --model fable` resolves on the current Max OAuth creds.
    // Rollback without a code change: CLAUDE_FLEET_MODEL=opus forces everyone back
    // to Opus; CLAUDE_FLEET_MODEL=auto restores each agent's stored model id.
    const fleetModel = (process.env.CLAUDE_FLEET_MODEL || 'opus').toLowerCase();
    if (fleetModel !== 'auto') {
      args.push('--model', fleetModel);
    } else if (model) {
      const cliAlias = model.includes('fable') ? 'fable'
        : model.includes('opus') ? 'opus'
        : model.includes('sonnet') ? 'sonnet'
        : model.includes('haiku') ? 'haiku'
        : model;
      args.push('--model', cliAlias);
    }

    // Pass system prompt: prefer temp file (avoids E2BIG), fall back to CLI arg
    if (systemPromptFile) {
      // Read system prompt from temp file via shell trick won't work with spawn,
      // so we pass it via CLI arg but from the file content (already written above)
      // Actually, Claude CLI --system-prompt only takes a string, not a file.
      // So we include system prompt in stdin as a structured prefix instead.
      // This completely avoids the CLI arg size limit.
    } else if (context) {
      args.push('--system-prompt', context);
    }

    // Limit turns to prevent runaway agent loops
    // Read from params.maxTurns (agent config maxSteps) or default to 100
    const resolvedMaxTurns = maxTurns || 100;
    args.push('--max-turns', String(resolvedMaxTurns));

    apiLogger.info({
      args: args.slice(0, 7),
      permsMode: agentPermsMode,
      hookPath: agentPermsMode === 'bypass' ? null : AGENT_PERMISSION_HOOK,
      agentId: agentId ?? null,
      spaceId: spaceId ?? null,
      promptLength: fullPrompt.length,
      systemPromptLength: context.length,
      systemPromptVia: systemPromptFile ? 'stdin-prefix' : (context ? 'cli-arg' : 'none'),
    }, 'Spawning Claude Code CLI (stream-json)');

    // Clean env: remove all CLAUDE* vars to prevent nested session detection
    // Also explicitly remove known nesting indicators
    const childEnv = { ...process.env, CI: 'true', TERM: 'dumb' };
    Object.keys(childEnv).forEach(key => {
      if (key.startsWith('CLAUDE')) delete childEnv[key];
    });
    // Extra safety: remove any vars that Claude Code might use to detect nesting
    delete childEnv.CLAUDE_CODE_ENTRYPOINT;
    delete childEnv.CLAUDECODE;
    delete childEnv.CLAUDE_INTERNAL;
    delete childEnv.CLAUDE_AGENT_SDK;

    // ADR-0053 Phase C3: hook context. The PreToolUse hook (agent-permission-hook.js)
    // reads these from env to resolve specificity-scored rules in _command_policies.
    // AGENT_PERMS_TOKEN already lives on process.env (set by agent-permissions route
    // at module load); it carries through via the {...process.env} spread above.
    if (agentId != null) childEnv.AGENT_ID = String(agentId);
    if (spaceId != null) childEnv.SPACE_ID = String(spaceId);
    if (jobId != null) childEnv.MCP_JOB_ID = String(jobId);
    if (permissionsFailClosed) childEnv.AGENT_PERMS_FAIL_CLOSED = '1';
    Object.assign(childEnv, mcpGateEnv, opsGateEnv);

    // Last check before the fork: an abort that raced the preparation above must not spawn.
    if (signal?.aborted) {
      dropSystemPromptFile();
      return reject(abortError(signal));
    }

    const child = spawn('claude', args, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Create process group so we can kill all MCP children together
    });
    // Unref so the parent can exit without waiting for this process group
    child.unref();
    bindAbort(signal, child);

    // Track child process for graceful shutdown
    if (child.pid) {
      trackChildProcess(child.pid, {
        child,
        label: `claude-code:${model || 'default'}`,
        startedAt: Date.now(),
      });
    }

    // FIX-B: Report child PID immediately via onSpawn callback.
    // This allows AgentJobService to write worker_pid to the agent_jobs row
    // for process monitoring and orphan detection.
    if (onSpawn && child.pid) {
      try { onSpawn(child.pid); } catch { /* ignore callback errors */ }
    }

    let buffer = '';
    let stderr = '';
    let finalResult = null;
    let lastAssistantText = ''; // Fallback: capture last text block from assistant events
    // Actual model the CLI ran on. The requested model (`model` param) is NOT it:
    // CLAUDE_FLEET_MODEL overrides the agent's stored id at spawn (see above), so
    // reporting the request back made every job row claim the fleet's previous
    // model. The `system/init` event is the CLI's own statement of what it
    // resolved — the only in-band source of truth.
    let initModel = null;
    let stdinFailed = false;

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // Parse complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete last line in buffer
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          // Fire callback for real-time step saving
          if (onEvent) {
            try { onEvent(event); } catch { /* ignore callback errors */ }
          }
          // Capture the model the CLI actually resolved (stream-json init event)
          if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string' && event.model) {
            initModel = event.model;
          }
          // Capture last assistant text for fallback
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                lastAssistantText = block.text;
              }
            }
          }
          if (event.type === 'result') {
            finalResult = event;
            apiLogger.info({
              resultKeys: Object.keys(event),
              hasResult: 'result' in event,
              resultType: typeof event.result,
              resultLength: typeof event.result === 'string' ? event.result.length : 0,
              subtype: event.subtype,
              stopReason: event.stop_reason,
              lastAssistantTextLen: lastAssistantText.length,
              numTurns: event.num_turns,
              permissionDenials: event.permission_denials || [],
            }, 'Claude CLI result event structure');
          }
        } catch {
          // Not valid JSON line — ignore
        }
      }
    });

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (err) => {
      apiLogger.error({ err }, 'Failed to spawn Claude Code CLI');
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      // Remove from active tracking
      if (child.pid) {
        untrackChildProcess(child.pid);
        // Kill any leftover MCP children in this process group
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group already dead */ }
      }

      if (stdinFailed) return;

      // Parse any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (onEvent) { try { onEvent(event); } catch { /* */ } }
          if (event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string' && event.model) {
            initModel = event.model;
          }
          if (event.type === 'result') finalResult = event;
        } catch { /* */ }
      }

      if (code !== 0 && !finalResult) {
        // Enhanced error diagnostics: capture both stderr and any non-JSON stdout lines
        const stderrTrimmed = (stderr || '').trim();
        const bufferTrimmed = (buffer || '').trim();
        apiLogger.warn({
          code, stderr: stderrTrimmed, remainingBuffer: bufferTrimmed.substring(0, 500),
          promptLength: fullPrompt.length, systemPromptLength: context.length,
          model, lastAssistantTextLen: lastAssistantText.length,
        }, 'Claude Code CLI exited with non-zero code');
        const errDetail = stderrTrimmed || bufferTrimmed.substring(0, 200) || 'No error output captured';
        reject(new Error(`Claude CLI exited with code ${code}: ${errDetail}`));
        return;
      }

      let content = finalResult?.result || '';
      const usage = finalResult?.usage || {};

      // Fallback: if result.result is empty but we captured text from assistant events, use that
      if (!content && lastAssistantText) {
        content = lastAssistantText;
        apiLogger.info({ fallbackLength: content.length }, 'Claude CLI: Using lastAssistantText as fallback (result.result was empty)');
      }

      // Bug #74011: When process was killed (SIGTERM/timeout) or exited abnormally
      // with no content, provide a descriptive fallback instead of empty string
      if (!content && code !== 0) {
        content = 'Agent process was interrupted.';
        apiLogger.warn({ code, context: 'executeClaudeCode' }, 'CLI exited with non-zero code and empty result — using fallback content');
      }

      // Resolve the model actually used: CLI init event first, then the result
      // event's per-model usage map, and only then the requested id as a last
      // resort (flagged via modelSource so callers can tell a fact from a guess).
      const usageModel = finalResult?.modelUsage && typeof finalResult.modelUsage === 'object'
        ? Object.keys(finalResult.modelUsage)[0] || null
        : null;
      const actualModel = initModel || usageModel || null;
      const modelSource = initModel ? 'cli_init' : (usageModel ? 'cli_result' : 'requested');

      apiLogger.info({
        contentLength: content.length, turns: finalResult?.num_turns,
        requestedModel: model || null, actualModel, modelSource,
      }, 'Claude Code CLI completed');

      resolve({
        content,
        usage: {
          promptTokens: usage.input_tokens || 0,
          completionTokens: usage.output_tokens || 0,
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
        },
        model: actualModel || model || 'claude-sonnet-4',
        requestedModel: model || null,
        modelSource,
        finishReason: finalResult?.stop_reason || 'end_turn',
        costUsd: finalResult?.total_cost_usd || 0
      });
    });

    // Timeout: per-agent `run_timeout_min` resolved by the caller (Bug 1552/228714);
    // 120 min when the caller passes nothing (main default since the sub-agent timeout bump).
    const CLI_TIMEOUT_MS = Number(params.runTimeoutMs) > 0 ? Number(params.runTimeoutMs) : 120 * 60 * 1000;
    const timeoutMin = Math.round(CLI_TIMEOUT_MS / 60000);
    const timeout = setTimeout(() => {
      apiLogger.warn(`Claude CLI timeout reached (${timeoutMin} min), killing process tree`);
      killProcessTree(child.pid, child);
      reject(new Error(`Claude CLI timeout (${timeoutMin} min)`));
    }, CLI_TIMEOUT_MS);

    child.on('close', () => clearTimeout(timeout));

    // Install lifecycle/error handlers before writing: a broken CLI can close
    // its input before exitCode is visible, emitting EPIPE on the stream itself.
    const failStdin = (err) => {
      if (stdinFailed) return;
      stdinFailed = true;
      clearTimeout(timeout);
      dropSystemPromptFile();
      apiLogger.error({ err, pid: child.pid, jobId, exitCode: child.exitCode, signalCode: child.signalCode },
        'Failed to write Claude CLI stdin');
      reject(new Error(`Claude CLI stdin failed: ${err.message}`, { cause: err }));
      if (child.pid && child.exitCode == null && child.signalCode == null) killProcessTree(child.pid, child);
    };
    if (child.stdin) {
      child.stdin.on('error', failStdin);
      if (child.exitCode != null || child.signalCode != null) {
        failStdin(new Error(`Claude CLI exited before prompt delivery (code ${child.exitCode}, signal ${child.signalCode})`));
        return;
      }
      try {
        if (systemPromptFile) {
          const sysPromptContent = fs.readFileSync(systemPromptFile, 'utf-8');
          child.stdin.write(`<system_instructions>\n${sysPromptContent}\n</system_instructions>\n\n${fullPrompt}`);
          dropSystemPromptFile();
        } else {
          child.stdin.write(fullPrompt);
        }
        child.stdin.end();
      } catch (err) {
        failStdin(err);
      }
    }
  });
}

/**
 * Execute prompt via GitHub Copilot CLI (`copilot`, package @github/copilot).
 *
 * NOT the old `gh copilot` extension — that one only suggests shell commands.
 * The standalone binary runs a full agent loop; non-interactive mode requires
 * -p plus --allow-all-tools, and reports real usage via --usage-output-file.
 *
 * Usage JSON gives `currentModel` (what actually ran) and
 * `totalPremiumRequestCost` (premium requests, NOT dollars). The dollar figure
 * is derived with COPILOT_PREMIUM_REQUEST_USD (default 0.04 = GitHub's overage
 * price) so cost_limit_usd has something to enforce; the raw request count is
 * returned alongside as premiumRequestCost.
 */
export async function executeCopilotCli(params) {
  const { model, messages, systemPrompt, maxTokens, onEvent } = params;
  const { spawn } = await import('child_process');
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');

  // Build prompt with conversation history (same as Claude Code)
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]?.content || '';
  const historyMessages = nonSystemMessages.slice(0, -1);

  let fullPrompt = lastMessage;
  if (historyMessages.length > 0) {
    const historyText = historyMessages
      .map(m => `[${m.role === 'assistant' ? 'Assistant' : 'User'}]: ${m.content}`)
      .join('\n\n');
    fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\n[User]: ${lastMessage}`;
  }

  // Copilot CLI has no --system-prompt flag. The previous version left this as
  // an empty if-block, so the agent's system prompt was silently dropped.
  if (systemPrompt) {
    fullPrompt = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${fullPrompt}`;
  }

  return new Promise((resolve, reject) => {
    const usageFile = path.join(
      os.tmpdir(),
      `copilot-usage-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    // copilot -p "prompt" --allow-all-tools -s --model <model>
    const copilotArgs = [
      '-p', fullPrompt,
      '--allow-all-tools',
      '--allow-all-paths',
      '-s', // silent — output only agent response
      '--no-color',
      '--log-level', 'none',
      '--usage-output-file', usageFile
    ];

    // Copilot model ids are dotted (claude-haiku-4.5, gpt-5-mini) — pass through
    // verbatim, no aliasing. An unknown id makes the CLI exit non-zero with
    // 'Model "X" from --model flag is not available.' on stderr.
    if (model) {
      copilotArgs.push('--model', model);
    }

    const copilotBin = process.env.COPILOT_CLI_BIN || 'copilot';

    apiLogger.info({
      model: model || null,
      promptLen: fullPrompt.length,
      systemPromptLength: systemPrompt ? systemPrompt.length : 0,
      bin: copilotBin,
    }, 'Spawning GitHub Copilot CLI');

    // Classic PATs (ghp_) are rejected by Copilot; the CLI must fall through to
    // the OAuth token in ~/.config/gh/hosts.yml. Strip any inherited token vars.
    const childEnv = { ...process.env, TERM: 'dumb', NO_COLOR: '1' };
    delete childEnv.GH_TOKEN;
    delete childEnv.GITHUB_TOKEN;
    delete childEnv.GH_ENTERPRISE_TOKEN;

    const child = spawn(copilotBin, copilotArgs, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // process group — kill MCP children together on timeout
    });
    child.unref();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const readUsage = () => {
      try {
        const raw = fs.readFileSync(usageFile, 'utf-8');
        return JSON.parse(raw);
      } catch {
        return null;
      } finally {
        try { fs.unlinkSync(usageFile); } catch { /* ignore */ }
      }
    };

    child.on('error', (err) => {
      try { fs.unlinkSync(usageFile); } catch { /* ignore */ }
      apiLogger.error({ err }, 'Failed to spawn Copilot CLI');
      reject(new Error(`Failed to spawn Copilot CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      const usageJson = readUsage();

      if (code !== 0 && !stdout.trim()) {
        apiLogger.warn({ code, stderr }, 'Copilot CLI exited with non-zero code');
        reject(new Error(`Copilot CLI exited with code ${code}: ${stderr}`));
        return;
      }

      const content = stdout.trim();

      // Sum per-model token metrics; the top-level lastCall* fields only cover
      // the final API call, which undercounts any multi-turn tool loop.
      let promptTokens = 0;
      let completionTokens = 0;
      for (const m of Object.values(usageJson?.modelMetrics || {})) {
        promptTokens += m?.usage?.inputTokens || 0;
        completionTokens += m?.usage?.outputTokens || 0;
      }

      const premiumRequestCost = usageJson?.totalPremiumRequestCost ?? null;
      const usdPerPremiumRequest = Number(process.env.COPILOT_PREMIUM_REQUEST_USD || 0.04);
      const actualModel = usageJson?.currentModel || null;

      apiLogger.info({
        contentLength: content.length,
        model: actualModel || model || null,
        modelSource: actualModel ? 'cli_usage' : 'requested',
        premiumRequestCost,
        promptTokens,
        completionTokens,
      }, 'Copilot CLI completed');

      resolve({
        content,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        // Fact from the CLI's own usage report, not the requested id — the same
        // trap that made agent_jobs.result_metadata.model lie on the Claude path.
        model: actualModel || model || null,
        modelSource: actualModel ? 'cli_usage' : 'requested',
        requestedModel: model || null,
        premiumRequestCost,
        finishReason: 'end_turn',
        costUsd: premiumRequestCost != null ? premiumRequestCost * usdPerPremiumRequest : 0
      });
    });

    // Timeout: per-agent `run_timeout_min` resolved by the caller (Bug 1552/228714);
    // 120 min when the caller passes nothing (main default since the sub-agent timeout bump).
    const CLI_TIMEOUT_MS = Number(params.runTimeoutMs) > 0 ? Number(params.runTimeoutMs) : 120 * 60 * 1000;
    const timeoutMin = Math.round(CLI_TIMEOUT_MS / 60000);
    const timeout = setTimeout(() => {
      apiLogger.warn(`Copilot CLI timeout reached (${timeoutMin} min), killing process`);
      killProcessTree(child.pid, child);
      try { fs.unlinkSync(usageFile); } catch { /* ignore */ }
      reject(new Error(`Copilot CLI timeout (${timeoutMin} min)`));
    }, CLI_TIMEOUT_MS);

    child.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Execute prompt via OpenAI Codex CLI (`codex exec`, package @openai/codex).
 *
 * Auth is the owner's ChatGPT subscription (device-auth token in
 * ~/.codex/auth.json) — NOT an api.openai.com key, so this path never touches
 * the vault's openai_api_key and never bills the platform account.
 *
 * Model: with ChatGPT auth the backend accepts exactly one id — `gpt-6-astra`
 * (the config.toml default). Every explicit `gpt-5.x` / `gpt-6` / `*-codex` id
 * returns 400 "not supported when using Codex with a ChatGPT account", so an
 * unrecognised model id is dropped rather than forwarded: better the account's
 * only working model than a guaranteed 400. CODEX_CLI_MODEL overrides.
 *
 * Events: `codex exec --json` emits its own JSONL vocabulary (thread.started /
 * item.started / item.completed / turn.completed). This adapter TRANSLATES it
 * into the Claude Code stream-json shape the three callers already handle
 * (agent-loop, agentChatController, agentExecutionController) — so a codex
 * agent produces the same tool_call / tool_result / thinking step messages in
 * chat as a claude-code one, with no duplicated onEvent plumbing.
 *
 * Approval: headless runs use --approve-for-me. Plain `approval_policy=never`
 * makes every MCP tool call fail with "requires approval, but approval policy
 * is never" — i.e. an agent with no tools at all.
 *
 * Permissions (ADR-0053 / ADR-0181, parity with the claude-code path): Codex
 * CLI 0.153.x ships the same hook events, wired through `-c hooks.<Event>`
 * instead of `--settings`. Verified on this box (2026-09-07, gpt-6-astra):
 *   - PreToolUse fires for shell (tool_name "Bash") AND for MCP calls
 *     (tool_name "mcp__godcrm__<tool>"); a deny is honoured for both.
 *   - Stop fires at turn end with the same {session_id, ...} payload the
 *     reservation-release hook needs.
 *   - hooks declared outside a trusted plugin are SKIPPED SILENTLY unless
 *     --dangerously-bypass-hook-trust is passed. Without that flag the agent
 *     still runs, just ungated — which is exactly the hole this closes. The
 *     flag only waives Codex's "did a human review this hook" prompt; the hook
 *     source is ours, pinned to an absolute path under the repo.
 * --approve-for-me stays: it satisfies Codex's own approval requirement (MCP
 * calls fail outright without it), and our hook now sits in front of it.
 */
export async function executeCodexCli(params) {
  const { model, messages, systemPrompt, onEvent, onSpawn, agentId, spaceId, jobId, signal, permissionsFailClosed } = params;
  if (signal?.aborted) throw abortError(signal);
  const { spawn } = await import('child_process');
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');

  const workspace = await prepareCodexWorkspace({ agentId, spaceId, jobId });
  const codexOpsGateEnv = await buildOpsGateEnv({ agentId, spaceId, jobId });

  // Build prompt with conversation history (same shape as the Claude path)
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]?.content || '';
  const historyMessages = nonSystemMessages.slice(0, -1);

  let fullPrompt = lastMessage;
  if (historyMessages.length > 0) {
    const historyText = historyMessages
      .map(m => `[${m.role === 'assistant' ? 'Assistant' : 'User'}]: ${m.content}`)
      .join('\n\n');
    fullPrompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\n[User]: ${lastMessage}`;
  }

  // codex exec has no --system-prompt flag; the prompt goes in via stdin as a
  // prefixed block (also keeps us clear of ARG_MAX on long agent prompts).
  if (systemPrompt) {
    fullPrompt = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${fullPrompt}`;
  }

  if (workspace) fullPrompt += `\n\n${workspace.instructions}`;
  let workspaceCanRelease = true;

  return new Promise((resolve, reject) => {
    const lastMessageFile = path.join(
      os.tmpdir(),
      `codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    );

    const args = [
      'exec',
      '-', // read the prompt from stdin
      '--json',
      '--skip-git-repo-check', // /srv/godcrm/live is a deploy artifact, not a repo
      '--approve-for-me',
      '--color', 'never',
      '-o', lastMessageFile,
    ];

    if (workspace) args.push('--cd', workspace.cwd, ...workspace.writableRoots.flatMap(dir => ['--add-dir', dir]));

    // ADR-0053 / ADR-0181 — same gate the claude-code path gets, same scripts.
    // `-c key=value` parses the value as TOML, so the hook table is emitted in
    // TOML inline syntax (JSON's `"k": v` would not parse). Paths go through
    // JSON.stringify, which is a valid TOML basic string for our escaping needs.
    // AGENT_PERMS=bypass drops the hooks exactly like it does for claude.
    const agentPermsMode = (process.env.AGENT_PERMS || 'hook').toLowerCase();
    if (permissionsFailClosed && agentPermsMode === 'bypass') return reject(bypassRefused());
    if (agentPermsMode !== 'bypass') {
      const cmd = (script) => JSON.stringify(`node ${script}`);
      args.push(
        '--dangerously-bypass-hook-trust',
        '-c', `hooks.PreToolUse=[{matcher="*",hooks=[{type="command",command=${cmd(AGENT_PERMISSION_HOOK)}}]}]`,
        '-c', `hooks.Stop=[{matcher="*",hooks=[{type="command",command=${cmd(AGENT_RESERVATION_RELEASE_HOOK)}}]}]`,
      );
    }

    const codexModel = process.env.CODEX_CLI_MODEL
      || (model && /^gpt-6-astra/i.test(model) ? model : null);
    if (codexModel) {
      args.push('-m', codexModel);
    }

    // Bind the CRM MCP process to this job; Codex filters inherited environment.
    // https://learn.chatgpt.com/docs/extend/mcp?surface=cli
    // The ops gate token (services/ops/opsGate.js) must reach the MCP process the
    // same way: it is empty unless this agent holds a live grant in this space.
    for (const [key, value] of Object.entries({ AGENT_ID: agentId, MCP_SPACE_ID: spaceId, MCP_JOB_ID: jobId, ...codexOpsGateEnv })) {
      args.push('-c', `mcp_servers.godcrm.env.${key}=${JSON.stringify(String(value ?? ''))}`);
    }
    const codexBin = process.env.CODEX_CLI_BIN || 'codex';

    apiLogger.info({
      requestedModel: model || null,
      passedModel: codexModel,
      promptLen: fullPrompt.length,
      systemPromptLength: systemPrompt ? systemPrompt.length : 0,
      agentId: agentId ?? null,
      spaceId: spaceId ?? null,
      bin: codexBin,
      workspace: workspace?.cwd ?? null,
      workspaceBase: workspace?.baseSha ?? null,
      permsMode: agentPermsMode,
      hookPath: agentPermsMode === 'bypass' ? null : AGENT_PERMISSION_HOOK,
    }, 'Spawning OpenAI Codex CLI (exec --json)');

    const childEnv = { ...process.env, CI: 'true', TERM: 'dumb', NO_COLOR: '1' };
    // Codex must not inherit this process's Claude session markers.
    Object.keys(childEnv).forEach(key => {
      if (key.startsWith('CLAUDE')) delete childEnv[key];
    });
    if (agentId != null) childEnv.AGENT_ID = String(agentId);
    if (spaceId != null) childEnv.SPACE_ID = String(spaceId);
    // Tells agent-permission-hook.js to speak Codex's dialect: silence on
    // allow (Codex logs "PreToolUse Failed" on an explicit allow), JSON on deny.
    childEnv.AGENT_HOOK_DIALECT = 'codex';
    if (permissionsFailClosed) childEnv.AGENT_PERMS_FAIL_CLOSED = '1';

    // Last check before the fork: an abort that raced the preparation above must not spawn.
    if (signal?.aborted) return reject(abortError(signal));

    const child = spawn(codexBin, args, {
      cwd: workspace?.cwd || process.cwd(),
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // process group — kill MCP children together
    });
    workspaceCanRelease = false;
    child.unref();
    bindAbort(signal, child);

    if (child.stdin) {
      child.stdin.write(fullPrompt);
      child.stdin.end();
    }

    if (child.pid) {
      trackChildProcess(child.pid, {
        child,
        label: `codex:${codexModel || 'default'}`,
        startedAt: Date.now(),
      });
    }
    if (onSpawn && child.pid) {
      try { onSpawn(child.pid); } catch { /* ignore callback errors */ }
    }

    let buffer = '';
    let stderr = '';
    let lastAgentMessage = '';
    let usage = null;
    let turnError = null;

    // ── codex JSONL → Claude stream-json translation ──
    const emitAssistant = (block) => {
      if (!onEvent) return;
      try { onEvent({ type: 'assistant', message: { content: [block] } }); } catch { /* ignore */ }
    };
    const emitToolResult = (toolUseId, content) => {
      if (!onEvent) return;
      try {
        onEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] } });
      } catch { /* ignore */ }
    };

    const handleEvent = (event) => {
      const item = event.item || {};

      if (event.type === 'item.started') {
        if (item.type === 'mcp_tool_call') {
          emitAssistant({
            type: 'tool_use', id: item.id,
            name: item.server ? `${item.server}/${item.tool}` : item.tool,
            input: item.arguments || {},
          });
        } else if (item.type === 'command_execution') {
          emitAssistant({ type: 'tool_use', id: item.id, name: 'shell', input: { command: item.command } });
        } else if (item.type === 'web_search') {
          emitAssistant({ type: 'tool_use', id: item.id, name: 'web_search', input: { query: item.query } });
        }
        return;
      }

      if (event.type === 'item.completed') {
        if (item.type === 'agent_message' && item.text) {
          lastAgentMessage = item.text;
          emitAssistant({ type: 'text', text: item.text });
        } else if (item.type === 'reasoning' && item.text) {
          emitAssistant({ type: 'text', text: item.text });
        } else if (item.type === 'mcp_tool_call') {
          const payload = item.error
            ? `ERROR: ${typeof item.error === 'string' ? item.error : JSON.stringify(item.error)}`
            : JSON.stringify(item.result ?? '');
          emitToolResult(item.id, payload);
        } else if (item.type === 'command_execution') {
          emitToolResult(item.id, String(item.aggregated_output ?? item.stdout ?? ''));
        }
        return;
      }

      if (event.type === 'turn.completed' && event.usage) {
        usage = event.usage;
      } else if (event.type === 'turn.failed' || event.type === 'error') {
        turnError = event.error?.message || event.message || 'Codex turn failed';
      }
    };

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleEvent(JSON.parse(line)); } catch { /* not a JSON line — ignore */ }
      }
    });

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (err) => {
      try { fs.unlinkSync(lastMessageFile); } catch { /* ignore */ }
      apiLogger.error({ err }, 'Failed to spawn Codex CLI');
      reject(new Error(`Failed to spawn Codex CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      workspaceCanRelease = true;
      if (child.pid) {
        untrackChildProcess(child.pid);
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group already dead */ }
      }

      if (buffer.trim()) {
        try { handleEvent(JSON.parse(buffer)); } catch { /* ignore */ }
      }

      // -o holds the agent's final message; the last agent_message event is the
      // fallback when the file never got written (killed mid-turn).
      let content = '';
      try {
        content = fs.readFileSync(lastMessageFile, 'utf-8').trim();
      } catch { /* ignore */ }
      try { fs.unlinkSync(lastMessageFile); } catch { /* ignore */ }
      if (!content) content = lastAgentMessage.trim();

      if (code !== 0 && !content) {
        const detail = turnError || (stderr || '').trim() || 'No error output captured';
        apiLogger.warn({ code, stderr: (stderr || '').trim().substring(0, 500), turnError },
          'Codex CLI exited with non-zero code');
        reject(new Error(`Codex CLI exited with code ${code}: ${detail}`));
        return;
      }

      if (!content) content = 'Agent process was interrupted.';

      const promptTokens = usage?.input_tokens || 0;
      const completionTokens = usage?.output_tokens || 0;

      apiLogger.info({
        contentLength: content.length,
        model: codexModel || 'config-default',
        promptTokens, completionTokens,
        cachedInputTokens: usage?.cached_input_tokens || 0,
      }, 'Codex CLI completed');

      resolve({
        content,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
        // The CLI does not echo a resolved model id in --json, so this is the
        // requested id (or the config default) — flagged as such, not a fact.
        model: codexModel || 'gpt-6-astra',
        requestedModel: model || null,
        modelSource: 'requested',
        finishReason: 'end_turn',
        // ChatGPT subscription seat, not metered API billing.
        costUsd: 0,
      });
    });

    // Same rule as the Claude path (Bug 1552/228714): caller-resolved, 120 min default.
    const CLI_TIMEOUT_MS = Number(params.runTimeoutMs) > 0 ? Number(params.runTimeoutMs) : 120 * 60 * 1000;
    const timeoutMin = Math.round(CLI_TIMEOUT_MS / 60000);
    const timeout = setTimeout(() => {
      apiLogger.warn(`Codex CLI timeout reached (${timeoutMin} min), killing process tree`);
      killProcessTree(child.pid, child);
      try { fs.unlinkSync(lastMessageFile); } catch { /* ignore */ }
      reject(new Error(`Codex CLI timeout (${timeoutMin} min)`));
    }, CLI_TIMEOUT_MS);

    child.on('close', () => clearTimeout(timeout));
  }).finally(async () => {
    if (workspace && workspaceCanRelease) await workspace.release().catch(err => {
      apiLogger.warn({ err: err.message, workspace: workspace.cwd }, 'Codex workspace retained; cleanup failed');
    });
  });
}

/**
 * Kimi Code 2.3.1 print-mode adapter; JSONL is translated to our CLI event contract.
 * Requires verified PreToolUse + Stop hooks in KIMI_CODE_HOME/config.toml at deploy.
 * Kimi itself fails open on hook crashes, so strict fail-closed callers are refused.
 * https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html
 */
const kimiMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('assistant'), content: z.string().nullish(), tool_calls: z.array(z.object({
    id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }),
  })).optional() }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string(), content: z.unknown() }),
]);
export async function executeKimiCli(params) {
  const { model, messages, systemPrompt, maxTurns, onEvent, onSpawn, agentId, spaceId, jobId, signal, permissionsFailClosed } = params;
  if (signal?.aborted) throw abortError(signal);
  if (permissionsFailClosed) throw new Error('Kimi hooks cannot guarantee fail-closed execution');
  if ((process.env.AGENT_PERMS || 'hook').toLowerCase() === 'bypass') throw new Error('Kimi permission bypass is not supported');
  const { spawn } = await import('child_process');

  // MCP-kind connectors + ops profiles — same gate contract as the other adapters.
  const mcpGateEnv = await buildMcpGateEnv({ agentId, spaceId, jobId });
  const opsGateEnv = await buildOpsGateEnv({ agentId, spaceId, jobId });

  // Build prompt (same shape as the codex path: system instructions prefix +
  // flat conversation history + last user message).
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]?.content || '';
  const historyMessages = nonSystemMessages.slice(0, -1);

  const buildPrompt = (hist) => {
    let prompt = lastMessage;
    if (hist.length > 0) {
      const historyText = hist
        .map(m => `[${m.role === 'assistant' ? 'Assistant' : 'User'}]: ${m.content}`)
        .join('\n\n');
      prompt = `<conversation_history>\n${historyText}\n</conversation_history>\n\n[User]: ${lastMessage}`;
    }
    if (systemPrompt) {
      prompt = `<system_instructions>\n${systemPrompt}\n</system_instructions>\n\n${prompt}`;
    }
    return prompt;
  };

  // ARG_MAX guard: one argv string tops out ~128 KB; shed oldest history first.
  const KIMI_ARGV_BUDGET = 110 * 1024;
  let fullPrompt = buildPrompt(historyMessages);
  let shedCount = 0;
  while (Buffer.byteLength(fullPrompt) > KIMI_ARGV_BUDGET && shedCount < historyMessages.length) {
    shedCount++;
    fullPrompt = buildPrompt(historyMessages.slice(shedCount));
  }
  if (Buffer.byteLength(fullPrompt) > KIMI_ARGV_BUDGET) {
    throw new Error('Kimi CLI prompt exceeds argv byte budget after shedding history');
  } else if (shedCount > 0) {
    apiLogger.info({ promptLength: fullPrompt.length, shedCount }, 'Kimi CLI prompt shed oldest history messages to fit argv budget');
  }

  return new Promise((resolve, reject) => {
    const KIMI_KNOWN_ALIASES = new Set([
      'kimi-for-coding', 'kimi-for-coding-highspeed',
      'k3', 'k3-256k', 'k3.1-pro', 'k3.1-pro-highspeed',
    ]);
    const fleetModel = (process.env.KIMI_FLEET_MODEL || 'auto').trim();
    const storedAlias = String(model || '').trim();
    const kimiModel = fleetModel && fleetModel.toLowerCase() !== 'auto' ? fleetModel
      : KIMI_KNOWN_ALIASES.has(storedAlias) ? `kimi-code/${storedAlias}` : storedAlias || null;
    const kimiBin = process.env.KIMI_CLI_BIN || 'kimi';

    const args = ['-p', fullPrompt, '--output-format', 'stream-json'];
    if (kimiModel) args.push('-m', kimiModel);

    apiLogger.info({
      requestedModel: model || null,
      passedModel: kimiModel,
      promptLength: fullPrompt.length,
      systemPromptLength: systemPrompt ? systemPrompt.length : 0,
      agentId: agentId ?? null,
      spaceId: spaceId ?? null,
      bin: kimiBin,
      permsMode: 'hook',
    }, 'Spawning Kimi Code CLI (stream-json)');

    const childEnv = { ...process.env, CI: 'true', TERM: 'dumb', NO_COLOR: '1' };
    // Kimi must not inherit this process's Claude session markers.
    Object.keys(childEnv).forEach(key => {
      if (key.startsWith('CLAUDE')) delete childEnv[key];
    });
    childEnv.KIMI_CRM_MANAGED = '1';
    childEnv.AGENT_HOOK_DIALECT = 'kimi';
    childEnv.AGENT_PERMS_FAIL_CLOSED = '1';
    if (agentId != null) childEnv.AGENT_ID = String(agentId);
    if (spaceId != null) {
      childEnv.SPACE_ID = String(spaceId);
      childEnv.MCP_SPACE_ID = String(spaceId);
    }
    if (jobId != null) childEnv.MCP_JOB_ID = String(jobId);
    if (Number(maxTurns) > 0) childEnv.KIMI_LOOP_MAX_STEPS_PER_TURN = String(Number(maxTurns));
    Object.assign(childEnv, mcpGateEnv, opsGateEnv);

    // Last check before the fork: an abort that raced the preparation above must not spawn.
    if (signal?.aborted) return reject(abortError(signal));

    const child = spawn(kimiBin, args, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'], // prompt rides argv, no stdin needed
      detached: true, // process group — kill MCP children together
    });
    child.unref();
    bindAbort(signal, child);

    if (child.pid) {
      trackChildProcess(child.pid, {
        child,
        label: `kimi:${kimiModel}`,
        startedAt: Date.now(),
      });
    }
    if (onSpawn && child.pid) {
      try { onSpawn(child.pid); } catch { /* ignore callback errors */ }
    }

    let buffer = '';
    let stderr = '';
    let lastText = '';
    let protocolError = false;

    // ── kimi JSONL → Claude stream-json translation ──
    const emitAssistant = (block) => {
      if (!onEvent) return;
      try { onEvent({ type: 'assistant', message: { content: [block] } }); } catch { /* ignore */ }
    };

    const handleEvent = (event) => {
      if (event?.role !== 'assistant' && event?.role !== 'tool') return;
      const parsed = kimiMessageSchema.safeParse(event);
      if (!parsed.success) {
        protocolError = true;
        return;
      }
      event = parsed.data;
      if (event.role === 'assistant') {
        if (Array.isArray(event.tool_calls)) {
          for (const tc of event.tool_calls) {
            let input = {};
            try { input = JSON.parse(tc.function?.arguments || '{}'); }
            catch { input = { _raw: tc.function?.arguments }; }
            emitAssistant({
              type: 'tool_use',
              id: tc.id,
              name: tc.function?.name || 'unknown',
              input,
            });
          }
        }
        if (typeof event.content === 'string' && event.content) {
          lastText = event.content;
          emitAssistant({ type: 'text', text: event.content });
        }
      } else if (event.role === 'tool') {
        const content = typeof event.content === 'string'
          ? event.content
          : JSON.stringify(event.content ?? '');
        try {
          onEvent?.({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: event.tool_call_id, content }] } });
        } catch { /* ignore callback errors */ }
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { handleEvent(JSON.parse(line)); } catch { protocolError = true; }
      }
    });

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (err) => {
      apiLogger.error({ err }, 'Failed to spawn Kimi CLI');
      reject(new Error(`Failed to spawn Kimi CLI: ${err.message}`));
    });

    child.on('close', (code) => {
      if (child.pid) {
        untrackChildProcess(child.pid);
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group already dead */ }
      }

      if (buffer.trim()) {
        try { handleEvent(JSON.parse(buffer)); } catch { protocolError = true; }
      }

      const content = lastText.trim();
      if (code !== 0) {
        const stderrTrimmed = (stderr || '').trim();
        const errorDetail = stderrTrimmed.match(/^error:.*$/im)?.[0] || stderrTrimmed;
        apiLogger.warn({ code, stderr: stderrTrimmed.substring(0, 500) }, 'Kimi CLI exited with non-zero code');
        reject(new Error(`Kimi CLI exited with code ${code}: ${errorDetail.substring(0, 200) || 'No error output captured'}`));
        return;
      }

      if (!content || signal?.aborted || protocolError) {
        reject(new Error('Kimi CLI interrupted, returned invalid events or no assistant response'));
        return;
      }

      apiLogger.info({
        contentLength: content.length,
        model: kimiModel,
      }, 'Kimi CLI completed');

      resolve({
        content,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        // The CLI does not echo a resolved model id in stream-json — this is
        // the alias we passed, flagged as such, not a fact.
        model: kimiModel,
        requestedModel: model || null,
        modelSource: 'requested',
        finishReason: 'end_turn',
        // Kimi subscription seat, not metered API billing.
        costUsd: 0,
      });
    });

    // Same rule as the other CLI paths (Bug 1552/228714): caller-resolved, 120 min default.
    const CLI_TIMEOUT_MS = Number(params.runTimeoutMs) > 0 ? Number(params.runTimeoutMs) : 120 * 60 * 1000;
    const timeoutMin = Math.round(CLI_TIMEOUT_MS / 60000);
    const timeout = setTimeout(() => {
      apiLogger.warn(`Kimi CLI timeout reached (${timeoutMin} min), killing process tree`);
      killProcessTree(child.pid, child);
      reject(new Error(`Kimi CLI timeout (${timeoutMin} min)`));
    }, CLI_TIMEOUT_MS);

    child.on('close', () => clearTimeout(timeout));
  });
}
