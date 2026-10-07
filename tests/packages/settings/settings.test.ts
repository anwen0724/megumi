/* Verifies the unified Settings capability across Provider, Model, Permission, and Web Search facts. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings as createFileSettings } from '@megumi/application/settings/settings-store';
const configurationDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of configurationDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Creates real, isolated files for the public configuration operations. */
function configurationFiles(globalOnly=false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-settings-'));
  configurationDirectories.push(directory);
  const globalSettingsPath = path.join(directory, 'settings.json');
  const projectSettingsPath = path.join(directory, 'project', '.megumi', 'settings.json');
  const credentialsPath = path.join(directory, 'credentials.json');
  return {
    directory,
    globalSettingsPath,
    projectSettingsPath,
    credentialsPath,
    settings: createFileSettings({
      globalSettingsPath,
      projectSettingsPath:globalOnly?undefined:projectSettingsPath,
      credentialsPath,
      readEnvironment: () => undefined,
    }),
  };
}

describe('Configuration files', () => {
  it('persists explicitly added builtin models without copying their catalog parameters', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const result = files.settings.updateSettings({
      patch: { providers: { deepseek: { name: 'DeepSeek', models: { 'deepseek-flash': {} } } } },
      expectedRevision: read.settings.revision,
    });
    expect(result.status).toBe('updated');
    expect(JSON.parse(fs.readFileSync(files.projectSettingsPath, 'utf8'))).toEqual({
      providers: { deepseek: { name: 'DeepSeek', models: { 'deepseek-flash': {} } } },
    });
  });

  it('keeps an added builtin model when its last parameter override is cleared', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(
      files.projectSettingsPath,
      JSON.stringify({
        providers: { deepseek: { models: { 'deepseek-flash': { name: 'Quick' } } } },
      }),
    );
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const result = files.settings.updateSettings({
      patch: { providers: { deepseek: { models: { 'deepseek-flash': { name: null } } } } },
      expectedRevision: read.settings.revision,
    });
    expect(result).toMatchObject({
      status: 'updated',
      settings: { config: { providers: { deepseek: { models: { 'deepseek-flash': {} } } } } },
    });
  });

  it('preserves external additions when clearing a whole configuration group conflicts', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(
      files.projectSettingsPath,
      '{ "context": { "compactionThresholdRatio": 0.6 } }',
    );
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const edited = '{ "context": { "compactionThresholdRatio": 0.6, "futureOption": true } }';
    fs.writeFileSync(files.projectSettingsPath, edited);
    expect(
      files.settings.updateSettings({
        patch: { context: null },
        expectedRevision: read.settings.revision,
      }),
    ).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_CONFLICT' } });
    expect(fs.readFileSync(files.projectSettingsPath, 'utf8')).toBe(edited);
  });

  it('does not rewrite existing empty groups when an update contains no field edits', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    const original = '{ "context": {}, "providers": {} }';
    fs.writeFileSync(files.projectSettingsPath, original);
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    expect(
      files.settings.updateSettings({
        patch: { context: {}, providers: {} },
        expectedRevision: read.settings.revision,
      }).status,
    ).toBe('unchanged');
    expect(fs.readFileSync(files.projectSettingsPath, 'utf8')).toBe(original);
  });

  it('leaves the original file intact when atomic replacement fails', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    const original = '{ "context": { "compactionThresholdRatio": 0.6 } }';
    fs.writeFileSync(files.projectSettingsPath, original);
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('Disk unavailable');
    });
    expect(() =>
      files.settings.updateSettings({
        patch: { context: { compactionThresholdRatio: 0.7 } },
        expectedRevision: read.settings.revision,
      }),
    ).toThrow('Disk unavailable');
    expect(fs.readFileSync(files.projectSettingsPath, 'utf8')).toBe(original);
    expect(fs.readdirSync(path.dirname(files.projectSettingsPath))).toEqual(['settings.json']);
  });

  it('treats task model selection as one value and binds revisions to the configured files', () => {
    const files = configurationFiles(true);
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const first = files.settings.updateSettings({
      patch: { discovery: { candidateSupplyModel: { providerId: 'deepseek', modelId: 'first' } } },
      expectedRevision: read.settings.revision,
    });
    expect(first.status).toBe('updated');
    expect(
      files.settings.updateSettings({
        patch: {
          discovery: { candidateSupplyModel: { providerId: 'deepseek', modelId: 'second' } },
        },
        expectedRevision: read.settings.revision,
      }),
    ).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_CONFLICT' } });
    const other = configurationFiles();
    expect(
      other.settings.updateSettings({
        patch: { context: { compactionThresholdRatio: 0.6 } },
        expectedRevision: read.settings.revision,
      }),
    ).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_CONFLICT' } });
  });

  it('preserves independent external edits but rejects changes to the same edited value',()=>{
 const files=configurationFiles();const read=files.settings.readSettings();if(read.status!=='ok')throw new Error('Expected configuration');
 fs.mkdirSync(path.dirname(files.projectSettingsPath),{recursive:true});fs.writeFileSync(files.projectSettingsPath,JSON.stringify({permissions:{mode:'auto'}}));
 expect(files.settings.updateSettings({patch:{context:{compactionThresholdRatio:0.65}},expectedRevision:read.settings.revision})).toMatchObject({status:'updated',settings:{config:{permissions:{mode:'auto'},context:{compactionThresholdRatio:0.65}}}});
 const preserved=fs.readFileSync(files.projectSettingsPath,'utf8');
 expect(files.settings.updateSettings({patch:{permissions:{mode:'full_access'}},expectedRevision:read.settings.revision})).toMatchObject({status:'rejected',error:{code:'SETTINGS_CONFLICT'}});
 expect(fs.readFileSync(files.projectSettingsPath,'utf8')).toBe(preserved);
});

  it('rejects unknown edits and incomplete model selections without altering files', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const request = JSON.parse('{"patch":{"context":{"undeclared":true}}}');
    request.expectedRevision = read.settings.revision;
    expect(files.settings.updateSettings(request)).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_INVALID' },
    });
    const incomplete = JSON.parse(
      '{"patch":{"discovery":{"candidateSupplyModel":{"providerId":"deepseek"}}}}',
    );
    incomplete.expectedRevision = read.settings.revision;
    expect(files.settings.updateSettings(incomplete).status).toBe('rejected');
    expect(fs.existsSync(files.projectSettingsPath)).toBe(false);
  });

  it('clears an explicit override through update while preserving unrelated unknown data', () => {
    const files = configurationFiles();
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({ context: { compactionThresholdRatio: 0.6 } }),
    );
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(
      files.projectSettingsPath,
      JSON.stringify({ context: { compactionThresholdRatio: 0.7, future: 42 } }),
    );
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    expect(
      files.settings.updateSettings({
        patch: { context: { compactionThresholdRatio: null } },
        expectedRevision: read.settings.revision,
      }),
    ).toMatchObject({
      status: 'updated',
      settings: { config: { context: { compactionThresholdRatio: 0.6 } } },
    });
    expect(JSON.parse(fs.readFileSync(files.projectSettingsPath, 'utf8'))).toEqual({
      context: { future: 42 },
    });
  });

  it('saves only explicit changes to the bound file, including explicit defaults', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    expect(
      files.settings.updateSettings({ patch: {}, expectedRevision: read.settings.revision }).status,
    ).toBe('unchanged');
    expect(fs.existsSync(files.projectSettingsPath)).toBe(false);
    expect(
      files.settings.updateSettings({
        patch: { context: { compactionThresholdRatio: 0.8 } },
        expectedRevision: read.settings.revision,
      }).status,
    ).toBe('updated');
    expect(JSON.parse(fs.readFileSync(files.projectSettingsPath, 'utf8'))).toEqual({
      context: { compactionThresholdRatio: 0.8 },
    });
    expect(fs.existsSync(files.globalSettingsPath)).toBe(false);
  });

  it('requires an API URL for a custom search provider', () => {
    const files = configurationFiles();
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({ webSearch: { provider: 'custom' } }),
    );
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_INVALID' },
    });
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({ webSearch: { provider: 'custom', baseUrl: 'https://search.example/v1' } }),
    );
    expect(files.settings.readSettings()).toMatchObject({ status: 'ok' });
  });

  it('requires complete custom definitions and validates model capacity after project overrides', () => {
    const files = configurationFiles();
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ providers: { local: {} } }));
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_INVALID' },
    });
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({
        providers: {
          local: {
            api: 'openai-completions',
            baseUrl: 'http://localhost:9999/v1',
            models: { small: { contextWindowTokens: 8192, maxOutputTokens: 1024 } },
          },
        },
      }),
    );
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(
      files.projectSettingsPath,
      JSON.stringify({ providers: { local: { models: { small: { maxOutputTokens: 16384 } } } } }),
    );
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_INVALID' },
    });
    fs.writeFileSync(
      files.projectSettingsPath,
      JSON.stringify({ providers: { local: { models: { small: { maxOutputTokens: 2048 } } } } }),
    );
    expect(files.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          providers: {
            local: { models: { small: { contextWindowTokens: 8192, maxOutputTokens: 2048 } } },
          },
        },
      },
    });
  });

  it('validates relationships after combining files rather than filling each file with defaults',()=>{
    const files=configurationFiles();fs.writeFileSync(files.globalSettingsPath,JSON.stringify({providers:{local:{name:'Local',api:'openai-completions',baseUrl:'http://localhost:8000/v1',models:{small:{name:'Small',contextWindowTokens:8192,maxOutputTokens:2048}}}}}));
    fs.mkdirSync(path.dirname(files.projectSettingsPath),{recursive:true});
    fs.writeFileSync(files.projectSettingsPath,JSON.stringify({providers:{local:{models:{small:{contextWindowTokens:1024}}}}}));
    expect(files.settings.readSettings()).toMatchObject({status:'rejected',error:{code:'SETTINGS_INVALID'}});
    fs.writeFileSync(files.projectSettingsPath,JSON.stringify({providers:{local:{models:{small:{contextWindowTokens:4096}}}}}));
    expect(files.settings.readSettings()).toMatchObject({status:'ok',settings:{config:{providers:{local:{models:{small:{contextWindowTokens:4096,maxOutputTokens:2048}}}}}}});
  });

  it('diagnoses unknown fields without disclosing or rewriting their contents', () => {
    const files = configurationFiles();
    const content = JSON.stringify({
      general: { setupCompleted: true, token: 'private-value' },
      future: { secret: 'another-value' },
    });
    fs.writeFileSync(files.globalSettingsPath, content);
    const read = files.settings.readSettings();
    expect(read).toMatchObject({
      status: 'ok',
      settings: {
        diagnostics: [
          { code: 'SETTINGS_UNKNOWN_FIELD', scope: 'global', path: ['general', 'token'] },
          { code: 'SETTINGS_UNKNOWN_FIELD', scope: 'global', path: ['future'] },
        ],
      },
    });
    expect(JSON.stringify(read)).not.toContain('private-value');
    expect(JSON.stringify(read)).not.toContain('another-value');
    expect(fs.readFileSync(files.globalSettingsPath, 'utf8')).toBe(content);
  });

  it('reports invalid fields and can reread a manually repaired file without rewriting it', () => {
    const files = configurationFiles();
    const invalid = '{ "context": { "compactionThresholdRatio": 0 } }';
    fs.writeFileSync(files.globalSettingsPath, invalid);
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: {
        code: 'SETTINGS_INVALID',
        issues: [{ scope: 'global', path: ['context', 'compactionThresholdRatio'] }],
      },
    });
    expect(fs.readFileSync(files.globalSettingsPath, 'utf8')).toBe(invalid);
    fs.writeFileSync(files.globalSettingsPath, '{ broken');
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_INVALID' },
    });
    fs.writeFileSync(
      files.globalSettingsPath,
      '{ "context": { "compactionThresholdRatio": 0.65 } }',
    );
    expect(files.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: { config: { context: { compactionThresholdRatio: 0.65 } } },
    });
  });

  it('rejects forbidden project fields with their location', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ general: { language: 'en-US' } }));
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: {
        code: 'SETTINGS_SCOPE_INVALID',
        issues: [{ scope: 'project', path: ['general', 'language'] }],
      },
    });
  });

  it('merges project fields over the latest global file while keeping each source', () => {
    const files = configurationFiles();
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({
        general: { setupCompleted: true },
        providers: { deepseek: { baseUrl: 'https://global.example/v1' } },
        discovery: { enabledSources: ['bilibili'] },
      }),
    );
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(
      files.projectSettingsPath,
      JSON.stringify({
        providers: { deepseek: { baseUrl: 'https://project.example/v1' } },
      }),
    );
    const read = files.settings.readSettings();
    expect(read).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          general: { setupCompleted: true },
          providers: { deepseek: { baseUrl: 'https://project.example/v1' } },
          },
        sources: expect.arrayContaining([
          { path: ['general', 'setupCompleted'], source: 'global' },
          { path: ['providers', 'deepseek', 'baseUrl'], source: 'project' },
          { path: ['context', 'compactionThresholdRatio'], source: 'default' },
        ]),
      },
    });
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({ general: { setupCompleted: false } }),
    );
    expect(files.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: { config: { general: { setupCompleted: false } } },
    });
  });

  it('reads complete defaults without creating missing configuration files', () => {
    const files = configurationFiles();
    expect(files.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          general: { language: 'zh-CN', theme: 'midnight-blue', setupCompleted: false },
          providers: {},
          context: { compactionThresholdRatio: 0.8 },
          discovery: {enabled:false,enabledSources:['tavily','bing_rss','zhihu','bilibili','xiaohongshu'],candidateSupply:{interestMinimumCount:10,interestTargetCount:30,maintenanceIntervalMinutes:60},dailyFeed:{lookbackDays:3,historyDays:7},curated:{targetCount:10}},
          voice: { inputDeviceId: 'default', outputDeviceId: 'default', readAloudEnabled: false },
          webSearch: {},
          permissions: { mode: 'ask', allow: [], ask: [], deny: [] },
        },
      },
    });
    expect(fs.readdirSync(files.directory)).toEqual([]);
  });
});
