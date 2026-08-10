import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { dbRun } from './backend/database/init.js';
import { encrypt } from './backend/utils/crypto.js';

// Путь к вашему CSV файлу
const csvPath = process.argv[2] || '/root/Services Library 1c10daec7d5a80fabc82d8a2bff880fe.csv';

async function importServices() {
  console.log('📥 Importing services from CSV...');

  // Читаем CSV
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  });

  console.log(`Found ${records.length} services`);

  // Предполагаем, что первый бизнес уже создан
  // В реальном случае нужно указать ID бизнеса
  const businessId = process.argv[3] || 1;

  for (const record of records) {
    try {
      const name = record['Asset name'];
      const description = record['Description'];
      const url = record['URL'];
      const type = record['Type'];
      const status = record['Статус'] || 'active';
      const price = parseFloat(record['Price ']) || 0;
      const login = record['Логин'];
      const password = record['пароль'];
      const notes = record['Text'];

      if (!name) continue;

      await dbRun(`
        INSERT INTO services (
          business_id, name, description, url, type, status, price,
          login_encrypted, password_encrypted, notes_encrypted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        businessId,
        name,
        description,
        url,
        type,
        status,
        price,
        encrypt(login),
        encrypt(password),
        encrypt(notes)
      ]);

      console.log(`✅ Imported: ${name}`);
    } catch (err) {
      console.error(`❌ Failed to import ${record['Asset name']}: ${err.message}`);
    }
  }

  console.log('✨ Import complete!');
  process.exit(0);
}

importServices();
