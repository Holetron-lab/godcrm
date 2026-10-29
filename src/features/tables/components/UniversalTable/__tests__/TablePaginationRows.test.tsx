import { act, render } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LoadNextRow } from '../TablePaginationRows';
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
let notify: (visible: boolean) => void;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      notify = (visible) => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {} disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());
it('loads near the end once per appended batch, without looping after failure', () => {
  const onLoadMore = vi.fn();
  const props = { canLoadMore: true, rowsBelow: 100, rowsLimit: 50, totalRows: 150, isLoadingMore: false, onLoadMore };
  const view = render(<table><tbody><LoadNextRow {...props} /></tbody></table>);
  act(() => notify(false));
  expect(onLoadMore).not.toHaveBeenCalled();
  act(() => { notify(true); notify(true); });
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  view.rerender(<table><tbody><LoadNextRow {...props} isLoadingMore /></tbody></table>);
  view.rerender(<table><tbody><LoadNextRow {...props} /></tbody></table>);
  act(() => notify(true));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  view.rerender(<table><tbody><LoadNextRow {...props} rowsBelow={50} /></tbody></table>);
  act(() => notify(true));
  expect(onLoadMore).toHaveBeenCalledTimes(2);
});
