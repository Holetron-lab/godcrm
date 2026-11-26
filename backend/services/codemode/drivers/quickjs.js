import { createRequire } from 'node:module';
import { newAsyncContext } from 'quickjs-emscripten';
import { createLogCollector, normalizeLimits } from '../limits.js';

const require = createRequire(import.meta.url);
const packageVersion = require('quickjs-emscripten/package.json').version;

function errorOutcome(error, deadline) {
  const dumped = error && typeof error === 'object' ? error : { message: String(error) };
  const message = String(dumped.message || dumped);
  const timedOut = Date.now() >= deadline || /interrupted/i.test(message);
  const outOfMemory = /out of memory|memory limit|allocation failed/i.test(message);
  return {
    name: timedOut ? 'codemode_timeout' : outOfMemory ? 'codemode_memory' : String(dumped.name || 'Error'),
    message,
    stack_head: String(dumped.stack || '').split('\n').slice(0, 5).join('\n'),
  };
}

export class QuickJsDriver {
  name = 'quickjs';

  async probe() {
    const outcome = await this.run({
      code: 'return (await crm.__probe({ value: 1 })).value + 1;',
      tools: [{ name: '__probe', description: 'Probe', parameters: { type: 'object' } }],
      limits: { timeout_ms: 1_000, memory_mb: 32, max_tool_calls: 1 },
      callTool: async (name, args) => name === '__probe' ? args : { error: 'unknown_tool' },
    });
    return {
      ok: outcome.ok && outcome.result === 2,
      version: packageVersion,
      abi: 'wasm32',
      details: outcome.ok ? 'arithmetic and host call passed' : outcome.error,
    };
  }

  async run({ code, tools = [], limits: requestedLimits, callTool }) {
    const limits = normalizeLimits(requestedLimits);
    const startedAt = Date.now();
    const deadline = startedAt + limits.timeout_ms;
    const cpuStarted = process.cpuUsage();
    const collectLog = createLogCollector();
    let context;
    let toolCalls = 0;
    let result = null;
    let error = null;
    let memoryUsed = 0;
    let stats;

    try {
      context = await newAsyncContext();
      context.runtime.setMemoryLimit(limits.memory_mb * 1024 * 1024);
      context.runtime.setMaxStackSize(1024 * 1024);
      context.runtime.setInterruptHandler(() => Date.now() >= deadline);

      context.newFunction('__crm_call', (nameHandle, argsHandle) => {
        const name = context.getString(nameHandle);
        const args = JSON.parse(context.getString(argsHandle));
        const deferred = context.newPromise();
        if (toolCalls >= limits.max_tool_calls) {
          context.newString(JSON.stringify({ error: 'codemode_tool_call_limit' })).consume(deferred.resolve);
          return deferred.handle;
        }
        toolCalls += 1;
        Promise.resolve()
          .then(() => callTool(name, args))
          .then((value) => JSON.stringify(value === undefined ? null : value))
          .then((serialized) => {
            if (context.alive) context.newString(serialized).consume(deferred.resolve);
          }, (caught) => {
            if (context.alive) {
              context.newError({
                name: String(caught?.name || 'Error'),
                message: String(caught?.message || caught),
              }).consume(deferred.reject);
            }
          });
        return deferred.handle;
      }).consume((handle) => context.setProp(context.global, '__crm_call', handle));

      context.newFunction('__codemode_sleep', (millisecondsHandle) => {
        const deferred = context.newPromise();
        const milliseconds = Math.max(0, Math.min(context.getNumber(millisecondsHandle), deadline - Date.now()));
        if (milliseconds > 0) {
          setTimeout(() => {
            if (context.alive) deferred.resolve();
          }, milliseconds);
        } else {
          deferred.resolve();
        }
        return deferred.handle;
      }).consume((handle) => context.setProp(context.global, '__codemode_sleep', handle));

      context.newFunction('__codemode_log', (levelHandle, valuesHandle) => {
        collectLog(context.getString(levelHandle), JSON.parse(context.getString(valuesHandle)));
      }).consume((handle) => context.setProp(context.global, '__codemode_log', handle));

      const metadata = tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} },
      }));
      const bootstrap = `
        globalThis.crm = Object.create(null);
        const __codemodeTools = ${JSON.stringify(metadata)};
        for (const tool of __codemodeTools) {
          crm[tool.name] = (args = {}) => __crm_call(tool.name, JSON.stringify(args)).then(JSON.parse);
        }
        crm.run_crm_script = async () => ({ error: 'codemode_nested_forbidden' });
        crm.tools = () => __codemodeTools.map(({ name, description }) => ({ name, description }));
        crm.describe = (name) => __codemodeTools.find((tool) => tool.name === name) || null;
        globalThis.console = Object.create(null);
        for (const level of ['log', 'warn', 'error']) {
          console[level] = (...values) => __codemode_log(level, JSON.stringify(values.map((value) => value === undefined ? null : value)));
        }
        globalThis.setTimeout = (callback, milliseconds = 0) => {
          __codemode_sleep(milliseconds).then(() => callback());
        };
      `;
      const bootstrapped = await context.evalCodeAsync(bootstrap);
      if (bootstrapped.error) {
        error = bootstrapped.error.consume(context.dump);
      } else {
        bootstrapped.value.dispose();
      }

      if (!error) {
        const source = `(async () => {\n${code}\n})().then(
          (value) => JSON.stringify({ value: value === undefined ? null : value })
        )`;
        const evaluation = await context.evalCodeAsync(source);
        if (evaluation.error) {
          error = evaluation.error.consume(context.dump);
        } else {
          const promiseHandle = evaluation.value;
          let settled = context.getPromiseState(promiseHandle);
          while (settled.type === 'pending' && Date.now() < deadline) {
            const jobs = context.runtime.executePendingJobs();
            if (jobs.error) {
              error = jobs.error.consume(context.dump);
              break;
            }
            settled = context.getPromiseState(promiseHandle);
            if (settled.type === 'pending') await new Promise((resolve) => setImmediate(resolve));
          }
          promiseHandle.dispose();
          if (!error && settled.type === 'rejected') {
            error = settled.error.consume(context.dump);
          } else if (!error && settled.type === 'pending') {
            error = { name: 'codemode_timeout', message: 'Script promise remained pending' };
          } else if (!error) {
            const serialized = context.getString(settled.value);
            settled.value.dispose();
            result = JSON.parse(serialized).value;
          }
        }
      }
    } catch (caught) {
      error = errorOutcome(caught, deadline);
    } finally {
      if (context) {
        try {
          memoryUsed = context.runtime.computeMemoryUsage().consume(context.dump).memory_used_size || 0;
        } catch {
          memoryUsed = 0;
        }
        context.dispose();
      }
      const cpu = process.cpuUsage(cpuStarted);
      stats = {
        driver: this.name,
        tool_calls: toolCalls,
        wall_ms: Date.now() - startedAt,
        cpu_ms: Math.round((cpu.user + cpu.system) / 1000),
        memory_peak_mb: Math.round(memoryUsed / 1024 / 1024 * 10) / 10,
      };
    }

    return {
      ok: !error,
      result: error ? null : result,
      logs: collectLog.lines(),
      stats,
      ...(error ? { error: errorOutcome(error, deadline) } : {}),
    };
  }
}
