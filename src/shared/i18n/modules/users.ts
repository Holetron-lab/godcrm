export const users = {
  en: {
    title: 'Workspace users',
    subtitle: 'Manage roles, logins, and security for every admin account.',
    listTitle: 'People in workspace',
    myWorkspace: 'My workspace',
    readOnlyBanner: 'Viewing {user} tables in read-only mode',
    readOnlyBadge: 'Read-only',
    personalSummaryTitle: 'Personal space is private',
    personalSummaryDescription: 'Only aggregated stats are visible: {tables} tables · {rows} records.',
  },
  ru: {
    title: 'Пользователи workspace',
    subtitle: 'Управляйте правами, логинами и безопасностью админов.',
    listTitle: 'Команда',
    myWorkspace: 'Моё пространство',
    readOnlyBanner: 'Просмотр таблиц пользователя {user} (только чтение)',
    readOnlyBadge: 'Только чтение',
    personalSummaryTitle: 'Личное пространство скрыто',
    personalSummaryDescription: 'Доступна только статистика: {tables} таблиц · {rows} записей.',
  },
} as const;
