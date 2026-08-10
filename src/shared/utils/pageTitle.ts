/**
 * Utility for managing dynamic page titles
 */

const APP_NAME = 'Business CRM';

/**
 * Set page title with app name suffix
 * @param title - Page title (e.g., "Dashboard", "Users Table", "Project Name")
 */
export function setPageTitle(title?: string) {
  if (title) {
    document.title = `${title} - ${APP_NAME}`;
  } else {
    document.title = APP_NAME;
  }
}

/**
 * Set title for table page
 * @param tableName - Table name
 * @param projectName - Optional project name
 */
export function setTableTitle(tableName: string, projectName?: string) {
  if (projectName) {
    document.title = `${tableName} - ${projectName} - ${APP_NAME}`;
  } else {
    document.title = `${tableName} - ${APP_NAME}`;
  }
}

/**
 * Set title for dashboard page
 * @param dashboardName - Dashboard name
 * @param spaceName - Optional space name
 */
export function setDashboardTitle(dashboardName: string, spaceName?: string) {
  if (spaceName) {
    document.title = `${dashboardName} - ${spaceName} - ${APP_NAME}`;
  } else {
    document.title = `${dashboardName} - ${APP_NAME}`;
  }
}

/**
 * Set title for project page
 * @param projectName - Project name
 * @param spaceName - Optional space name
 */
export function setProjectTitle(projectName: string, spaceName?: string) {
  if (spaceName) {
    document.title = `${projectName} - ${spaceName} - ${APP_NAME}`;
  } else {
    document.title = `${projectName} - ${APP_NAME}`;
  }
}

/**
 * Set title for space page
 * @param spaceName - Space name
 */
export function setSpaceTitle(spaceName: string) {
  document.title = `${spaceName} - ${APP_NAME}`;
}

/**
 * Reset title to default
 */
export function resetPageTitle() {
  document.title = APP_NAME;
}
