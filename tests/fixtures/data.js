/**
 * Test Fixtures — Предзаготовленные тестовые данные
 * Используются для consistent test data
 */

// =====================
// USERS
// =====================

export const testUsers = {
  admin: {
    email: 'admin@test.godcrm.local',
    password: 'AdminPass123!',
    name: 'Admin User',
    role: 'owner'
  },
  user: {
    email: 'user@test.godcrm.local',
    password: 'UserPass123!',
    name: 'Regular User',
    role: 'user'
  },
  viewer: {
    email: 'viewer@test.godcrm.local',
    password: 'ViewerPass123!',
    name: 'Viewer User',
    role: 'viewer'
  }
};

// =====================
// CONTACTS
// =====================

export const sampleContacts = [
  { name: 'Alice Johnson', email: 'alice@example.com', phone: '+1-555-0101', status: 'active' },
  { name: 'Bob Smith', email: 'bob@example.com', phone: '+1-555-0102', status: 'active' },
  { name: 'Carol Williams', email: 'carol@example.com', phone: '+1-555-0103', status: 'inactive' },
  { name: 'David Brown', email: 'david@example.com', phone: '+1-555-0104', status: 'active' },
  { name: 'Eve Davis', email: 'eve@example.com', phone: '+1-555-0105', status: 'pending' }
];

// =====================
// PRODUCTS
// =====================

export const sampleProducts = [
  { name: 'Widget A', sku: 'WA-001', price: 99.99, stock: 150, category: 'Electronics' },
  { name: 'Widget B', sku: 'WB-002', price: 149.99, stock: 75, category: 'Electronics' },
  { name: 'Widget C', sku: 'WC-003', price: 199.99, stock: 30, category: 'Premium' },
  { name: 'Gadget X', sku: 'GX-001', price: 49.99, stock: 200, category: 'Accessories' },
  { name: 'Gadget Y', sku: 'GY-002', price: 79.99, stock: 100, category: 'Accessories' }
];

// =====================
// SALES / DEALS
// =====================

export const sampleDeals = [
  { company: 'Tech Corp', value: 50000, stage: 'Qualified', probability: 60 },
  { company: 'StartupXYZ', value: 25000, stage: 'Proposal', probability: 40 },
  { company: 'Enterprise Inc', value: 100000, stage: 'Negotiation', probability: 80 },
  { company: 'Small Biz LLC', value: 10000, stage: 'New', probability: 20 },
  { company: 'Mid Market Co', value: 45000, stage: 'Won', probability: 100 }
];

// =====================
// COLUMN DEFINITIONS
// =====================

export const contactsColumns = [
  { name: 'name', display_name: 'Name', column_type: 'text', required: true },
  { name: 'email', display_name: 'Email', column_type: 'email' },
  { name: 'phone', display_name: 'Phone', column_type: 'phone' },
  { name: 'status', display_name: 'Status', column_type: 'select', config: { options: [
    { value: 'active', label: 'Active', color: 'green' },
    { value: 'inactive', label: 'Inactive', color: 'gray' },
    { value: 'pending', label: 'Pending', color: 'yellow' }
  ]}}
];

export const productsColumns = [
  { name: 'name', display_name: 'Product Name', column_type: 'text', required: true },
  { name: 'sku', display_name: 'SKU', column_type: 'text' },
  { name: 'price', display_name: 'Price', column_type: 'number', config: { format: 'currency' } },
  { name: 'stock', display_name: 'Stock', column_type: 'number' },
  { name: 'category', display_name: 'Category', column_type: 'select', config: { options: [
    { value: 'Electronics', label: 'Electronics' },
    { value: 'Premium', label: 'Premium' },
    { value: 'Accessories', label: 'Accessories' }
  ]}}
];

export const dealsColumns = [
  { name: 'company', display_name: 'Company', column_type: 'text', required: true },
  { name: 'value', display_name: 'Deal Value', column_type: 'number', config: { format: 'currency' } },
  { name: 'stage', display_name: 'Stage', column_type: 'select', config: { options: [
    { value: 'New', label: 'New', color: 'blue' },
    { value: 'Qualified', label: 'Qualified', color: 'purple' },
    { value: 'Proposal', label: 'Proposal', color: 'yellow' },
    { value: 'Negotiation', label: 'Negotiation', color: 'orange' },
    { value: 'Won', label: 'Won', color: 'green' },
    { value: 'Lost', label: 'Lost', color: 'red' }
  ]}},
  { name: 'probability', display_name: 'Probability %', column_type: 'number', config: { min: 0, max: 100 } }
];

// =====================
// WIDGET CONFIGS
// =====================

export const widgetConfigs = {
  tableView: {
    preset_name: 'table_view',
    config: {
      columns: ['name', 'email', 'status'],
      pageSize: 10,
      sortBy: 'name',
      sortOrder: 'asc'
    }
  },
  chartBar: {
    preset_name: 'chart_bar',
    config: {
      xAxis: 'stage',
      yAxis: 'value',
      aggregation: 'sum'
    }
  },
  statsCard: {
    preset_name: 'stats_card',
    config: {
      metric: 'count',
      label: 'Total Records'
    }
  }
};

export default {
  testUsers,
  sampleContacts,
  sampleProducts,
  sampleDeals,
  contactsColumns,
  productsColumns,
  dealsColumns,
  widgetConfigs
};
