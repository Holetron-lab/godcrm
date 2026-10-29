import { useEffect, useState } from 'react';
import { loader } from '@monaco-editor/react';

let configured: Promise<void> | null = null;

/**
 * Serve Monaco from our own bundle. `@monaco-editor/react` defaults to the jsdelivr CDN,
 * which the CSP (`script-src 'self'`) blocks — the editor then sits on "Loading..." forever.
 * Everything is imported lazily so the main chunk stays free of the ~4 MB editor.
 */
const configureBundledMonaco = (): Promise<void> => {
  if (!configured) {
    configured = Promise.all([
      import('monaco-editor'),
      import('monaco-editor/editor/editor.worker.js?worker'),
      import('monaco-editor/language/json/json.worker.js?worker'),
      import('monaco-editor/language/typescript/ts.worker.js?worker'),
    ]).then(([monaco, editorWorker, jsonWorker, tsWorker]) => {
      self.MonacoEnvironment = {
        getWorker: (_workerId, label) => {
          if (label === 'json') return new jsonWorker.default();
          if (label === 'typescript' || label === 'javascript') return new tsWorker.default();
          return new editorWorker.default();
        },
      };
      loader.config({ monaco });
    });
  }
  return configured;
};

/** `true` once Monaco is wired to the bundled build; render `<Editor>` only after that. */
export const useBundledMonaco = (): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    configureBundledMonaco().then(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  return ready;
};
