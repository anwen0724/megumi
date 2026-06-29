// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldQuitForSquirrelStartup } from '@megumi/desktop/main/app/squirrel-startup';

describe('shouldQuitForSquirrelStartup', () => {
  it('quits only for Squirrel lifecycle events on Windows', () => {
    expect(shouldQuitForSquirrelStartup(['Megumi.exe', '--squirrel-install'], 'win32')).toBe(true);
    expect(shouldQuitForSquirrelStartup(['Megumi.exe', '--squirrel-updated'], 'win32')).toBe(true);
    expect(shouldQuitForSquirrelStartup(['Megumi.exe', '--squirrel-uninstall'], 'win32')).toBe(true);
    expect(shouldQuitForSquirrelStartup(['Megumi.exe', '--squirrel-obsolete'], 'win32')).toBe(true);
  });

  it('keeps normal launches and first-run launches on the normal app path', () => {
    expect(shouldQuitForSquirrelStartup(['Megumi.exe'], 'win32')).toBe(false);
    expect(shouldQuitForSquirrelStartup(['Megumi.exe', '--squirrel-firstrun'], 'win32')).toBe(false);
    expect(shouldQuitForSquirrelStartup(['Megumi.exe', '--squirrel-install'], 'darwin')).toBe(false);
  });
});
