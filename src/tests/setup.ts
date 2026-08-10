import '@testing-library/jest-dom/vitest';

class PointerEventPolyfill extends Event {
  button: number;
  constructor(type: string, props?: PointerEventInit) {
    super(type, props);
    this.button = props?.button ?? 0;
  }
}

if (typeof window !== 'undefined' && !window.PointerEvent) {
  // @ts-expect-error polyfill assignment
  window.PointerEvent = PointerEventPolyfill;
}

if (typeof Element !== 'undefined') {
  const anyElement = Element.prototype as unknown as {
    hasPointerCapture?: (pointerId: number) => boolean;
    setPointerCapture?: (pointerId: number) => void;
    releasePointerCapture?: (pointerId: number) => void;
    scrollIntoView?: () => void;
  };

  if (!anyElement.hasPointerCapture) {
    anyElement.hasPointerCapture = () => false;
  }
  if (!anyElement.setPointerCapture) {
    anyElement.setPointerCapture = () => {};
  }
  if (!anyElement.releasePointerCapture) {
    anyElement.releasePointerCapture = () => {};
  }
  if (!anyElement.scrollIntoView) {
    anyElement.scrollIntoView = () => {};
  }
}
