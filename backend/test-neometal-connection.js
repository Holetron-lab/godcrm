import { logger, apiLogger } from './utils/logger.js';
import DirectDatabaseConnector from './services/DirectDatabaseConnector.js';

/**
 * Test Neometal Database Connection
 * Real-world test with actual Neometal e-commerce database
 */

async function testNeometalConnection() {
  logger.info('🧪 Testing Neometal Database Connection\n');

  const businessId = 'neometal_test';
  
  const config = {
    type: 'mysql2',
    host: 'localhost',
    port: 3306,
    database: 'neometal',
    user: 'root',
    password: '' // empty password
  };

  try {
    // 1. Test connection
    logger.info('1️⃣ Testing connection...');
    const testResult = await DirectDatabaseConnector.testConnection(config);
    logger.info('✅ Connection result:', testResult);

    // 2. Connect
    logger.info('\n2️⃣ Creating persistent connection...');
    await DirectDatabaseConnector.connect(businessId, config);
    logger.info('✅ Connected!');

    // 3. Get database info
    logger.info('\n3️⃣ Getting database info...');
    const info = await DirectDatabaseConnector.getDatabaseInfo(businessId);
    logger.info('✅ Database info:', info);

    // 4. Get all tables
    logger.info('\n4️⃣ Fetching all tables...');
    const tables = await DirectDatabaseConnector.getTables(businessId);
    logger.info(`✅ Found ${tables.length} tables`);
    logger.info('First 10 tables:', tables.slice(0, 10));

    // 5. Get lvl_products schema
    logger.info('\n5️⃣ Getting schema for lvl_products table...');
    const schema = await DirectDatabaseConnector.getTableSchema(businessId, 'lvl_products');
    logger.info(`✅ lvl_products columns: ${schema.length}`);
    logger.info('First 10 columns:', schema.slice(0, 10).map(c => `${c.name} (${c.type})`));

    // 6. Execute SELECT query - fetch real products
    logger.info('\n6️⃣ Executing SELECT query...');
    const products = await DirectDatabaseConnector.query(
      businessId, 
      'SELECT id, title, titleshort, category_id, brand_id, date_create FROM lvl_products LIMIT 5'
    );
    logger.info(`✅ Fetched ${products[0].length} products:`);
    products[0].forEach(p => {
      logger.info(`  - [${p.id}] ${p.title} (short: ${p.titleshort})`);
    });

    // 7. Get lvl_categories schema
    logger.info('\n7️⃣ Getting categories schema...');
    const categoriesSchema = await DirectDatabaseConnector.getTableSchema(businessId, 'lvl_categories');
    logger.info(`✅ lvl_categories columns: ${categoriesSchema.length}`);
    logger.info('Columns:', categoriesSchema.map(c => c.name).join(', '));

    // 8. Get lvl_brands schema
    logger.info('\n8️⃣ Getting brands schema...');
    const brandsSchema = await DirectDatabaseConnector.getTableSchema(businessId, 'lvl_brands');
    logger.info(`✅ lvl_brands columns: ${brandsSchema.length}`);
    logger.info('Columns:', brandsSchema.map(c => c.name).join(', '));

    // 9. Count products
    logger.info('\n9️⃣ Counting total products...');
    const count = await DirectDatabaseConnector.query(businessId, 'SELECT COUNT(*) as total FROM lvl_products');
    logger.info(`✅ Total products in database: ${count[0][0].total}`);

    // 10. Disconnect
    logger.info('\n🔌 Disconnecting...');
    await DirectDatabaseConnector.disconnect(businessId);
    logger.info('✅ Disconnected successfully!');

    logger.info('\n✅ All tests passed! Neometal database integration working perfectly! 🎉');

  } catch (error) {
    logger.error('\n❌ Test failed:', error.message);
    logger.error('Stack:', error.stack);
    
    // Cleanup on error
    try {
      await DirectDatabaseConnector.disconnect(businessId);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    process.exit(1);
  }
}

// Run test
testNeometalConnection();
