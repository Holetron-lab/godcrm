/**
 * files.original_name was stored mojibaked for every non-ASCII upload: multer's
 * default param charset is latin1, so the raw UTF-8 bytes of "Копия.xlsx" landed
 * as "ÐÐ¾Ð¿Ð¸Ñ.xlsx". The upload route now passes defParamCharset: 'utf8';
 * this migration repairs the rows written before that fix.
 *
 * A row is repaired only when its name reads as latin1-decoded UTF-8 and the
 * re-decoded string is valid (no U+FFFD). Names that already hold real
 * Cyrillic contain code points above U+00FF and are left untouched.
 */

const LATIN1_RANGE = /^[^\u0100-\uFFFF]*$/;
const UTF8_LEAD_PAIR = /[Â-ô][\u0080-¿]/;

export function decodeMojibake(name) {
  if (typeof name !== 'string' || !LATIN1_RANGE.test(name) || !UTF8_LEAD_PAIR.test(name)) return null;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  if (decoded === name || decoded.includes('�')) return null;
  return decoded;
}

export async function up(knex) {
  const rows = await knex('files').select('id', 'original_name').whereRaw(`original_name ~ '[Â-ô][\u0080-¿]'`);
  for (const row of rows) {
    const fixed = decodeMojibake(row.original_name);
    if (fixed) await knex('files').where({ id: row.id }).update({ original_name: fixed });
  }
}

export async function down() {
  // Data repair only; the mangled spelling is not worth restoring.
}
