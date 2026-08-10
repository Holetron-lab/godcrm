import React from 'react';
import { logger } from '@/shared/utils/logger';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { initApiUrl } from './shared/utils/apiClient';
import { getMarketingBounceUrl, bounceToApp } from './shared/utils/marketingBounce';
import './styles/index.css';

// godcrm.ai = marketing only; app lives on app.godcrm.ai. Bounce everything except marketing surfaces.
(() => {
  if (typeof window === 'undefined') return;
  const { hostname, pathname, search, hash } = window.location;
  const target = getMarketingBounceUrl(hostname, pathname, search, hash);
  if (target) bounceToApp(target);
})();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

// Initialize API URL before rendering (for Electron desktop app)
const startApp = async () => {
  // Initialize API URL from Electron store if in desktop mode
  if (window.electronAPI) {
    await initApiUrl();
    logger.debug('Desktop mode: API URL initialized');
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

startApp();
