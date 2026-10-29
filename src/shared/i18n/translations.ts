// Registry barrel — assembled from per-namespace modules in ./modules/*.
// See ADR-184 (doc 206545). Do NOT add strings here: edit the namespace module.
import { headerActions } from './modules/headerActions';
import { statusBar } from './modules/statusBar';
import { projectTablesNav } from './modules/projectTablesNav';
import { settingsPage } from './modules/settingsPage';
import { dashboardPage } from './modules/dashboardPage';
import { spaceDashboard } from './modules/spaceDashboard';
import { rateLimitSettings } from './modules/rateLimitSettings';
import { nav } from './modules/nav';
import { layout } from './modules/layout';
import { projects } from './modules/projects';
import { spaces } from './modules/spaces';
import { home } from './modules/home';
import { auth } from './modules/auth';
import { dashboard } from './modules/dashboard';
import { tables } from './modules/tables';
import { users } from './modules/users';
import { settings } from './modules/settings';
import { smtp } from './modules/smtp';
import { table } from './modules/table';
import { systemColumns } from './modules/systemColumns';
import { tableToolbar } from './modules/tableToolbar';
import { rowActions } from './modules/rowActions';
import { columnConfig } from './modules/columnConfig';
import { columnHeader } from './modules/columnHeader';
import { tableEditing } from './modules/tableEditing';
import { tablePagination } from './modules/tablePagination';
import { emojiPicker } from './modules/emojiPicker';
import { bulkReplace } from './modules/bulkReplace';
import { notFound } from './modules/notFound';
import { error } from './modules/error';
import { common } from './modules/common';
import { kanban } from './modules/kanban';
import { dashboards } from './modules/dashboards';
import { dataSources } from './modules/dataSources';
import { widgets } from './modules/widgets';
import { schemaEditor } from './modules/schemaEditor';
import { colors } from './modules/colors';
import { columnSettings } from './modules/columnSettings';
import { columnTypes } from './modules/columnTypes';
import { dateSettings } from './modules/dateSettings';
import { publicForm } from './modules/publicForm';
import { userAccess } from './modules/userAccess';
import { documents } from './modules/documents';
import { aiChat } from './modules/aiChat';
import { mail } from './modules/mail';

export const translations = {
  en: {
    headerActions: headerActions.en,
    statusBar: statusBar.en,
    projectTablesNav: projectTablesNav.en,
    settingsPage: settingsPage.en,
    dashboardPage: dashboardPage.en,
    spaceDashboard: spaceDashboard.en,
    rateLimitSettings: rateLimitSettings.en,
    nav: nav.en,
    layout: layout.en,
    projects: projects.en,
    spaces: spaces.en,
    home: home.en,
    auth: auth.en,
    dashboard: dashboard.en,
    tables: tables.en,
    users: users.en,
    settings: settings.en,
    smtp: smtp.en,
    table: table.en,
    systemColumns: systemColumns.en,
    tableToolbar: tableToolbar.en,
    rowActions: rowActions.en,
    columnConfig: columnConfig.en,
    columnHeader: columnHeader.en,
    tableEditing: tableEditing.en,
    tablePagination: tablePagination.en,
    emojiPicker: emojiPicker.en,
    bulkReplace: bulkReplace.en,
    notFound: notFound.en,
    publicForm: publicForm.en,
    error: error.en,
    common: common.en,
    kanban: kanban.en,
    dashboards: dashboards.en,
    dataSources: dataSources.en,
    widgets: widgets.en,
    schemaEditor: schemaEditor.en,
    colors: colors.en,
    columnSettings: columnSettings.en,
    columnTypes: columnTypes.en,
    dateSettings: dateSettings.en,
    userAccess: userAccess.en,
    documents: documents.en,
    aiChat: aiChat.en,
    mail: mail.en,
  },
  ru: {
    headerActions: headerActions.ru,
    statusBar: statusBar.ru,
    projectTablesNav: projectTablesNav.ru,
    settingsPage: settingsPage.ru,
    dashboardPage: dashboardPage.ru,
    spaceDashboard: spaceDashboard.ru,
    rateLimitSettings: rateLimitSettings.ru,
    nav: nav.ru,
    layout: layout.ru,
    projects: projects.ru,
    spaces: spaces.ru,
    home: home.ru,
    auth: auth.ru,
    dashboard: dashboard.ru,
    tables: tables.ru,
    users: users.ru,
    settings: settings.ru,
    smtp: smtp.ru,
    table: table.ru,
    systemColumns: systemColumns.ru,
    tableToolbar: tableToolbar.ru,
    rowActions: rowActions.ru,
    columnConfig: columnConfig.ru,
    columnHeader: columnHeader.ru,
    tableEditing: tableEditing.ru,
    tablePagination: tablePagination.ru,
    emojiPicker: emojiPicker.ru,
    bulkReplace: bulkReplace.ru,
    notFound: notFound.ru,
    publicForm: publicForm.ru,
    error: error.ru,
    common: common.ru,
    kanban: kanban.ru,
    dashboards: dashboards.ru,
    dataSources: dataSources.ru,
    widgets: widgets.ru,
    schemaEditor: schemaEditor.ru,
    colors: colors.ru,
    columnSettings: columnSettings.ru,
    columnTypes: columnTypes.ru,
    dateSettings: dateSettings.ru,
    userAccess: userAccess.ru,
    documents: documents.ru,
    aiChat: aiChat.ru,
    mail: mail.ru,
  },
} as const;

export type SupportedLanguage = keyof typeof translations;
