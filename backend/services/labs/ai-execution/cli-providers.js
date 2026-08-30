/**
 * CLI-based AI provider execution functions (Claude Code, GitHub Copilot).
 *
 * Extracted from ai-execution-service.js
 * @see ADR-072: Claude Code CLI Integration
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { apiLogger } from '../../../utils/logger.js';
import { killProcessTree, trackChildProcess, untrackChildProcess } from './process-management.js';

// ADR-0053 Phase C3 — absolute path to the PreToolUse hook script.
// Computed once at module load (cli-providers.js → ../../../../scripts/).
const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_PERMISSION_HOOK = resolvePath(__dirname, '../../../../scripts/agent-permission-hook.js');
// ADR-0181 — Stop hook that frees this loop's write-reservations at turn end.
const AGENT_RESERVATION_RELEASE_HOOK = resolvePath(__dirname, '../../../../scripts/agent-reservation-release-hook.js');

/**
 * Execute AI request using Claude Code CLI
 * Local terminal agent with file and shell access
 * @see ADR-072: Claude Code CLI Integration
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} Execution result
 */
export async function executeClaudeCode(params) {
  const { model, messages, systemPrompt, maxTokens, maxTurns, onEvent, onSpawn, agentId, spaceId } = params;
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

    const child = spawn('claude', args, {
      cwd: process.cwd(),
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Create process group so we can kill all MCP children together
    });
    // Unref so the parent can exit without waiting for this process group
    child.unref();

    // Write prompt to stdin and close it
    // If system prompt was written to temp file, prepend it as a structured block
    if (child.stdin) {
      if (systemPromptFile) {
        // Include system prompt as part of stdin prompt (avoids CLI arg E2BIG)
        const sysPromptContent = fs.readFileSync(systemPromptFile, 'utf-8');
        child.stdin.write(`<system_instructions>\n${sysPromptContent}\n</system_instructions>\n\n${fullPrompt}`);
        // Clean up temp file
        try { fs.unlinkSync(systemPromptFile); } catch { /* ignore */ }
      } else {
        child.stdin.write(fullPrompt);
      }
      child.stdin.end();
    }

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

    // Timeout: 30 minutes (complex tasks with sub-agents need more time)
    const CLI_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const timeout = setTimeout(() => {
      apiLogger.warn('Claude CLI timeout reached (30 min), killing process tree');
      killProcessTree(child.pid, child);
      reject(new Error('Claude CLI timeout (30 min)'));
    }, CLI_TIMEOUT_MS);

    child.on('close', () => clearTimeout(timeout));
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

    // Timeout: 30 minutes (complex tasks with sub-agents need more time)
    const CLI_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const timeout = setTimeout(() => {
      apiLogger.warn('Copilot CLI timeout reached (30 min), killing process');
      killProcessTree(child.pid, child);
      try { fs.unlinkSync(usageFile); } catch { /* ignore */ }
      reject(new Error('Copilot CLI timeout (30 min)'));
    }, CLI_TIMEOUT_MS);

    child.on('close', () => clearTimeout(timeout));
  });
}
