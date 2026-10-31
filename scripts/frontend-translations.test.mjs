import { describe, expect, it } from 'vitest';
import {
  analyzeFrontendSource,
  checkDictionaryParity,
  parseChangedLines,
} from './check-frontend-translations.mjs';

const translations = {
  en: { widgets: { hide: 'Hide in widget', nested: { title: 'Title' } } },
  ru: { widgets: { hide: 'Скрыть в виджете', nested: { title: 'Заголовок' } } },
};

describe('frontend translation gate', () => {
  it('rejects user-facing strings introduced by the widget regression', () => {
    const source = `
      const items = [{ value: 'hide', label: 'Скрыть в виджете' }];
      export const Widget = () => (
        <div title="По возрастанию" aria-label={\`Меню колонки: \${name}\`}>
          Все колонки скрыты
          <button placeholder='Search modules' />
        </div>
      );
    `;
    const issues = analyzeFrontendSource(source, {
      fileName: 'src/features/widgets/Widget.tsx',
      changedLines: [2, 4, 5, 6, 7],
      translations,
    });
    expect(issues.map(issue => issue.kind)).toEqual([
      'hardcoded',
      'hardcoded',
      'hardcoded',
      'hardcoded',
      'hardcoded',
    ]);
  });

  it('accepts translated and technical strings', () => {
    const source = `
      import { Table2 } from 'lucide-react';
      export const Widget = () => (
        <button className={'flex'} aria-label={t('widgets.hide')} onClick={() => toast.success(t('widgets.nested.title'))}>
          {t('widgets.hide')}
        </button>
      );
    `;
    expect(analyzeFrontendSource(source, {
      fileName: 'src/features/widgets/Widget.tsx',
      changedLines: [2, 3, 4, 5, 6, 7, 8],
      translations,
    })).toEqual([]);
  });

  it('rejects hardcoded translation fallbacks and conditional attribute text', () => {
    const source = `<div title={compact ? 'Short title' : t('widgets.hide') || 'Fallback'} />;`;
    const issues = analyzeFrontendSource(source, {
      fileName: 'src/Widget.tsx', changedLines: [1], translations,
    });
    expect(issues).toHaveLength(2);
    expect(issues.every(issue => issue.kind === 'hardcoded')).toBe(true);
  });

  it('requires every added translation key in both languages', () => {
    const source = `t('widgets.hide'); t('widgets.missing'); t('widgets.nested.title');`;
    const issues = analyzeFrontendSource(source, {
      fileName: 'src/features/widgets/Widget.tsx',
      changedLines: [1],
      translations,
    });
    expect(issues).toHaveLength(2);
    expect(issues.every(issue => issue.kind === 'missing-key' && issue.key === 'widgets.missing')).toBe(true);
  });

  it('checks only changed lines and skips tests', () => {
    const source = '<div>Existing text</div>;\n<div>New text</div>;';
    expect(analyzeFrontendSource(source, {
      fileName: 'src/Widget.tsx', changedLines: [99], translations,
    })).toEqual([]);
    expect(analyzeFrontendSource(source, {
      fileName: 'src/Widget.tsx', changedLines: [2], translations,
    })).toHaveLength(1);
    expect(analyzeFrontendSource(source, {
      fileName: 'src/__tests__/Widget.test.tsx', changedLines: [2], translations,
    })).toEqual([]);
    expect(analyzeFrontendSource(source, {
      fileName: 'src/tests/widget-table-fixture/main.tsx', changedLines: [2], translations,
    })).toEqual([]);
  });

  it('reports nested dictionary parity drift', () => {
    expect(checkDictionaryParity({
      en: { widgets: { hide: 'Hide', nested: { title: 'Title' } } },
      ru: { widgets: { hide: 'Скрыть', nested: {} } },
    })).toEqual(['widgets.nested.title: missing ru translation']);
  });

  it('rejects empty translations in source calls and dictionaries', () => {
    const emptyTranslations = {
      en: { widgets: { hide: '' } },
      ru: { widgets: { hide: '   ' } },
    };
    expect(analyzeFrontendSource(`t('widgets.hide');`, {
      fileName: 'src/Widget.tsx', changedLines: [1], translations: emptyTranslations,
    })).toHaveLength(2);
    expect(checkDictionaryParity(emptyTranslations)).toEqual([
      'widgets.hide: both translations must be non-empty strings',
    ]);
  });

  it('maps added diff lines to frontend files', () => {
    const parsed = parseChangedLines(`diff --git a/src/A.tsx b/src/A.tsx
--- a/src/A.tsx
+++ b/src/A.tsx
@@ -10,0 +11,2 @@
+const a = 1;
+const b = 2;
diff --git a/src/B.tsx b/src/B.tsx
--- a/src/B.tsx
+++ b/src/B.tsx
@@ -4 +5 @@
-old
+new
`);
    expect(parsed.get('src/A.tsx')).toEqual(new Set([11, 12]));
    expect(parsed.get('src/B.tsx')).toEqual(new Set([5]));
  });
});
