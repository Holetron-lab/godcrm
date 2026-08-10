/**
 * Hook for column settings translations
 * Provides type-safe access to columnSettings translations
 */

import { useLanguage } from '@/shared/i18n/LanguageContext';
import { translations } from '@/shared/i18n/translations';

type ColumnSettingsTranslations = typeof translations.en.columnSettings;

export function useColumnSettingsTranslations() {
  const { t, language } = useLanguage();
  
  // Helper to get nested translation with type safety
  const cs = (key: string): string => t(`columnSettings.${key}`);
  
  // Get tabs with translations
  const getTabs = () => [
    { id: 'display', label: cs('tabs.display') },
    { id: 'relation', label: cs('tabs.relation') },
    { id: 'type', label: cs('tabs.type') },
    { id: 'cell', label: cs('tabs.cell') },
    { id: 'summary', label: cs('tabs.summary') },
    { id: 'backLink', label: cs('tabs.backLink') },
    { id: 'automation', label: cs('tabs.automation') },
    { id: 'access', label: cs('tabs.access') }
  ] as const;
  
  // Get color options with translations
  const getColorOptions = () => [
    { value: 'gray', label: t('colors.gray'), color: '#6b7280' },
    { value: 'red', label: t('colors.red'), color: '#ef4444' },
    { value: 'orange', label: t('colors.orange'), color: '#f97316' },
    { value: 'yellow', label: t('colors.yellow'), color: '#eab308' },
    { value: 'green', label: t('colors.green'), color: '#22c55e' },
    { value: 'blue', label: t('colors.blue'), color: '#3b82f6' },
    { value: 'purple', label: t('colors.purple'), color: '#8b5cf6' },
    { value: 'pink', label: t('colors.pink'), color: '#ec4899' },
  ];
  
  return {
    t,
    cs,
    language,
    getTabs,
    getColorOptions,
    // Common translations
    save: cs('modal.save'),
    saving: cs('modal.saving'),
    close: cs('modal.close'),
    deleteColumn: cs('modal.deleteColumn'),
    deleting: cs('modal.deleting'),
    search: cs('search'),
    nothingFound: cs('nothingFound'),
    notSelected: cs('notSelected'),
    // Field labels
    fields: {
      icon: cs('fields.icon'),
      columnName: cs('fields.columnName'),
      enterName: cs('fields.enterName'),
      columnKey: cs('fields.columnKey'),
      allowEditing: cs('fields.allowEditing'),
      keyChangeWarning: cs('fields.keyChangeWarning'),
      comment: cs('fields.comment'),
      commentPlaceholder: cs('fields.commentPlaceholder'),
      visibleColumn: cs('fields.visibleColumn'),
      showHeader: cs('fields.showHeader'),
      sizePosition: cs('fields.sizePosition'),
      order: cs('fields.order'),
      alignment: cs('fields.alignment'),
      alignLeft: cs('fields.alignLeft'),
      alignCenter: cs('fields.alignCenter'),
      alignRight: cs('fields.alignRight'),
      width: cs('fields.width'),
      textWrap: cs('fields.textWrap'),
      behavior: cs('fields.behavior'),
      requiredField: cs('fields.requiredField'),
      readOnly: cs('fields.readOnly'),
    },
    defaultValue: {
      label: cs('defaultValue.label'),
      checkboxEnabled: cs('defaultValue.checkboxEnabled'),
      checkboxDisabled: cs('defaultValue.checkboxDisabled'),
      addOptions: cs('defaultValue.addOptions'),
      useNowHint: cs('defaultValue.useNowHint'),
      unsupportedType: cs('defaultValue.unsupportedType'),
      staticValue: cs('defaultValue.staticValue'),
      formulaPlaceholder: cs('defaultValue.formulaPlaceholder'),
      useTemplateHint: cs('defaultValue.useTemplateHint'),
    },
    relation: {
      title: cs('relation.title'),
      description: cs('relation.description'),
      enabled: cs('relation.enabled'),
      disabled: cs('relation.disabled'),
      project: cs('relation.project'),
      selectProject: cs('relation.selectProject'),
      table: cs('relation.table'),
      selectTable: cs('relation.selectTable'),
      valueColumn: cs('relation.valueColumn'),
      displayColumn: cs('relation.displayColumn'),
      colorColumn: cs('relation.colorColumn'),
      selectColumn: cs('relation.selectColumn'),
      dontUse: cs('relation.dontUse'),
      createColorColumn: cs('relation.createColorColumn'),
      creatingColumn: cs('relation.creatingColumn'),
      configured: cs('relation.configured'),
      enableHint: cs('relation.enableHint'),
    },
    options: {
      title: cs('options.title'),
      formula: cs('options.formula'),
      formulaLabel: cs('options.formulaLabel'),
      availableFunctions: cs('options.availableFunctions'),
      linkedFrom: cs('options.linkedFrom'),
      configure: cs('options.configure'),
      manualOptions: cs('options.manualOptions'),
      linkToTable: cs('options.linkToTable'),
      nestedOptions: cs('options.nestedOptions'),
      addSuboption: cs('options.addSuboption'),
      addOption: cs('options.addOption'),
      newOption: cs('options.newOption'),
      suboption: cs('options.suboption'),
      collectFromData: cs('options.collectFromData'),
      exportCsv: cs('options.exportCsv'),
      importCsv: cs('options.importCsv'),
      fromTable: cs('options.fromTable'),
      importFromTable: cs('options.importFromTable'),
      columnForValue: cs('options.columnForValue'),
      columnForLabel: cs('options.columnForLabel'),
      oneTimeImportHint: cs('options.oneTimeImportHint'),
      importOptions: cs('options.importOptions'),
    },
  };
}

/**
 * Get column type label based on language
 */
export function useColumnTypeLabel() {
  const { language } = useLanguage();
  
  return (type: string, meta: { label: string; labelEn: string }) => {
    return language === 'en' ? meta.labelEn : meta.label;
  };
}

/**
 * Get column type description based on language
 */
export function useColumnTypeDescription() {
  const { language } = useLanguage();
  
  return (type: string, meta: { description: string; descriptionEn: string }) => {
    return language === 'en' ? meta.descriptionEn : meta.description;
  };
}
