/*
 * Verifies Desktop update preferences persist independently from Product settings.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileUpdatePreferencesStore } from '@megumi/desktop/main/application-update/update-preferences-store';

let tempRoot: string | undefined;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe('Update preferences store', () => {
  it('uses automatic checks on and automatic downloads off when no file exists', () => {
    const store = createStore();
    expect(store.read()).toEqual({
      automaticChecksEnabled: true,
      automaticDownloadsEnabled: false,
    });
  });

  it('round-trips validated preferences and normalizes the disabled combination', () => {
    const store = createStore();
    store.write({ automaticChecksEnabled: true, automaticDownloadsEnabled: true });
    expect(store.read()).toEqual({ automaticChecksEnabled: true, automaticDownloadsEnabled: true });
    store.write({ automaticChecksEnabled: false, automaticDownloadsEnabled: true });
    expect(store.read()).toEqual({ automaticChecksEnabled: false, automaticDownloadsEnabled: false });
  });

  it('returns safe defaults for malformed local data', () => {
    const store = createStore();
    if (!tempRoot) throw new Error('Update preferences fixture was not initialized.');
    const filePath = path.join(tempRoot, 'desktop', 'application-update.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{"automaticChecksEnabled":"yes"}', 'utf8');
    expect(store.read()).toEqual({
      automaticChecksEnabled: true,
      automaticDownloadsEnabled: false,
    });
  });
});

function createStore() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-update-preferences-'));
  return createFileUpdatePreferencesStore({ megumiHomePath: tempRoot });
}
