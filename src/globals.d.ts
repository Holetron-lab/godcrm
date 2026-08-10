/// <reference types="vite/client" />

/** Injected by Vite `define` in vite.config */
declare const __APP_VERSION__: string;

declare module 'markdown-it';

declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      alt?: string;
      'auto-rotate'?: boolean | string;
      'camera-controls'?: boolean | string;
      'shadow-intensity'?: string;
      'environment-image'?: string;
      ar?: boolean | string;
      poster?: string;
    };
  }
}
