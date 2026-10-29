import Editor from '@monaco-editor/react';
import type { OnMount, OnValidate } from '@monaco-editor/react';
import { useRef } from 'react';
import { useBundledMonaco } from '@/shared/hooks/useBundledMonaco';

interface MonacoCodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  onError?: (errors: string[]) => void;
  language?: 'typescript' | 'javascript';
  readOnly?: boolean;
}

export function MonacoCodeEditor({
  code,
  onChange,
  onError,
  language = 'javascript',
  readOnly = false,
}: MonacoCodeEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoReady = useBundledMonaco();

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Setup validation
    if (onError) {
      monaco.editor.onDidChangeMarkers(() => {
        const markers: Parameters<OnValidate>[0] = monaco.editor.getModelMarkers({});
        const errors = markers
          .filter((m) => m.severity === monaco.MarkerSeverity.Error)
          .map((m) => `Line ${m.startLineNumber}: ${m.message}`);
        onError(errors);
      });
    }
  };

  const handleChange = (value: string | undefined) => {
    onChange(value || '');
  };

  if (!monacoReady) return null;

  return (
    <Editor
      height="100%"
      defaultLanguage={language}
      value={code}
      onChange={handleChange}
      onMount={handleEditorDidMount}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        readOnly,
        tabSize: 2,
        wordWrap: 'on',
        folding: true,
        lineDecorationsWidth: 10,
        lineNumbersMinChars: 3,
        renderLineHighlight: 'all',
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      }}
    />
  );
}
