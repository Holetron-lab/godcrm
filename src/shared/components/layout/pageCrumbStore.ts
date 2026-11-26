// The last breadcrumb of the header belongs to the page when the header cannot derive it from the URL
// alone (a module of the catalog, for instance). A page publishes it while mounted and withdraws it on unmount.
import { useEffect } from 'react';
import { create } from 'zustand';

export interface PageCrumb {
  name: string;
  icon?: string;
}

interface PageCrumbState {
  crumb: PageCrumb | null;
  setCrumb: (crumb: PageCrumb | null) => void;
}

export const usePageCrumbStore = create<PageCrumbState>(set => ({
  crumb: null,
  setCrumb: crumb => set({ crumb }),
}));

export function usePageCrumb(crumb: PageCrumb | null) {
  const setCrumb = usePageCrumbStore(state => state.setCrumb);
  const name = crumb?.name;
  const icon = crumb?.icon;
  useEffect(() => {
    setCrumb(name === undefined ? null : { name, icon });
    return () => setCrumb(null);
  }, [name, icon, setCrumb]);
}
