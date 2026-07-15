import { describe, expect, it } from 'vitest';
import { formatSessionUpdatedAt, getWorkspaceBasename } from '@megumi/desktop/renderer/shell/shell-display';

describe('shell display helpers', () => {
  it('uses the last segment of a Windows workspace path', () => {
    expect(getWorkspaceBasename({ workspaceName: 'Megumi', workspacePath: 'C:/workspaces/megumi' })).toBe(
      'megumi',
    );
  });

  it('uses the last segment of a path with trailing separators', () => {
    expect(getWorkspaceBasename({ workspaceName: 'Megumi', workspacePath: 'C:\\all\\work\\study\\megumi\\' })).toBe(
      'megumi',
    );
  });

  it('falls back to the project name when no path is selected', () => {
    expect(getWorkspaceBasename({ workspaceName: 'Megumi', workspacePath: null })).toBe('Megumi');
  });

  it('falls back to local sessions when neither path nor name exists', () => {
    expect(getWorkspaceBasename({ workspaceName: '   ', workspacePath: '   ' })).toBe('Local sessions');
  });

  it('formats recent session update times with the active locale', () => {
    const now = new Date('2026-05-18T12:00:00.000Z');

    expect(formatSessionUpdatedAt('2026-05-18T12:00:00.000Z', now)).toBe('this minute');
    expect(formatSessionUpdatedAt('2026-05-18T11:58:00.000Z', now)).toBe('2 minutes ago');
    expect(formatSessionUpdatedAt('2026-05-18T10:00:00.000Z', now)).toBe('2 hours ago');
    expect(formatSessionUpdatedAt('2026-05-16T12:00:00.000Z', now)).toBe('2 days ago');
    expect(formatSessionUpdatedAt('2026-04-27T12:00:00.000Z', now)).toBe('3 weeks ago');
  });

  it('returns an empty label for invalid session update times', () => {
    expect(formatSessionUpdatedAt('not-a-date', new Date('2026-05-18T12:00:00.000Z'))).toBe('');
  });
});
