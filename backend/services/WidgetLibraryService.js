/**
 * WidgetLibraryService — thin wrapper (ADR-119)
 *
 * All logic has been split into modules under ./widget-library/.
 * This file re-exports everything to maintain backward compatibility.
 */

export {
  getLibraryWidgets,
} from './widget-library/browsing.js';

export {
  getFavorites,
  getRecent,
  toggleFavorite,
  trackUsage,
} from './widget-library/user-actions.js';

export {
  addFromLibrary,
  registerWidget,
  registerWidgetSafe,
  unregisterWidget,
} from './widget-library/registration.js';
