import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  format, differenceInDays, differenceInHours, differenceInMinutes,
  addDays, addHours, addMinutes, addWeeks, addMonths as addMonthsFn,
  startOfMonth, endOfMonth, startOfWeek,
  eachDayOfInterval, eachHourOfInterval, eachWeekOfInterval, eachMinuteOfInterval,
  parseISO, isSameDay, isWithinInterval
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { getDefaultColor } from './timeline-constants';
import { useLaneAxis, type RelationDataMap } from '../_shared/useLaneAxis';
import type {
  TimelineItem, TimelineRowData, TimeScale, ColorOption, DayInfo, ColumnInfo
} from './types';

interface UseTimelineDataParams {
  widget: { config: Record<string, unknown> };
  data: TimelineRowData[] | undefined;
  columnsInfo: ColumnInfo[];
  timeScale: TimeScale;
  viewStartDate: Date;
  collapsedItems: Set<string>;
  collapsedGroups: Set<string>;
  selectedGroups: Set<string>;
  relationData?: RelationDataMap;
}

export function useTimelineData({
  widget,
  data,
  columnsInfo,
  timeScale,
  viewStartDate,
  collapsedItems,
  collapsedGroups,
  selectedGroups,
  relationData,
}: UseTimelineDataParams) {
  const config = widget.config as Record<string, unknown>;
  const timelineConfig = (config.timeline || {}) as Record<string, string | undefined>;

  // Calendar table configuration
  const calendarTableId = timelineConfig.calendarTableId;
  const calendarDateColumn = timelineConfig.calendarDateColumn || 'date';
  const calendarTypeColumn = timelineConfig.calendarTypeColumn || 'day_type';
  const calendarNoteColumn = timelineConfig.calendarNoteColumn || 'note';
  const calendarBgColorColumn = timelineConfig.calendarBgColorColumn || 'bg_color';
  const calendarFontColorColumn = timelineConfig.calendarFontColorColumn || 'font_color';
  const calendarTagsColumn = timelineConfig.calendarTagsColumn || 'tags';

  // Load calendar data
  const { data: calendarData } = useQuery({
    queryKey: ['calendar-table-data', calendarTableId],
    queryFn: async () => {
      if (!calendarTableId) return [];
      const result = await tablesApi.getRows(calendarTableId, 1, 1500);
      return result.rows || [];
    },
    enabled: !!calendarTableId,
    staleTime: 60000
  });

  // Process calendar data into a map for quick lookup
  const calendarMap = useMemo(() => {
    const map = new Map<string, { type: string; note?: string; bgColor?: string; fontColor?: string; tags?: string[] }>();
    if (!calendarData) return map;

    (calendarData as unknown as TimelineRowData[]).forEach((row: TimelineRowData) => {
      const dateValue = row.data?.[calendarDateColumn];
      const typeValue = row.data?.[calendarTypeColumn];
      const noteValue = row.data?.[calendarNoteColumn];
      const bgColorValue = row.data?.[calendarBgColorColumn];
      const fontColorValue = row.data?.[calendarFontColorColumn];
      const tagsValue = row.data?.[calendarTagsColumn];

      if (dateValue) {
        const dateKey = typeof dateValue === 'string'
          ? dateValue.split('T')[0]
          : format(new Date(dateValue as string | number | Date), 'yyyy-MM-dd');

        map.set(dateKey, {
          type: (typeValue as string) || 'workday',
          note: noteValue as string | undefined,
          bgColor: (bgColorValue as string) || undefined,
          fontColor: (fontColorValue as string) || undefined,
          tags: Array.isArray(tagsValue) ? tagsValue : (tagsValue ? [tagsValue as string] : [])
        });
      }
    });

    return map;
  }, [calendarData, calendarDateColumn, calendarTypeColumn, calendarNoteColumn, calendarBgColorColumn, calendarFontColorColumn, calendarTagsColumn]);

  // Get day info from calendar or defaults
  const getDayInfo = useCallback((date: Date): DayInfo => {
    const dateKey = format(date, 'yyyy-MM-dd');
    const calendarEntry = calendarMap.get(dateKey);

    if (calendarEntry) {
      return calendarEntry;
    }

    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { type: 'weekend', note: undefined, bgColor: '#FECACA', fontColor: '#DC2626', tags: [] };
    }

    return { type: 'workday', note: undefined, bgColor: null, fontColor: null, tags: [] };
  }, [calendarMap]);

  // Calculate time units based on scale
  const timeUnits = useMemo(() => {
    const viewEnd = (() => {
      switch (timeScale) {
        case 'minute': return addMinutes(viewStartDate, 60);
        case 'hour': return addHours(viewStartDate, 24);
        case 'day': {
          const isMonthStart = viewStartDate.getDate() === 1;
          if (isMonthStart) {
            return endOfMonth(viewStartDate);
          } else {
            return addDays(viewStartDate, 30);
          }
        }
        case 'week': return addWeeks(viewStartDate, 8);
        case 'month': return addMonthsFn(viewStartDate, 12);
      }
    })();

    try {
      switch (timeScale) {
        case 'minute':
          return eachMinuteOfInterval({ start: viewStartDate, end: viewEnd });
        case 'hour':
          return eachHourOfInterval({ start: viewStartDate, end: viewEnd });
        case 'day':
          return eachDayOfInterval({ start: viewStartDate, end: viewEnd });
        case 'week':
          return eachWeekOfInterval({ start: viewStartDate, end: viewEnd }, { locale: ru });
        case 'month': {
          const months: Date[] = [];
          let current = viewStartDate;
          while (current <= viewEnd) {
            months.push(startOfMonth(current));
            current = addMonthsFn(current, 1);
          }
          return months;
        }
      }
    } catch {
      return [];
    }
  }, [viewStartDate, timeScale]);

  const totalUnits = timeUnits.length;
  const viewEndDate = timeUnits[timeUnits.length - 1] || viewStartDate;

  // Auto-detect columns from data
  const autoDetectedColumns = useMemo(() => {
    if (!data || data.length === 0) return { dateCol: 'start_date', titleCol: 'title' };

    const sampleRow = data[0]?.data || {};
    const keys = Object.keys(sampleRow);

    const dateColumns: string[] = [];
    for (const key of keys) {
      const val = sampleRow[key];
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
        dateColumns.push(key);
        if (dateColumns.length >= 2) break;
      }
    }

    const titlePatterns = [/^task$/i, /^title$/i, /^name$/i, /^название$/i, /^задача$/i];
    let titleCol = 'title';
    for (const pattern of titlePatterns) {
      const found = keys.find(k => pattern.test(k));
      if (found) {
        titleCol = found;
        break;
      }
    }
    if (titleCol === 'title') {
      for (const key of keys) {
        const val = sampleRow[key];
        if (typeof val === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(val)) {
          titleCol = key;
          break;
        }
      }
    }

    const depCol = keys.find(k => /depend|связ|parent|родител/i.test(k));

    return {
      dateCol: dateColumns[0] || 'start_date',
      endDateCol: dateColumns[1],
      titleCol,
      depCol
    };
  }, [data]);

  const resolveColumn = (configValue: string | undefined, autoValue: string) => {
    if (!data || data.length === 0) return configValue || autoValue;
    const keys = Object.keys(data[0]?.data || {});
    if (configValue && keys.includes(configValue)) return configValue;
    return autoValue;
  };

  const startDateColumn = resolveColumn(
    timelineConfig.startDateColumn || (config.x_column as string | undefined),
    autoDetectedColumns.dateCol
  );
  const endDateColumn = timelineConfig.endDateColumn || autoDetectedColumns.endDateCol;
  const titleColumn = resolveColumn(
    timelineConfig.titleColumn || (config.card_title_column as string | undefined),
    autoDetectedColumns.titleCol
  );
  const groupByColumn = timelineConfig.groupByColumn || (config.group_by_column as string | undefined);
  const colorColumn = timelineConfig.colorColumn;
  const progressColumn = timelineConfig.progressColumn;
  const dependencyColumn = timelineConfig.dependsOnColumn || timelineConfig.dependencyColumn || autoDetectedColumns.depCol;
  const parentColumn = timelineConfig.parentColumn;
  const descriptionColumn = timelineConfig.descriptionColumn || (config.card_subtitle_column as string | undefined);

  const colorColInfo = colorColumn ? columnsInfo.find(c => c.name === colorColumn) : null;
  const colorOptions = colorColInfo?.config?.options || [];

  // Get group column info for colors
  const groupColInfo = groupByColumn ? columnsInfo.find(c => c.name === groupByColumn) : null;
  const groupColorOptions = groupColInfo?.config?.options || [];

  const getEventColor = (row: TimelineRowData, index: number): string => {
    if (colorColumn) {
      const colorValue = row.data?.[colorColumn];
      if (colorValue) {
        const option = colorOptions.find((o: ColorOption) => o.value === colorValue);
        if (option?.color) return option.color;
      }
    }
    if (groupByColumn) {
      const groupValue = row.data?.[groupByColumn];
      if (groupValue) {
        const option = groupColorOptions.find((o: ColorOption) => o.value === groupValue);
        if (option?.color) return option.color;
      }
    }
    return getDefaultColor(index);
  };

  // Calculate position for a date
  const getPositionForDate = useCallback((date: Date): number => {
    switch (timeScale) {
      case 'minute':
        return differenceInMinutes(date, viewStartDate) / totalUnits * 100;
      case 'hour':
        return differenceInHours(date, viewStartDate) / totalUnits * 100;
      case 'day':
        return differenceInDays(date, viewStartDate) / totalUnits * 100;
      case 'week':
        return differenceInDays(date, viewStartDate) / 7 / totalUnits * 100;
      case 'month':
        return differenceInDays(date, viewStartDate) / 30 / totalUnits * 100;
    }
  }, [timeScale, viewStartDate, totalUnits]);

  // Process items
  const items = useMemo((): TimelineItem[] => {
    if (!data || totalUnits === 0) return [];

    const rows = data as unknown as TimelineRowData[];
    return rows.map((row, rowIndex) => {
      const startValue = row.data?.[startDateColumn];
      const endValue = endDateColumn ? row.data?.[endDateColumn] : startValue;
      const title = (row.data?.[titleColumn] as string) || 'Untitled';
      const description = descriptionColumn ? (row.data?.[descriptionColumn] as string | null) : null;
      const group = groupByColumn ? (row.data?.[groupByColumn] as string | null) : null;
      const color = getEventColor(row, rowIndex);
      const progress = progressColumn ? Number(row.data?.[progressColumn]) || 0 : null;
      const dependencyTags = dependencyColumn
        ? String(row.data?.[dependencyColumn] || '').split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const parentId = parentColumn ? (row.data?.[parentColumn] as string | undefined) : undefined;

      let startDate: Date;
      let endDate: Date;

      try {
        startDate = typeof startValue === 'string' ? parseISO(startValue) : new Date(startValue as string | number | Date);
        endDate = typeof endValue === 'string' ? parseISO(endValue) : new Date(endValue as string | number | Date);
      } catch {
        return null;
      }

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return null;
      if (endDate < startDate) [startDate, endDate] = [endDate, startDate];

      return {
        id: String(row.id),
        row,
        title,
        description,
        group,
        color,
        progress,
        startDate,
        endDate,
        dependencies: dependencyTags,
        parentId,
        level: 0,
        isCollapsed: collapsedItems.has(String(row.id))
      } as TimelineItem;
    }).filter((item): item is TimelineItem => item !== null);
  }, [data, startDateColumn, endDateColumn, titleColumn, groupByColumn, colorColumn, progressColumn, dependencyColumn, parentColumn, viewStartDate, totalUnits, colorOptions, collapsedItems]);

  // Build tree structure
  const buildTree = useCallback((items: TimelineItem[]): TimelineItem[] => {
    if (!parentColumn) return items;

    const itemMap = new Map<string, TimelineItem>();
    items.forEach(item => itemMap.set(item.id, { ...item, children: [] }));

    const roots: TimelineItem[] = [];

    itemMap.forEach(item => {
      if (item.parentId && itemMap.has(item.parentId)) {
        const parent = itemMap.get(item.parentId)!;
        parent.children = parent.children || [];
        parent.children.push(item);
        item.level = (parent.level || 0) + 1;
      } else {
        roots.push(item);
      }
    });

    return roots;
  }, [parentColumn]);

  const treeItems = useMemo(() => buildTree(items), [items, buildTree]);

  // Flatten tree for display
  const flattenTree = useCallback((items: TimelineItem[], result: TimelineItem[] = []): TimelineItem[] => {
    items.forEach(item => {
      result.push(item);
      if (item.children && !item.isCollapsed) {
        flattenTree(item.children, result);
      }
    });
    return result;
  }, []);

  const displayItems = useMemo(() => {
    const flat = parentColumn ? flattenTree(treeItems) : items;

    if (selectedGroups.size > 0) {
      return flat.filter(item => !item.group || selectedGroups.has(item.group));
    }
    return flat;
  }, [treeItems, items, parentColumn, flattenTree, selectedGroups]);

  // ADR-0034 P0 — shared lane resolver. Timeline uses 'unassigned' mode so
  // rows whose group is null/missing land in a synthetic «Другое» lane
  // (matches the legacy fallback string).
  const groupColumnInfo = useMemo(
    () => (groupByColumn ? columnsInfo.find((c) => c.name === groupByColumn) : undefined),
    [columnsInfo, groupByColumn],
  );
  // Each TimelineItem carries `group` as a string; mirror it onto a synthetic
  // `data` map so useLaneAxis (which reads `row.data?.[colName]`) can resolve.
  const itemRows = useMemo(
    () =>
      displayItems.map((item) => ({
        ...item,
        data: groupByColumn ? { [groupByColumn]: item.row.data?.[groupByColumn] ?? item.group } : {},
      })),
    [displayItems, groupByColumn],
  );
  const laneAxis = useLaneAxis({
    groupByColumn: groupColumnInfo ?? groupByColumn ?? null,
    columnsInfo,
    rows: itemRows,
    relationData,
    unassignedLabel: 'Другое',
  });

  // Map original TimelineItem objects into per-lane buckets keyed by lane.key.
  const groupedItems = useMemo(() => {
    if (!groupByColumn) return { '': displayItems };
    const out: Record<string, TimelineItem[]> = {};
    laneAxis.lanes.forEach((lane) => {
      const bucket = laneAxis.rowsByLane.get(lane.key) ?? [];
      out[lane.key] = bucket.map((r) => {
        const { data: _omit, ...rest } = r as { data?: unknown } & TimelineItem;
        return rest as TimelineItem;
      });
    });
    return out;
  }, [displayItems, groupByColumn, laneAxis]);

  /**
   * lane.key (raw cell value, e.g. related row id) → human-readable label
   * (option label or related row title). Header/body use this to render
   * group titles instead of dumping the raw key.
   */
  const groupLabels = useMemo(() => {
    const map: Record<string, string> = {};
    laneAxis.lanes.forEach((lane) => {
      map[lane.key] = lane.label;
    });
    return map;
  }, [laneAxis]);

  // Bin-packing algorithm: assign items to lanes so they don't overlap
  const calculateLanes = useCallback((items: TimelineItem[]): { items: TimelineItem[], maxLane: number } => {
    if (items.length === 0) return { items: [], maxLane: 0 };

    const sorted = [...items].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const laneEndDates: number[] = [];

    sorted.forEach(item => {
      let assignedLane = -1;
      for (let i = 0; i < laneEndDates.length; i++) {
        if (item.startDate.getTime() >= laneEndDates[i]) {
          assignedLane = i;
          laneEndDates[i] = item.endDate.getTime();
          break;
        }
      }

      if (assignedLane === -1) {
        assignedLane = laneEndDates.length;
        laneEndDates.push(item.endDate.getTime());
      }

      item.lane = assignedLane;
    });

    return { items: sorted, maxLane: laneEndDates.length };
  }, []);

  // Apply bin-packing to grouped items
  const groupedItemsWithLanes = useMemo(() => {
    const result: Record<string, { items: TimelineItem[], maxLane: number }> = {};

    for (const [groupName, groupItems] of Object.entries(groupedItems)) {
      result[groupName] = calculateLanes(groupItems);
    }

    return result;
  }, [groupedItems, calculateLanes]);

  // Get all unique groups (lane keys) in the order the lane axis decided.
  const allGroups = useMemo(() => {
    if (!groupByColumn) return [];
    return laneAxis.lanes.map((lane) => lane.key);
  }, [laneAxis, groupByColumn]);

  // Check if unit is "today"
  const today = new Date();
  const isCurrentUnit = useCallback((date: Date) => {
    switch (timeScale) {
      case 'minute': return isSameDay(date, today) && date.getHours() === today.getHours() && date.getMinutes() === today.getMinutes();
      case 'hour': return isSameDay(date, today) && date.getHours() === today.getHours();
      case 'day': return isSameDay(date, today);
      case 'week': return isWithinInterval(today, { start: date, end: addDays(date, 6) });
      case 'month': return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
    }
  }, [timeScale, today]);

  return {
    // Config columns
    startDateColumn,
    endDateColumn,
    titleColumn,
    groupByColumn,
    colorColumn,
    progressColumn,
    dependencyColumn,
    parentColumn,
    descriptionColumn,
    colorOptions,
    // Calendar
    getDayInfo,
    // Time units
    timeUnits,
    totalUnits,
    viewEndDate,
    // Items
    items,
    displayItems,
    groupedItemsWithLanes,
    allGroups,
    groupLabels,
    // Position
    getPositionForDate,
    isCurrentUnit,
  };
}
