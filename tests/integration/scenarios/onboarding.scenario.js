/**
 * SCENARIO-001: Complete Onboarding Flow
 * 
 * Тестирует полный цикл регистрации пользователя:
 * 1. Регистрация
 * 2. Создание Space
 * 3. Создание Project
 * 4. Создание Table
 * 5. Добавление строки
 */

import { createApiClient } from '../helpers/apiClient.js';
import { createTestUser, createTestTable, createTestColumn } from '../helpers/testFactory.js';

const BASE_URL = process.argv[2] || 'http://localhost:5001';

async function onboardingScenario() {
  const api = createApiClient(BASE_URL);
  const steps = [];
  
  console.log('🚀 Starting Onboarding Scenario...');
  console.log(`   URL: ${BASE_URL}`);
  
  try {
    // Step 1: Register
    console.log('\n[Step 1] Registering user...');
    const userData = createTestUser();
    const registerResult = await api.register(userData);
    
    steps.push({
      step: 'register',
      success: registerResult.ok,
      data: registerResult.data,
      error: registerResult.error
    });
    
    if (!registerResult.ok) {
      throw new Error(`Registration failed: ${registerResult.error}`);
    }
    console.log('   ✅ User registered');
    
    // Step 2: Get current user
    console.log('\n[Step 2] Getting current user...');
    const meResult = await api.me();
    
    steps.push({
      step: 'get_me',
      success: meResult.ok,
      data: meResult.data
    });
    
    if (!meResult.ok) {
      throw new Error('Failed to get current user');
    }
    console.log(`   ✅ User: ${meResult.data.email}`);
    
    // Step 3: Create Space
    console.log('\n[Step 3] Creating space...');
    const spaceResult = await api.post('/api/v3/spaces', {
      name: 'My Business',
      type: 'business'
    });
    
    steps.push({
      step: 'create_space',
      success: spaceResult.ok,
      data: spaceResult.data
    });
    
    if (!spaceResult.ok) {
      throw new Error(`Space creation failed: ${spaceResult.error}`);
    }
    console.log(`   ✅ Space created: ${spaceResult.data.id}`);
    
    // Step 4: Create Project
    console.log('\n[Step 4] Creating project...');
    const projectResult = await api.post('/api/v3/projects', {
      space_id: spaceResult.data.id,
      name: 'First Project',
      theme_color: '#3B82F6'
    });
    
    steps.push({
      step: 'create_project',
      success: projectResult.ok,
      data: projectResult.data
    });
    
    if (!projectResult.ok) {
      throw new Error(`Project creation failed: ${projectResult.error}`);
    }
    console.log(`   ✅ Project created: ${projectResult.data.id}`);
    
    // Step 5: Create Table
    console.log('\n[Step 5] Creating table...');
    const tableResult = await api.post('/api/v3/tables', {
      project_id: projectResult.data.id,
      name: 'Contacts',
      description: 'Customer contacts'
    });
    
    steps.push({
      step: 'create_table',
      success: tableResult.ok,
      data: tableResult.data
    });
    
    if (!tableResult.ok) {
      throw new Error(`Table creation failed: ${tableResult.error}`);
    }
    console.log(`   ✅ Table created: ${tableResult.data.id}`);
    
    // Step 6: Add columns
    console.log('\n[Step 6] Adding columns...');
    const columns = [
      { name: 'name', display_name: 'Name', column_type: 'text', required: true },
      { name: 'email', display_name: 'Email', column_type: 'email' },
      { name: 'phone', display_name: 'Phone', column_type: 'phone' }
    ];
    
    for (const col of columns) {
      const colResult = await api.post(`/api/v3/tables/${tableResult.data.id}/columns`, col);
      steps.push({
        step: `add_column_${col.name}`,
        success: colResult.ok
      });
      
      if (!colResult.ok) {
        console.log(`   ⚠️ Column ${col.name} failed`);
      } else {
        console.log(`   ✅ Column ${col.name} added`);
      }
    }
    
    // Step 7: Add row
    console.log('\n[Step 7] Adding row...');
    const rowResult = await api.post(`/api/v3/tables/${tableResult.data.id}/rows`, {
      data: {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1-555-0100'
      }
    });
    
    steps.push({
      step: 'add_row',
      success: rowResult.ok,
      data: rowResult.data
    });
    
    if (!rowResult.ok) {
      console.log(`   ⚠️ Row creation failed: ${rowResult.error}`);
    } else {
      console.log('   ✅ Row added');
    }
    
    // Summary
    const passedSteps = steps.filter(s => s.success).length;
    const totalSteps = steps.length;
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Result: ${passedSteps}/${totalSteps} steps passed`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return {
      success: passedSteps === totalSteps,
      steps,
      summary: `${passedSteps}/${totalSteps} steps passed`
    };
    
  } catch (error) {
    console.error(`\n❌ Scenario failed: ${error.message}`);
    return {
      success: false,
      steps,
      error: error.message
    };
  }
}

// Run if called directly
onboardingScenario().then(result => {
  process.exit(result.success ? 0 : 1);
});

export default onboardingScenario;
