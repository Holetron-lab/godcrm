#!/usr/bin/env node
// Read-only smoke for cleanRu() — slice-3.7c RU-crib preamble leak fix (ADR-152).
// No DB, no CLI, no channel. Pure-function assertions over the documented bug + hazards
// the marketer flagged. Exit 0 = all pass, 1 = any fail.
import { cleanRu } from '../../backend/services/schedule-trigger/action-executors.js';

let pass = 0, fail = 0;
const check = (name, input, expected) => {
  const got = cleanRu(input);
  const ok = got === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) console.log(`    in:  ${JSON.stringify(input)}\n    got: ${JSON.stringify(got)}\n    exp: ${JSON.stringify(expected)}`);
};

// 1) THE BUG Ралф caught — opus preamble on its own line before the tweet translation.
check('preamble line — exact reported leak',
  'осталась одна задача — перевести два текста. вот результат:\nприложение теперь соберёт каждый',
  'приложение теперь соберёт каждый');

// 2) Inline preamble — "вот результат: <text>" on one line.
check('preamble inline on same line',
  'вот результат: дистрибуция и есть ров',
  'дистрибуция и есть ров');

// 3) English meta-preamble.
check('english "here\'s the translation:" preamble',
  "here's the translation:\nмоя crm просто помнит",
  'моя crm просто помнит');

// 4) HAZARD (marketer's flag): a real MULTI-LINE tweet translation with NO colon in line 1
//    must survive intact — never "take the last line".
check('multi-line tweet translation — both lines kept',
  'строка один про агентов\nстрока два про контекст',
  'строка один про агентов\nстрока два про контекст');

// 5) HAZARD: a clean single-line translation with no preamble — untouched.
check('clean translation — untouched',
  'дистрибуция и есть ров, да',
  'дистрибуция и есть ров, да');

// 6) Existing behaviour preserved — label prefix + wrapping quotes still stripped.
check('label prefix + quotes still stripped',
  'твит: «приложение теперь соберёт каждый»',
  'приложение теперь соберёт каждый');

// 7) Real translation that merely CONTAINS a colon mid-sentence but no meta word — kept.
check('non-meta colon mid-line — not clobbered',
  'он сказал так: и это сработало',
  'он сказал так: и это сработало');

// 8) Empty / null safety.
check('null input → empty string', null, '');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
