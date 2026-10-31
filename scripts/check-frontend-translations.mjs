#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_ATTRIBUTES = new Set([
  'alt', 'aria-description', 'aria-label', 'aria-placeholder', 'aria-valuetext',
  'description', 'helperText', 'label', 'placeholder', 'title', 'tooltip',
]);
const UI_PROPERTIES = new Set([
  'description', 'emptyText', 'helperText', 'label', 'message', 'placeholder',
  'text', 'title', 'tooltip',
]);

const propertyName = node => {
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return '';
};

const isTranslationCall = node => {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't');
};

const hasLetters = value => /\p{L}/u.test(value);

const lineOf = (sourceFile, position) => sourceFile.getLineAndCharacterOfPosition(position).line + 1;

const touchesChangedLine = (node, sourceFile, changedLines) => {
  if (!changedLines) return true;
  const start = lineOf(sourceFile, node.getStart(sourceFile));
  const end = lineOf(sourceFile, node.getEnd());
  for (let line = start; line <= end; line += 1) {
    if (changedLines.has(line)) return true;
  }
  return false;
};

const jsxAttributeFor = node => {
  let current = node.parent;
  while (current && (ts.isJsxExpression(current) || ts.isParenthesizedExpression(current) ||
      ts.isBinaryExpression(current) || ts.isConditionalExpression(current))) current = current.parent;
  return current && ts.isJsxAttribute(current) ? current : null;
};

const isTranslationFallback = node => {
  const parent = node.parent;
  if (!ts.isBinaryExpression(parent)) return false;
  if (parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken) return false;
  const other = parent.left === node ? parent.right : parent.left;
  return isTranslationCall(other);
};

const isNotificationArgument = node => {
  const call = node.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(node)) return false;
  if (isTranslationCall(call)) return false;
  const callee = call.expression.getText();
  return /(^|\.)(alert|confirm|prompt)$/.test(callee) || /(^|\.)toast(\.|$)/.test(callee);
};

const isUserFacingString = node => {
  if (isTranslationCall(node.parent)) return false;
  if (isTranslationFallback(node)) return true;
  const attribute = jsxAttributeFor(node);
  if (attribute) return UI_ATTRIBUTES.has(propertyName(attribute.name));
  if (node.parent && ts.isJsxExpression(node.parent)) return true;
  if (ts.isPropertyAssignment(node.parent) && UI_PROPERTIES.has(propertyName(node.parent.name))) return true;
  return isNotificationArgument(node);
};

export const analyzeFrontendSource = (source, { fileName, changedLines, translations }) => {
  if (/(__tests__|\.tests?\.|\.spec\.)/.test(fileName) || fileName.startsWith('src/shared/i18n/') ||
      fileName.startsWith('src/tests/')) return [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = changedLines ? new Set(changedLines) : null;
  const issues = [];
  const missingKeys = new Set();

  const add = (node, kind, text, key) => {
    const line = lineOf(sourceFile, node.getStart(sourceFile));
    issues.push({ file: fileName, line, kind, text, ...(key ? { key } : {}) });
  };

  const visit = node => {
    if (touchesChangedLine(node, sourceFile, lines)) {
      if (ts.isJsxText(node) && hasLetters(node.getText(sourceFile))) {
        add(node, 'hardcoded', node.getText(sourceFile).trim().replace(/\s+/g, ' '));
      } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) &&
          isUserFacingString(node) && hasLetters(node.getText(sourceFile))) {
        add(node, 'hardcoded', node.getText(sourceFile));
      }

      if (isTranslationCall(node) && node.arguments.length > 0) {
        const keyNode = node.arguments[0];
        if (ts.isStringLiteral(keyNode) || ts.isNoSubstitutionTemplateLiteral(keyNode)) {
          const key = keyNode.text;
          for (const language of ['en', 'ru']) {
            const value = key.split('.').reduce((current, part) => current?.[part], translations[language]);
            if ((typeof value !== 'string' || !value.trim()) && !missingKeys.has(`${language}:${key}`)) {
              missingKeys.add(`${language}:${key}`);
              add(keyNode, 'missing-key', `missing ${language} translation`, key);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
};

const flatten = (value, prefix = '', result = new Map()) => {
  for (const [key, child] of Object.entries(value ?? {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child, fullKey, result);
    else result.set(fullKey, child);
  }
  return result;
};

export const checkDictionaryParity = translations => {
  const en = flatten(translations.en);
  const ru = flatten(translations.ru);
  const issues = [];
  for (const key of new Set([...en.keys(), ...ru.keys()])) {
    if (!en.has(key)) issues.push(`${key}: missing en translation`);
    else if (!ru.has(key)) issues.push(`${key}: missing ru translation`);
    else if (typeof en.get(key) !== 'string' || typeof ru.get(key) !== 'string' ||
        !en.get(key).trim() || !ru.get(key).trim()) {
      issues.push(`${key}: both translations must be non-empty strings`);
    }
  }
  return issues.sort();
};

export const parseChangedLines = diff => {
  const files = new Map();
  let file = null;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (fileMatch) {
      file = fileMatch[2];
      if (!files.has(file)) files.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file || line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('+')) files.get(file).add(newLine++);
    else if (line.startsWith(' ')) newLine++;
  }
  return files;
};

const loadTranslations = () => {
  const sourceRoot = path.join(ROOT, 'src', 'shared', 'i18n');
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'frontend-translations-'));
  try {
    const compile = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const sourcePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') compile(sourcePath);
        } else if (/\.tsx?$/.test(entry.name)) {
          const outputPath = path.join(temporaryRoot, path.relative(sourceRoot, sourcePath)).replace(/\.tsx?$/, '.js');
          mkdirSync(path.dirname(outputPath), { recursive: true });
          writeFileSync(outputPath, ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
          }).outputText);
        }
      }
    };
    compile(sourceRoot);
    const require = createRequire(import.meta.url);
    return require(path.join(temporaryRoot, 'translations.js')).translations;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

const git = args => {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (result.error) throw new Error(result.error.message);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout;
};

const changedFrontendFiles = baseArgument => {
  let base = /^0+$/.test(baseArgument ?? '') ? undefined : baseArgument;
  if (!base) {
    for (const candidate of [process.env.TRANSLATION_BASE, 'main', 'origin/main']) {
      if (!candidate || /^0+$/.test(candidate)) continue;
      if (spawnSync('git', ['rev-parse', '--verify', candidate], { cwd: ROOT, stdio: 'ignore' }).status === 0) {
        base = candidate;
        break;
      }
    }
  }
  if (!base) throw new Error('No base revision found; pass --base <ref>.');
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const changed = parseChangedLines(git(['diff', '--unified=0', '--no-color', mergeBase, '--', 'src']));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'src'])
    .split('\n').filter(file => /\.tsx?$/.test(file));
  for (const file of untracked) {
    const count = readFileSync(path.join(ROOT, file), 'utf8').split('\n').length;
    changed.set(file, new Set(Array.from({ length: count }, (_, index) => index + 1)));
  }
  return changed;
};

const main = () => {
  const baseIndex = process.argv.indexOf('--base');
  const translations = loadTranslations();
  const issues = [];
  for (const [file, lines] of changedFrontendFiles(baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined)) {
    if (!/\.tsx?$/.test(file) || !existsSync(path.join(ROOT, file))) continue;
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    issues.push(...analyzeFrontendSource(source, { fileName: file, changedLines: lines, translations }));
  }
  for (const issue of checkDictionaryParity(translations)) {
    issues.push({ file: 'src/shared/i18n', line: 1, kind: 'dictionary', text: issue });
  }

  if (issues.length) {
    console.error('Frontend translation gate FAILED:');
    for (const issue of issues) {
      console.error(`  ${issue.file}:${issue.line} [${issue.kind}] ${issue.text}${issue.key ? ` (${issue.key})` : ''}`);
    }
    console.error('Use t(\'namespace.key\') and add non-empty values to both en and ru dictionaries.');
    process.exitCode = 1;
  } else {
    console.log('Frontend translation gate PASSED.');
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Frontend translation gate could not run: ${error.message}`);
    process.exitCode = 2;
  }
}
