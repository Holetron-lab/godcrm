// TimelineWidget has been split into modular pieces under ./timeline/
// This file is kept as a thin re-export so existing imports continue to work
// (WidgetRenderer, DashboardWidgetCard, pages/widgets/WidgetViewPage, etc.).
//
// For the actual implementation, see:
//   - ./timeline/TimelineWidget.tsx  — top-level component
//   - ./timeline/TimelineHeader.tsx  — navigation + toolbar
//   - ./timeline/TimelineBody.tsx    — timeline grid + bars
//   - ./timeline/TimelineFooter.tsx  — legend + status
//   - ./timeline/useTimelineData.ts  — data processing hook
//   - ./timeline/useTimelineHandlers.ts — interaction hook
//   - ./timeline/renderDependencies.tsx — dependency arrows SVG
//   - ./timeline/types.ts            — shared types
//   - ./timeline/timeline-constants.ts — constants
export { TimelineWidget } from './timeline';
export type {
  TimelineWidgetProps,
  TimelineItem,
  TimelineRowData,
  ColumnInfo,
} from './timeline';
