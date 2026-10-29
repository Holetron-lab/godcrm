// Snapshot upgrades have their own ledger: none of the historical core CREATE
// migrations ran on schema.sql. Knex records this bridge only after commit.
import { up as identity } from '../../../backend/database/migrations/knex/074_adr_0159_phase1_connected_account_identity.js';
import { up as messages } from '../../../backend/database/migrations/knex/075_adr_0160_mail_messages.js';
import { up as linkage } from '../../../backend/database/migrations/knex/079_adr_0158_p2_mail_linkage.js';
import { up as starred } from '../../../backend/database/migrations/knex/080_adr_0158_p1_mail_starred.js';
import { up as attachments } from '../../../backend/database/migrations/knex/081_adr_0158_p5_mail_attachments.js';
import { up as labels } from '../../../backend/database/migrations/knex/082_adr_0158_p4_mail_labels.js';
import { up as outbox } from '../../../backend/database/migrations/knex/083_adr_0158_p6_mail_scheduled.js';
import { up as mailboxes } from '../../../backend/database/migrations/knex/089_adr_0198_mail_boxes.js';
import { up as folders } from '../../../backend/database/migrations/knex/102_mail_folders_reply_source.js';

export async function up(knex) {
  // Refuse an empty or partial bootstrap; never silently build just the mail tables.
  for (const [table, column] of [['users', 'user_type'], ['spaces', 'owner_id'],
    ['projects', 'space_id'], ['space_connectors', 'encrypted_payload'], ['_app_settings', 'value']]) {
    if (!await knex.schema.hasColumn(table, column)) {
      throw new Error(`Self-host snapshot prerequisite missing: ${table}.${column}`);
    }
  }
  // One Knex transaction covers the bridge, including the legacy identity backfill.
  // 089 supplies handle + uniqueness without 076's installation-specific agent data.
  for (const migrate of [identity, messages, linkage, starred, attachments, labels, outbox, mailboxes, folders]) {
    await migrate(knex);
  }
}

export async function down() {
  throw new Error('Self-host snapshot upgrades are forward-only. Restore the pre-upgrade backup to roll back.');
}
