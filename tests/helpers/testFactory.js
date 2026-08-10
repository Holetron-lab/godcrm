/**
 * Test Factory — Генератор уникальных тестовых данных
 * Решает проблему UNIQUE constraint fails
 */

/**
 * Генерирует уникальный суффикс
 */
export function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Создаёт тестового пользователя с уникальным email
 */
export function createTestUser(overrides = {}) {
  const id = uniqueId();
  return {
    email: `test-${id}@test.godcrm.local`,
    password: 'TestPass123!',
    name: `Test User ${id}`,
    ...overrides
  };
}

/**
 * Создаёт тестовое пространство
 */
export function createTestSpace(userId, overrides = {}) {
  const id = uniqueId();
  return {
    name: `Test Space ${id}`,
    type: 'personal',
    user_id: userId,
    ...overrides
  };
}

/**
 * Создаёт тестовый проект
 */
export function createTestProject(spaceId, overrides = {}) {
  const id = uniqueId();
  return {
    name: `Test Project ${id}`,
    space_id: spaceId,
    theme_color: '#3B82F6',
    theme_gradient: 'from-blue-500 to-blue-600',
    ...overrides
  };
}

/**
 * Создаёт тестовую таблицу
 */
export function createTestTable(projectId, overrides = {}) {
  const id = uniqueId();
  return {
    name: `Test Table ${id}`,
    project_id: projectId,
    description: 'Auto-generated test table',
    ...overrides
  };
}

/**
 * Создаёт тестовую колонку
 */
export function createTestColumn(tableId, overrides = {}) {
  const id = uniqueId();
  return {
    table_id: tableId,
    name: `column_${id}`,
    display_name: `Column ${id}`,
    column_type: 'text',
    order_index: 0,
    required: false,
    ...overrides
  };
}

/**
 * Создаёт набор стандартных колонок для таблицы
 */
export function createStandardColumns(tableId) {
  return [
    createTestColumn(tableId, { name: 'name', display_name: 'Name', column_type: 'text', required: true, order_index: 0 }),
    createTestColumn(tableId, { name: 'email', display_name: 'Email', column_type: 'email', order_index: 1 }),
    createTestColumn(tableId, { name: 'phone', display_name: 'Phone', column_type: 'phone', order_index: 2 }),
    createTestColumn(tableId, { name: 'status', display_name: 'Status', column_type: 'select', order_index: 3, config: JSON.stringify({ options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] }) }),
    createTestColumn(tableId, { name: 'amount', display_name: 'Amount', column_type: 'number', order_index: 4 })
  ];
}

/**
 * Создаёт тестовую строку
 */
export function createTestRow(tableId, data = {}, overrides = {}) {
  return {
    table_id: tableId,
    data: JSON.stringify(data),
    ...overrides
  };
}

/**
 * Создаёт тестовый dashboard
 */
export function createTestDashboard(projectId, overrides = {}) {
  const id = uniqueId();
  return {
    name: `Test Dashboard ${id}`,
    project_id: projectId,
    ...overrides
  };
}

/**
 * Создаёт тестовый виджет
 */
export function createTestWidget(dashboardId, overrides = {}) {
  const id = uniqueId();
  return {
    dashboard_id: dashboardId,
    title: `Test Widget ${id}`,
    widget_type: 'preset',
    preset_name: 'table_view',
    config: JSON.stringify({}),
    position: JSON.stringify({ x: 0, y: 0, w: 6, h: 4 }),
    ...overrides
  };
}

export default {
  createTestUser,
  createTestSpace,
  createTestProject,
  createTestTable,
  createTestColumn,
  createStandardColumns,
  createTestRow,
  createTestDashboard,
  createTestWidget,
  uniqueId
};
