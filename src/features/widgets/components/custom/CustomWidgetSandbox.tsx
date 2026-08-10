import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';

/**
 * Custom Widget Sandbox - isolated execution of custom widget code
 * Uses iframe for security isolation
 */
export function CustomWidgetSandbox({ widget, data }: PresetWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!widget.code || !iframeRef.current) return;

    try {
      const iframe = iframeRef.current;
      const iframeDoc = iframe.contentDocument;
      if (!iframeDoc) return;

      // Create sandboxed React app in iframe
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <script crossorigin src="https://unpkg.com/react@19/umd/react.production.min.js"></script>
            <script crossorigin src="https://unpkg.com/react-dom@19/umd/react-dom.production.min.js"></script>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              body { margin: 0; padding: 16px; font-family: system-ui, -apple-system, sans-serif; }
              * { box-sizing: border-box; }
            </style>
          </head>
          <body>
            <div id="root"></div>
            <script type="module">
              try {
                ${widget.code}
                const data = ${JSON.stringify(data)};
                const config = ${JSON.stringify(widget.config)};
                const root = ReactDOM.createRoot(document.getElementById('root'));
                
                // Try to render default export or CustomWidget
                const Component = (typeof CustomWidget !== 'undefined') 
                  ? CustomWidget 
                  : (window.default || (() => React.createElement('div', null, 'No component exported')));
                
                root.render(React.createElement(Component, { data, config }));
              } catch (err) {
                document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: ' + err.message + '</div>';
              }
            </script>
          </body>
        </html>
      `;

      iframeDoc.open();
      iframeDoc.write(html);
      iframeDoc.close();

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [widget.code, widget.config, data]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-500">
        <AlertCircle className="w-12 h-12 mb-2" />
        <p className="text-sm font-medium">Widget Error</p>
        <p className="text-xs text-gray-500 mt-1">{error}</p>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-scripts"
      className="w-full h-full border-0"
      title={`Custom Widget: ${widget.title}`}
    />
  );
}
