// Operator entry point. No dotenv auto-loading and dry-run by default.
// Production application is performed only by the authorized migration operator.
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { hashHistoricalFile, stageHistoricalFiles } from '../backend/services/chat/historical-files.js';
import { validateHistoricalRelated } from '../backend/services/chat/historical-related.js';
import { validateArchive } from '../backend/services/chat/historical-import.js';
import { inspectHistoricalDestination, importHistoricalChat, verifyHistoricalChat, rollbackHistoricalChat } from '../backend/services/chat/historical-migration.js';
import { closeDatabase } from '../backend/database/connection.js';
import { apiLogger as logger } from '../backend/utils/logger.js';

const {values} = parseArgs({options:Object.fromEntries(['package','file-map','file-map-sha256','digest','uploads-root','database','mode','report','owner','messages','files','missing','operator-evidence','target-space','target-name','related-data','related-sha256'].map(key => [key,{type:'string'}]))});
const config = z.object({
  package:z.string().min(1),'file-map':z.string().min(1),'file-map-sha256':z.string().regex(/^[a-f0-9]{64}$/),digest:z.string().regex(/^[a-f0-9]{64}$/),
  mode:z.enum(['dry-run','apply','verify','rollback']).default('dry-run'),database:z.enum(['godcrm_test','godcrm_prod']).default('godcrm_test'),
  'uploads-root':z.string().optional(),report:z.string().min(1),owner:z.coerce.number().int().positive(),
  messages:z.coerce.number().int().positive(),files:z.coerce.number().int().nonnegative(),missing:z.coerce.number().int().nonnegative(),
  'operator-evidence':z.string().optional(),
  'target-space':z.coerce.number().int().positive().optional(),'target-name':z.string().min(1).optional(),
  'related-data':z.string().optional(),'related-sha256':z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().parse(values);

try {
  if (!!config['target-space'] !== !!config['target-name'] || !!config['related-data'] !== !!config['related-sha256']) throw new Error('Incomplete destination or related pins');
  const destination = config['target-space'] ? {id:config['target-space'],name:config['target-name']} : undefined;
  const relatedText = config['related-data'] ? await readFile(config['related-data'],'utf8') : undefined;
  const relatedDigest = config['related-sha256'];
  const related = relatedText ? validateHistoricalRelated(relatedText,relatedDigest) : null;
  if (related && !destination) throw new Error('Related data requires existing destination');
  const snapshotPath = path.join(config.package,'conversation-3496.json');
  if (await hashHistoricalFile(snapshotPath) !== config.digest || await hashHistoricalFile(config['file-map']) !== config['file-map-sha256']) throw new Error('Pinned input digest mismatch');
  const archiveText = await readFile(snapshotPath,'utf8');
  const archive = validateArchive(JSON.parse(archiveText));
  const rawMap = z.array(z.record(z.unknown())).parse(JSON.parse(await readFile(config['file-map'],'utf8')));
  const files = rawMap.map(f => f.status === 'missing_exact_path' ? {url:f.source_url,status:'missing',archive_member:null,size:null,sha256:null} : f);
  if (archive.messages.length !== config.messages || files.filter(f => f.status === 'verified_pending_upload').length !== config.files || files.filter(f => f.status === 'missing').length !== config.missing) throw new Error('Pinned count mismatch');
  if (config.mode !== 'dry-run' && !config['uploads-root']) throw new Error('Explicit uploads root is required');
  if (config.mode !== 'dry-run' && config.database === 'godcrm_prod') {
    if (!Object.values(networkInterfaces()).flat().some(n => n?.address === '<PROD_IP>')) throw new Error('Production migration is Ring 0 only');
    if (!config['operator-evidence']) throw new Error('Authorized operator evidence is required');
    z.object({operator:z.string().min(1),authorization:z.string().min(1),backup:z.string().min(1),restore_verified_at:z.string().datetime(),deployed_sha:z.string().regex(/^[a-f0-9]{40}$/),http_acl_verified:z.literal(true)}).parse(JSON.parse(await readFile(config['operator-evidence'],'utf8')));
  }
  // Verify existing uploads without rewriting on verify/rollback. Staging on
  // apply is deterministic and checksum checked, so interrupted uploads resume.
  let staged = await stageHistoricalFiles({archivePath:path.join(config.package,'files.tar'),files,digest:config.digest});
  if (config.mode !== 'dry-run') {
    for (const f of staged.files) f.path = path.join(config['uploads-root'],f.url.slice('/uploads/'.length));
    await inspectHistoricalDestination({archiveText,digest:config.digest,destination,relatedText,relatedDigest,expectedDatabase:config.database,ownerId:config.owner,expected:{messages:config.messages,files:config.files,missing:config.missing},...staged});
    if (config.mode === 'apply') staged = await stageHistoricalFiles({archivePath:path.join(config.package,'files.tar'),files,digest:config.digest,uploadsRoot:config['uploads-root']});
  }
  let report = {mode:config.mode,destination,related:related ? {rows:related.linked_rows.length,tables:related.linked_tables.length} : null,related_sha256:relatedDigest,messages:archive.messages.length,files:staged.files.length,missing:staged.missing,source_sha256:config.digest,production_written:false};
  if (config.mode !== 'dry-run') {
    const input = {archiveText,digest:config.digest,destination,relatedText,relatedDigest,expectedDatabase:config.database,ownerId:config.owner,expected:{messages:config.messages,files:config.files,missing:config.missing},...staged};
    const operation = {apply:importHistoricalChat,verify:verifyHistoricalChat,rollback:rollbackHistoricalChat}[config.mode];
    report = {...report,...await operation(input),production_written:config.database === 'godcrm_prod' && config.mode !== 'verify'};
  }
  await writeFile(config.report,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  logger.info({mode:config.mode,messages:report.messages,files:report.files,report:config.report},'Historical import operation completed');
} catch (err) {
  logger.error({error:err.message},'Historical import stopped');
  process.exitCode = 1;
} finally {await closeDatabase();}
