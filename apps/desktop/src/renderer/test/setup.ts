import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { initializeRendererI18n } from '../shared/i18n';

// jsdom does not implement scrollIntoView
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement scrollTo, but timeline auto-scroll uses the native method.
if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.scrollTo = () => {};
}

beforeEach(async () => {
  await initializeRendererI18n('en-US');
});

afterEach(() => {
  cleanup();
});
