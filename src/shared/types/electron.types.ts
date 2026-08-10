/**
 * GOD CRM Desktop - Electron API Type Definitions
 * These types are used when the app runs inside Electron desktop wrapper
 */

// Update info from electron-updater
export interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string | { version: string; note: string }[];
}

// Download progress info
export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

// Update error info
export interface UpdateError {
  message: string;
}

export interface ElectronAPI {
  // Window controls (custom titlebar for frameless window)
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowIsMaximized: () => Promise<boolean>;

  // API URL management
  getApiUrl: () => Promise<string>;
  setApiUrl: (url: string) => Promise<boolean>;

  // Test API connection
  testApiConnection: (url: string) => Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
  }>;

  // Push the renderer's access token to main process so <img> requests for
  // /uploads, /downloads, and /api/v3/documents/snapshot* get an injected
  // Authorization header (ADR-0016 Phase 5). Pass null on logout.
  setAuthToken: (token: string | null) => Promise<void>;

  // Google OAuth via loopback (opens system browser, exchanges code for Google access_token)
  // Returns accessToken that can be used to call backend /google/token endpoint
  openGoogleOAuth: () => Promise<{
    success: boolean;
    accessToken?: string;
    error?: string;
  }>;

  // App info
  getAppInfo: () => Promise<{
    version: string;
    platform: string;
    arch: string;
    electron: string;
    chrome: string;
    node: string;
  }>;

  // Platform info (sync)
  platform: 'win32' | 'darwin' | 'linux';
  isDesktop: true;

  // Context menu - show native context menu on right-click
  // Accepts options: { isEditable, hasSelection, selectionText, linkHref, linkText, pageUrl }
  showContextMenu: (options?: { 
    isEditable?: boolean; 
    hasSelection?: boolean; 
    selectionText?: string;
    linkHref?: string;
    linkText?: string;
    pageUrl?: string;
  }) => void;

  // Open link in new tab (from context menu)
  onOpenInNewTab: (callback: (href: string) => void) => () => void;

  // Settings modal events
  onOpenSettings: (callback: () => void) => () => void;

  // Navigation events from menu
  onNavigate: (callback: (path: string) => void) => () => void;

  // ===== Remote Loader settings (ADR-029) =====
  getAppUrl: () => Promise<string>;
  setAppUrl: (url: string) => Promise<boolean>;
  getLoadMode: () => Promise<'remote' | 'local' | 'auto'>;
  setLoadMode: (mode: 'remote' | 'local' | 'auto') => Promise<boolean>;
  checkServerHealth: (url: string) => Promise<boolean>;
  reloadApp: () => Promise<boolean>;

  // ===== Auto Updater (ADR-020) =====
  
  // Check for updates manually
  checkForUpdates: () => Promise<{ success: boolean; updateInfo?: UpdateInfo; error?: string }>;
  
  // Download available update
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  
  // Quit and install downloaded update
  quitAndInstall: () => void;
  
  // Update available event
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  
  // No update available event
  onUpdateNotAvailable: (callback: (info: { version: string }) => void) => () => void;
  
  // Download progress event
  onUpdateDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
  
  // Update downloaded event
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  
  // Update error event
  onUpdateError: (callback: (error: UpdateError) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * Check if running in Electron desktop app
 */
export const isDesktopApp = (): boolean => {
  return typeof window !== 'undefined' && window.electronAPI !== undefined;
};

/**
 * Get current platform
 */
export const getPlatform = (): 'web' | 'win32' | 'darwin' | 'linux' => {
  if (isDesktopApp() && window.electronAPI) {
    return window.electronAPI.platform;
  }
  return 'web';
};
