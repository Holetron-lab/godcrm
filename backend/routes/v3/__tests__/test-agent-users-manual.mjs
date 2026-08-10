/**
 * Test script for agent-users functionality
 * Run with: DATABASE_TYPE=postgres node backend/routes/v3/__tests__/test-agent-users-manual.mjs
 */

import { createAgentUser, getAgentUsers, generateUserApiKey } from '../agent-users.js';
import { dbGet, dbRun } from '../../../database/connection.js';

async function main() {
  console.log('=== Agent User API Test ===\n');
  
  // First find an existing agent row
  const agent = await dbGet(`
    SELECT tr.id as row_id, tr.table_id, tr.data
    FROM table_rows tr
    JOIN universal_tables ut ON tr.table_id = ut.id
    WHERE ut.name = 'AI Agents'
    LIMIT 1
  `);

  if (!agent) {
    console.log('No agent found in database');
    process.exit(0);
  }

  const agentData = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data;
  console.log('Found agent:', agentData.name, '(row:', agent.row_id, ', table:', agent.table_id, ')');

  // Test 1: Create agent user
  console.log('\n--- Test 1: Create Agent User ---');
  const createResult = await createAgentUser({
    agentTableId: agent.table_id,
    agentRowId: agent.row_id,
    createdBy: 1
  });

  if (createResult.success) {
    console.log('✅ Created agent user:', createResult.user.email);
    console.log('   User type:', createResult.user.user_type);
    console.log('   Agent config:', createResult.user.agent_config);
  } else {
    console.log('❌ Failed to create:', createResult.error);
  }

  // Test 2: List agent users
  console.log('\n--- Test 2: List Agent Users ---');
  const listResult = await getAgentUsers();
  
  if (listResult.success) {
    console.log('✅ Found', listResult.users.length, 'agent users');
    for (const user of listResult.users) {
      console.log('  -', user.email, '(id:', user.id, ')');
    }
  } else {
    console.log('❌ Failed to list:', listResult.error);
  }

  // Test 3: Generate API key (if user was created)
  if (createResult.success) {
    console.log('\n--- Test 3: Generate API Key ---');
    const keyResult = await generateUserApiKey(createResult.user.id, {
      createdBy: 1,
      name: 'Test API Key'
    });
    
    if (keyResult.success) {
      console.log('✅ Generated API key:', keyResult.apiKey.substring(0, 20) + '...');
    } else {
      console.log('❌ Failed to generate key:', keyResult.error);
    }
  }

  // Cleanup: Delete test user
  if (createResult.success) {
    console.log('\n--- Cleanup ---');
    await dbRun(`DELETE FROM users WHERE id = $1`, [createResult.user.id]);
    console.log('Deleted test user');
  }

  console.log('\n=== Tests Complete ===');
}

main().catch(console.error);
