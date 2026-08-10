/**
 * SCENARIO-002: Health Check
 * 
 * Проверяет доступность API и базовые эндпоинты
 */

import { createApiClient } from '../helpers/apiClient.js';

const BASE_URL = process.argv[2] || 'http://localhost:5001';

async function healthScenario() {
  const api = createApiClient(BASE_URL);
  const steps = [];
  const startTime = Date.now();

  console.log('🏥 Starting Health Check Scenario...\n');

  try {
    // Step 1: Health endpoint (may require auth)
    console.log('Step 1: Checking /api/v3/system/health...');
    const healthResult = await api.health();
    
    // Health endpoint returns data OR 401 (which means server is up)
    const serverIsUp = healthResult.ok || healthResult.status === 401;
    
    steps.push({
      step: 'health_endpoint',
      success: serverIsUp,
      data: healthResult.data || { status: healthResult.status }
    });

    if (serverIsUp) {
      console.log(`  ✅ Server is responding (status: ${healthResult.status || 200})\n`);
    } else {
      console.log(`  ❌ Health endpoint failed: ${healthResult.status}\n`);
    }

    // Step 2: Check auth endpoints exist
    console.log('Step 2: Checking auth endpoints...');
    const loginResult = await api.post('/api/v3/auth/login', { email: '', password: '' });
    
    // We expect 400/401, not 404
    steps.push({
      step: 'auth_endpoints',
      success: loginResult.status !== 404,
      data: { status: loginResult.status }
    });

    if (loginResult.status !== 404) {
      console.log('  ✅ Auth endpoints exist\n');
    } else {
      console.log('  ❌ Auth endpoints not found\n');
    }

    // Step 3: Check spaces endpoint (requires auth)
    console.log('Step 3: Checking protected endpoints...');
    const spacesResult = await api.get('/api/v3/spaces');
    
    steps.push({
      step: 'protected_endpoints',
      success: spacesResult.status === 401 || spacesResult.status === 403,
      data: { status: spacesResult.status }
    });

    if (spacesResult.status === 401 || spacesResult.status === 403) {
      console.log('  ✅ Protected endpoints require auth\n');
    } else {
      console.log(`  ⚠️ Unexpected status: ${spacesResult.status}\n`);
    }

    // Step 4: Check static files
    console.log('Step 4: Checking static files...');
    const response = await fetch(`${BASE_URL}/`);
    
    steps.push({
      step: 'static_files',
      success: response.ok,
      data: { status: response.status }
    });

    if (response.ok) {
      console.log('  ✅ Static files served\n');
    } else {
      console.log(`  ⚠️ Static files: ${response.status}\n`);
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
  console.log(`📊 Health Check Results`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Duration: ${duration}ms`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return {
    scenario: 'health',
    success: failed === 0,
    steps,
    duration
  };
}

// Run if called directly
healthScenario()
  .then(result => {
    process.exit(result.success ? 0 : 1);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

export { healthScenario };
