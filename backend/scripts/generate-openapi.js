#!/usr/bin/env node
/**
 * ADR-036: OpenAPI Spec Generator
 * 
 * Generates openapi.yaml from JSDoc annotations in route files.
 * Run: node scripts/generate-openapi.js
 * 
 * Output: docs/architecture/openapi.yaml
 */

import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { swaggerOptions } from '../swagger.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, '../../docs/architecture/openapi.json');

console.log('📚 Generating OpenAPI specification...');
console.log('   Scanning:', swaggerOptions.apis);

const spec = swaggerJsdoc(swaggerOptions);

// Count endpoints
const pathCount = Object.keys(spec.paths || {}).length;
const tagCount = (spec.tags || []).length;

// Write to file
fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf8');

console.log('');
console.log('✅ OpenAPI specification generated successfully!');
console.log('');
console.log(`   📄 Output: ${outputPath}`);
console.log(`   🔢 Paths documented: ${pathCount}`);
console.log(`   🏷️  Tags: ${tagCount}`);
console.log(`   📦 OpenAPI version: ${spec.openapi}`);
console.log(`   🏢 API version: ${spec.info.version}`);
console.log('');
console.log('   View at: /api/docs');
console.log('   JSON at: /api/openapi.json');
