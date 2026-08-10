import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Widget, WidgetsStore } from '../types/widget.types';

const initialState = {
  widgets: [],
  selectedWidgetId: null,
  isLoading: false,
  error: null,
};

export const useWidgetsStore = create<WidgetsStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setWidgets: (widgets: Widget[]) =>
        set({ widgets, error: null }, false, 'setWidgets'),

      addWidget: (widget: Widget) =>
        set(
          (state) => ({
            widgets: [...state.widgets, widget],
            error: null,
          }),
          false,
          'addWidget'
        ),

      updateWidget: (widgetId: number, updates: Partial<Widget>) =>
        set(
          (state) => ({
            widgets: state.widgets.map((w) =>
              w.id === widgetId ? { ...w, ...updates } : w
            ),
            error: null,
          }),
          false,
          'updateWidget'
        ),

      removeWidget: (widgetId: number) =>
        set(
          (state) => ({
            widgets: state.widgets.filter((w) => w.id !== widgetId),
            selectedWidgetId:
              state.selectedWidgetId === widgetId
                ? null
                : state.selectedWidgetId,
            error: null,
          }),
          false,
          'removeWidget'
        ),

      selectWidget: (widgetId: number | null) =>
        set({ selectedWidgetId: widgetId }, false, 'selectWidget'),

      setLoading: (isLoading: boolean) =>
        set({ isLoading }, false, 'setLoading'),

      setError: (error: string | null) =>
        set({ error }, false, 'setError'),

      reset: () => set(initialState, false, 'reset'),
    }),
    { name: 'WidgetsStore' }
  )
);

// Selectors
export const selectWidgets = (state: WidgetsStore) => state.widgets;
export const selectSelectedWidget = (state: WidgetsStore) => {
  const { widgets, selectedWidgetId } = state;
  return widgets.find((w) => w.id === selectedWidgetId) || null;
};
export const selectWidgetById = (widgetId: number) => (state: WidgetsStore) =>
  state.widgets.find((w) => w.id === widgetId) || null;
export const selectIsLoading = (state: WidgetsStore) => state.isLoading;
export const selectError = (state: WidgetsStore) => state.error;
