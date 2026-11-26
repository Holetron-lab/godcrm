// ADR-207 §2.5–2.6 — module install plan screen.
export { InstallPlanScreen, InstallPlanView, type InstallPlanScreenProps, type InstallPlanViewProps } from './InstallPlanScreen';
export { summarizePlan, type PlanSummary } from './planSummary';
export { useInstallPlan, type InstallPlanState, type UseInstallPlanOptions } from './useInstallPlan';
export type { InstallBindings, InstallPlan, InstallResult, ModuleBlueprint } from './types';
export { exampleTables } from './bindings';
