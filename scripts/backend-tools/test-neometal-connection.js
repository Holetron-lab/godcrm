import DirectDatabaseConnector from './backend/services/DirectDatabaseConnector.js';

console.log('🧪 Testing Direct Database Connector with Neometal Database\n');

async function testNeometalConnection() {
  const config = {
    type: 'mysql2',
    host: 'localhost',
    port: 3306,
    database: 'neometal',
    user: 'root',
    password: '' // root без пароля
  };

  console.log('📋 Test Configuration:');
  console.log(JSON.stringify(config, null, 2));
  console.log('\n1️⃣ Testing connection...');

  try {
    // Test connection
    const testResult = await DirectDatabaseConnector.testConnection(config);
    console.log('✅ Test Result:', testResult);

    if (!testResult.success) {
      console.error('❌ Connection test failed');
      return;
    }

    console.log('\n2️⃣ Creating persistent connection...');
    const testId = 'neometal_test';
    await DirectDatabaseConnector.connect(testId, config);
    console.log('✅ Connected with ID:', testId);

    console.log('\n3️⃣ Getting database info...');
    const info = await DirectDatabaseConnector.getDatabaseInfo(testId);
    console.log('✅ Database Info:', info);

    console.log('\n4️⃣ Fetching all tables...');
    const tables = await DirectDatabaseConnector.getTables(testId);
    console.log(`✅ Found ${tables.length} tables`);
    console.log('First 10 tables:', tables.slice(0, 10));

    console.log('\n5️⃣ Getting schema for lvl_products table...');
    const productsSchema = await DirectDatabaseConnector.getTableSchema(testId, 'lvl_products');
    console.log('✅ lvl_products columns:', productsSchema.length);
    console.log('First 5 columns:', productsSchema.slice(0, 5).map(c => `${c.name} (${c.type})`));

    console.log('\n6️⃣ Executing SELECT query...');
    const result = await DirectDatabaseConnector.query(
      testId, 
      'SELECT id, name, price FROM lvl_products LIMIT 5'
    );
    console.log('✅ Query result:');
    console.log(result[0]); // MySQL returns [rows, fields]

    console.log('\n7️⃣ Disconnecting...');
    await DirectDatabaseConnector.disconnect(testId);
    console.log('✅ Disconnected');

    console.log('\n✨ ALL TESTS PASSED! ✨');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run test
testNeometalConnection();
