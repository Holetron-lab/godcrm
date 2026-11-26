import { createRequire } from 'node:module';
import { createLogCollector, normalizeLimits } from '../limits.js';

function errorOutcome(error, deadline) {
  const message = String(error?.message || error);
  const timedOut = Date.now() >= deadline || /interrupted|script execution timed out/i.test(message);
  const outOfMemory = /out of memory|memory limit|allocation failed|invalid string length/i.test(message);
  return {
    name: timedOut ? 'codemode_timeout' : outOfMemory ? 'codemode_memory' : String(error?.name || 'Error'),
    message,
    stack_head: String(error?.stack || '').split('\n').slice(0, 5).join('\n'),
  };
}

export class IsolatedVmDriver {
  name = 'isolated-vm';

  constructor(ivm, version) {
    this.ivm = ivm;
    this.version = version;
  }

  static async create() {
    const require = createRequire(import.meta.url);
    const ivm = require('isolated-vm');
    const { version } = require('isolated-vm/package.json');
    return new IsolatedVmDriver(ivm, version);
  }

  async probe() {
    const outcome = await this.run({
      code: 'return (await crm.__probe({ value: 1 })).value + 1;',
      tools: [{ name: '__probe', description: 'Probe', parameters: { type: 'object' } }],
      limits: { timeout_ms: 1_000, memory_mb: 32, max_tool_calls: 1 },
      callTool: async (name, args) => name === '__probe' ? args : { error: 'unknown_tool' },
    });
    return {
      ok: outcome.ok && outcome.result === 2,
      version: this.version,
      abi: process.versions.modules,
      details: outcome.ok ? 'arithmetic and host call passed' : outcome.error,
    };
  }

  async run({ code, tools = [], limits: requestedLimits, callTool }) {
    const limits = normalizeLimits(requestedLimits);
    const startedAt = Date.now();
    const deadline = startedAt + limits.timeout_ms;
    const collectLog = createLogCollector();
    let isolate;
    let context;
    let toolCalls = 0;
    let result = null;
    let error = null;
    let memoryUsed = 0;
    let cpuMs = 0;
    let timer;

    try {
      isolate = new this.ivm.Isolate({ memoryLimit: limits.memory_mb });
      context = isolate.createContextSync();
      const jail = context.global;

      jail.setSync('__crm_call', new this.ivm.Reference(async (name, serializedArgs) => {
        if (toolCalls >= limits.max_tool_calls) {
          return JSON.stringify({ error: 'codemode_tool_call_limit' });
        }
        toolCalls += 1;
        const value = await callTool(name, JSON.parse(serializedArgs));
        return JSON.stringify(value === undefined ? null : value);
      }));
      jail.setSync('__codemode_sleep', new this.ivm.Reference(async (milliseconds) => {
        const remaining = Math.max(0, deadline - Date.now());
        const delay = Math.max(0, Math.min(Number(milliseconds) || 0, remaining));
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        return null;
      }));
      jail.setSync('__codemode_log', new this.ivm.Callback((level, serializedValues) => {
        collectLog(level, JSON.parse(serializedValues));
      }));

      const metadata = tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters || { type: 'object', properties: {} },
      }));
      const bootstrap = `
        globalThis.crm = Object.create(null);
        const __codemodeTools = ${JSON.stringify(metadata)};
        for (const tool of __codemodeTools) {
          crm[tool.name] = (args = {}) => JSON.parse(__crm_call.applySyncPromise(
            undefined,
            [tool.name, JSON.stringify(args)]
          ));
        }
        crm.run_crm_script = async () => ({ error: 'codemode_nested_forbidden' });
        crm.tools = () => __codemodeTools.map(({ name, description }) => ({ name, description }));
        crm.describe = (name) => __codemodeTools.find((tool) => tool.name === name) || null;
        globalThis.console = Object.create(null);
        for (const level of ['log', 'warn', 'error']) {
          console[level] = (...values) => __codemode_log(level, JSON.stringify(values.map((value) => value === undefined ? null : value)));
        }
        globalThis.setTimeout = (callback, milliseconds = 0) => {
          __codemode_sleep.applySyncPromise(undefined, [milliseconds]);
          callback();
        };
      `;
      context.evalSync(bootstrap, { timeout: limits.timeout_ms });

      const source = `(async () => {
        const __codemodeValue = await (async () => {\n${code}\n})();
        return JSON.stringify({ value: __codemodeValue === undefined ? null : __codemodeValue });
      })()`;
      const script = isolate.compileScriptSync(source);
      const execution = script.run(context, { timeout: limits.timeout_ms, promise: true });
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error(`Script execution exceeded ${limits.timeout_ms} ms`);
          timeoutError.name = 'codemode_timeout';
          reject(timeoutError);
        }, limits.timeout_ms);
      });
      const serialized = await Promise.race([execution, timeout]);
      result = JSON.parse(serialized).value;
    } catch (caught) {
      error = errorOutcome(caught, deadline);
    } finally {
      clearTimeout(timer);
      if (isolate && !isolate.isDisposed) {
        try {
          const heap = isolate.getHeapStatisticsSync();
          memoryUsed = (heap.used_heap_size || 0) + (heap.externally_allocated_size || 0);
          cpuMs = Number(isolate.cpuTime) / 1_000_000;
        } catch {
          memoryUsed = 0;
        }
        isolate.dispose();
      }
      if (context) context.release();
    }

    return {
      ok: !error,
      result: error ? null : result,
      logs: collectLog.lines(),
      stats: {
        driver: this.name,
        tool_calls: toolCalls,
        wall_ms: Date.now() - startedAt,
        cpu_ms: Math.round(cpuMs),
        memory_peak_mb: Math.round(memoryUsed / 1024 / 1024 * 10) / 10,
      },
      ...(error ? { error } : {}),
    };
  }
}
