/**
 * Widget Library — barrel re-export
 *
 * Maintains backward compatibility: any import from the old
 * WidgetLibraryService.js will resolve to the same named exports.
 */

export { getLibraryWidgets } from './browsing.js';
export { getFavorites, getRecent, toggleFavorite, trackUsage } from './user-actions.js';
export { addFromLibrary, registerWidget, registerWidgetSafe, unregisterWidget } from './registration.js';
