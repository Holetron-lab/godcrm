/**
 * SCENARIO-003: Widgets Flow
 * 
 * Тестирует создание и работу с виджетами
 */

import { createApiClient } from '../helpers/apiClient.js';
import { createTestUser } from '../helpers/testFactory.js';

const BASE_URL = process.argv[2] || 'http://localhost:5001';

async function widgetsScenario() {
  const api = createApiClient(BASE_URL);
  const steps = [];
  const startTime = Date.now();

  console.log('📊 Starting Widgets Scenario...\n');

  try {
    // Step 1: Register and login
    console.log('Step 1: Setting up user...');
    const userData = createTestUser();
    const registerResult = await api.register(userData);
    
    steps.push({
      step: 'setup_user',
      success: registerResult.ok,
      data: { hasToken: !!registerResult.data?.token }
    });

    if (!registerResult.ok) {
      throw new Error('User setup failed');
    }
    console.log('  ✅ User ready\n');

    // Step 2: Create space and project
    console.log('Step 2: Creating space and project...');
    const spaceResult = await api.post('/api/v3/spaces', {
      name: 'Widget Test Space',
      type: 'business'
    });

    if (!spaceResult.ok) {
      throw new Error('Space creation failed');
    }

    const projectResult = await api.post('/api/v3/projects', {
      space_id: spaceResult.data.id,
      name: 'Widget Test Project'
    });

    steps.push({
      step: 'create_project',
      success: projectResult.ok,
      data: { projectId: projectResult.data?.id }
    });

    if (!projectResult.ok) {
      throw new Error('Project creation failed');
    }
    console.log('  ✅ Project created\n');

    // Step 3: Create a table with data
    console.log('Step 3: Creating table with data...');
    const tableResult = await api.post('/api/v3/tables', {
      project_id: projectResult.data.id,
      name: 'Sales Data'
    });

    if (tableResult.ok) {
      // Add columns
      await api.post(`/api/v3/tables/${tableResult.data.id}/columns`, {
        name: 'product',
        display_name: 'Product',
        column_type: 'text'
      });
      await api.post(`/api/v3/tables/${tableResult.data.id}/columns`, {
        name: 'amount',
        display_name: 'Amount',
        column_type: 'number'
      });

      // Add sample data
      for (let i = 0; i < 3; i++) {
        await api.post(`/api/v3/tables/${tableResult.data.id}/rows`, {
          data: { product: `Product ${i + 1}`, amount: (i + 1) * 100 }
        });
      }
    }

    steps.push({
      step: 'create_table',
      success: tableResult.ok,
      data: { tableId: tableResult.data?.id }
    });
    console.log('  ✅ Table with data created\n');

    // Step 4: Create a dashboard
    console.log('Step 4: Creating dashboard...');
    const dashboardResult = await api.post('/api/v3/dashboards', {
      project_id: projectResult.data.id,
      name: 'Analytics Dashboard'
    });

    steps.push({
      step: 'create_dashboard',
      success: dashboardResult.ok,
      data: { dashboardId: dashboardResult.data?.id }
    });

    if (!dashboardResult.ok) {
      console.log('  ⚠️ Dashboard creation failed, skipping widget tests\n');
    } else {
      console.log('  ✅ Dashboard created\n');

      // Step 5: Create a preset widget
      console.log('Step 5: Creating preset widget...');
      const presetWidgetResult = await api.post(`/api/v3/dashboards/${dashboardResult.data.id}/widgets`, {
        title: 'Sales Table',
        widget_type: 'preset',
        preset_name: 'table_view',
        config: { table_id: tableResult.data?.id },
        position: { x: 0, y: 0, w: 6, h: 4 }
      });

      steps.push({
        step: 'create_preset_widget',
        success: presetWidgetResult.ok,
        data: { widgetId: presetWidgetResult.data?.id }
      });

      if (presetWidgetResult.ok) {
        console.log('  ✅ Preset widget created\n');
      } else {
        console.log(`  ⚠️ Preset widget failed: ${JSON.stringify(presetWidgetResult.error)}\n`);
      }

      // Step 6: Create a custom widget
      console.log('Step 6: Creating custom widget...');
      const customWidgetResult = await api.post(`/api/v3/dashboards/${dashboardResult.data.id}/widgets`, {
        title: 'Custom Stats',
        widget_type: 'custom',
        code: '<div class="p-4"><h2>Total: {{count}}</h2></div>',
        position: { x: 6, y: 0, w: 6, h: 4 }
      });

      steps.push({
        step: 'create_custom_widget',
        success: customWidgetResult.ok,
        data: { widgetId: customWidgetResult.data?.id }
      });

      if (customWidgetResult.ok) {
        console.log('  ✅ Custom widget created\n');
      } else {
        console.log(`  ⚠️ Custom widget failed: ${JSON.stringify(customWidgetResult.error)}\n`);
      }

      // Step 7: Get all widgets
      console.log('Step 7: Listing widgets...');
      const widgetsResult = await api.get(`/api/v3/dashboards/${dashboardResult.data.id}/widgets`);

      steps.push({
        step: 'list_widgets',
        success: widgetsResult.ok,
        data: { count: widgetsResult.data?.length || 0 }
      });
      console.log(`  ✅ Found ${widgetsResult.data?.length || 0} widget(s)\n`);

      // Step 8: Get widget data
      if (presetWidgetResult.ok) {
        console.log('Step 8: Getting widget data...');
        const dataResult = await api.get(`/api/v3/widgets/${presetWidgetResult.data.id}/data`);

        steps.push({
          step: 'get_widget_data',
          success: dataResult.ok,
          data: { hasData: Array.isArray(dataResult.data) }
        });
        console.log('  ✅ Widget data retrieved\n');
      }
    }

  } catch (error) {
    console.error(`\n❌ Scenario failed: ${error.message}\n`);
    steps.push({ step: 'error', success: false, error: error.message });
  }

  // Summary
  const duration = Date.now() - startTime;
  const passed = steps.filter(s => s.success).length;
  const failed = steps.filter(s => !s.success).length;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Widgets Scenario Results`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Duration: ${duration}ms`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return {
    scenario: 'widgets',
    success: failed === 0,
    steps,
    duration
  };
}

// Run if called directly
widgetsScenario()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

export { widgetsScenario };
