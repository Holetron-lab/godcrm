import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '1.2.0'),
  },
  plugins: [
    react({
      // ADR-0058 — auto-tracks reading signal.value inside JSX/components
      babel: {
        plugins: [['module:@preact/signals-react-transform']],
      },
    }),
  ],
  // Use absolute paths for SPA routing compatibility
  // Desktop app uses file:// protocol and needs special handling
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-icons': ['lucide-react'],
          'ai-chat': [
            './src/features/ai-chat/context/AIChatContext.tsx',
          ],
          'labs': [
            './src/features/labs/LabsWidget.tsx',
          ],
        },
      }
    }
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
});
