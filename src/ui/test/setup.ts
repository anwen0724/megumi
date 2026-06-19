import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement scrollIntoView
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement scrollTo, but timeline auto-scroll uses the native method.
if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.scrollTo = () => {};
}

afterEach(() => {
  cleanup();
});
