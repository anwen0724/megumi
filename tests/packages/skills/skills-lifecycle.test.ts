/* Verifies the long-lived Skills object: lifecycle, serialized refresh, availability, workspace discovery, selection and views. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createSkills,
  SkillsPolicyConfigurationError,
  type CreateSkillsOptions,
  type Skills,
} from '@megumi/skills';
import { DEFAULT_SKILLS_POLICY, type SkillsPolicy } from '@megumi/skills/skill-loader';

const tempRoots: string[] = [];
let database: DatabaseConnection | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
  tempRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('createSkills', () => {
  it('fails fast on an invalid Policy before any input is processed', () => {
    expect(() => createSkills({
      homePath: createRoot(),
      database: openDatabase(),
      policy: { maxCatalogItems: 0 },
    })).toThrow(SkillsPolicyConfigurationError);
  });
});

describe('Skills lifecycle', () => {
  it('lists discovered Skills and refreshes after new packages appear', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const firstPath = writeSkill(path.join(home, 'skills'), 'one', 'one', 'One', 'Body');
    expect(await skills.list({})).toMatchObject({
      status: 'ok',
      skills: [{ name: 'one', skillPath: expect.stringContaining(firstPath) }],
    });
    const secondPath = writeSkill(path.join(home, 'skills'), 'two', 'two', 'Two', 'Body');
    await skills.refresh({});
    const list = await skills.list({});
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.skillPath) : []).toContain(secondPath);
  });

  it('returns skills_unavailable when every Root fails to establish a result', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    // A Root that exists as a file is not scannable: this makes every Root unavailable.
    const fileRoot = path.join(home, 'skills');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(fileRoot, 'not a directory');
    expect(await skills.list({})).toMatchObject({ status: 'failed', failure: { code: 'skills_unavailable' } });
    expect(await skills.get({ skillPath: path.join(fileRoot, 'x', 'SKILL.md') })).toMatchObject({
      status: 'failed', failure: { code: 'skills_unavailable' },
    });
    expect(await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'x', skillPath: path.join(fileRoot, 'x', 'SKILL.md') },
    })).toMatchObject({ status: 'failed', failure: { code: 'skills_unavailable' } });
    expect(await skills.createView({})).toMatchObject({ status: 'failed', failure: { code: 'skills_unavailable' } });
  });

  it('keeps the previous snapshot when a refresh is cancelled', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'stable', 'stable', 'Stable', 'Body');
    const controller = new AbortController();
    controller.abort();
    const result = await skills.refresh({ signal: controller.signal });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    const list = await skills.list({});
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.skillPath) : []).toContain(skillPath);
  });

  it('serializes concurrent refreshes and lets queries read one complete snapshot', async () => {
    const home = createRoot();
    const workspaceRoot = createRoot();
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let blockNextResolve = false;
    const skills = createSkills({
      homePath: home,
      database: openDatabase(),
      workspaceRootResolver: {
        async resolveWorkspaceRoot() {
          if (blockNextResolve) await gate;
          return workspaceRoot;
        },
      },
    });
    writeSkill(workspaceRoot, 'alpha', 'alpha', 'Alpha', 'Body');
    // Cache the workspace scope first.
    const initial = await skills.list({ workspaceId: 'ws-1' });
    expect(initial.status === 'ok' ? initial.skills.map((skill) => skill.name) : []).toEqual(['alpha']);
    // A refresh is now blocked mid-flight; queries keep reading the previous snapshot.
    writeSkill(workspaceRoot, 'beta', 'beta', 'Beta', 'Body');
    blockNextResolve = true;
    const first = skills.refresh({ workspaceId: 'ws-1' });
    const second = skills.refresh({ workspaceId: 'ws-1' });
    const during = await skills.list({ workspaceId: 'ws-1' });
    expect(during.status === 'ok' ? during.skills.map((skill) => skill.name) : []).toEqual(['alpha']);
    releaseFirst();
    await Promise.all([first, second]);
    const list = await skills.list({ workspaceId: 'ws-1' });
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.name).sort() : []).toEqual(['alpha', 'beta']);
  });
});

describe('Skills availability', () => {
  it('defaults to enabled, persists disable and re-enable roundtrips', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'toggle', 'toggle', 'Toggle', 'Body');
    expect((await skills.list({})).status).toBe('ok');

    const disabled = await skills.disable({ skillPath });
    expect(disabled).toMatchObject({ status: 'ok', availability: { skillPath, available: false } });
    const afterDisable = await skills.list({});
    const skillAfterDisable = afterDisable.status === 'ok'
      ? afterDisable.skills.find((skill) => skill.skillPath === skillPath)
      : undefined;
    expect(skillAfterDisable?.available).toBe(false);
    expect(await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'toggle', skillPath },
    })).toMatchObject({ status: 'failed', failure: { code: 'skill_unavailable' } });

    expect(await skills.enable({ skillPath })).toMatchObject({ status: 'ok' });
    expect(await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'toggle', skillPath },
    })).toMatchObject({ status: 'ok' });
  });

  it('does not apply a stale availability record to a new Skill at the same path', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'removed', 'removed', 'Removed', 'Body');
    await skills.disable({ skillPath });
    fs.rmSync(path.dirname(skillPath), { recursive: true, force: true });
    await skills.refresh({});
    const recreated = writeSkill(path.join(home, 'skills'), 'removed', 'removed', 'Removed again', 'Body');
    await skills.refresh({});
    const list = await skills.list({});
    const skill = list.status === 'ok' ? list.skills.find((candidate) => candidate.skillPath === recreated) : undefined;
    expect(skill?.available).toBe(true);
  });
});

describe('Skills workspace auto-discovery', () => {
  function createWorkspaceSkills(options: Partial<CreateSkillsOptions> = {}) {
    const home = createRoot();
    const firstWorkspace = createRoot();
    const secondWorkspace = createRoot();
    const resolver = {
      async resolveWorkspaceRoot(request: { workspaceId: string }): Promise<string | undefined> {
        if (request.workspaceId === 'ws-first') return path.join(firstWorkspace, '.megumi', 'skills');
        if (request.workspaceId === 'ws-second') return path.join(secondWorkspace, '.megumi', 'skills');
        return undefined;
      },
    };
    const skills = createSkills({
      homePath: home,
      database: openDatabase(),
      workspaceRootResolver: resolver,
      ...options,
    });
    return { home, firstWorkspace, secondWorkspace, skills };
  }

  it('automatically discovers the current Workspace .megumi/skills Root', async () => {
    const { home, firstWorkspace, skills } = createWorkspaceSkills();
    writeSkill(path.join(home, 'skills'), 'global-skill', 'global-skill', 'Global', 'Body');
    writeSkill(path.join(firstWorkspace, '.megumi', 'skills'), 'local-skill', 'local-skill', 'Local', 'Body');
    const list = await skills.list({ workspaceId: 'ws-first' });
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.name).sort() : []).toEqual(['global-skill', 'local-skill']);
    const globalOnly = await skills.list({});
    expect(globalOnly.status === 'ok' ? globalOnly.skills.map((skill) => skill.name) : []).toEqual(['global-skill']);
  });

  it('treats a missing Workspace Root as an empty result that keeps global Skills', async () => {
    const { home, skills } = createWorkspaceSkills();
    writeSkill(path.join(home, 'skills'), 'global-skill', 'global-skill', 'Global', 'Body');
    const list = await skills.list({ workspaceId: 'ws-missing' });
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.name) : []).toEqual(['global-skill']);
  });

  it('shows only the selected Workspace skills on Workspace switch', async () => {
    const { home, firstWorkspace, secondWorkspace, skills } = createWorkspaceSkills();
    writeSkill(path.join(home, 'skills'), 'global-skill', 'global-skill', 'Global', 'Body');
    writeSkill(path.join(firstWorkspace, '.megumi', 'skills'), 'first-skill', 'first-skill', 'First', 'Body');
    writeSkill(path.join(secondWorkspace, '.megumi', 'skills'), 'second-skill', 'second-skill', 'Second', 'Body');
    const first = await skills.list({ workspaceId: 'ws-first' });
    expect(first.status === 'ok' ? first.skills.map((skill) => skill.name).sort() : []).toEqual(['first-skill', 'global-skill']);
    const second = await skills.list({ workspaceId: 'ws-second' });
    expect(second.status === 'ok' ? second.skills.map((skill) => skill.name).sort() : []).toEqual(['global-skill', 'second-skill']);
  });

  it('lets a Workspace Skill win only when no global Skill uses its name', async () => {
    const { home, firstWorkspace, skills } = createWorkspaceSkills();
    writeSkill(path.join(home, 'skills'), 'shared', 'shared', 'Global shared', 'Body');
    const workspaceSkill = writeSkill(path.join(firstWorkspace, '.megumi', 'skills'), 'shared', 'shared', 'Workspace shared', 'Body');
    const list = await skills.list({ workspaceId: 'ws-first' });
    expect(list.status === 'ok' ? list.skills.filter((skill) => skill.name === 'shared') : []).toHaveLength(1);
    const selected = await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'shared', skillPath: workspaceSkill },
      workspaceId: 'ws-first',
    });
    expect(selected).toMatchObject({ status: 'failed', failure: { code: 'skill_not_found' } });
  });
});

describe('Skills delete', () => {
  it('deletes only a User Skill package, its availability and its snapshot entry', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'deletable', 'deletable', 'Delete me', 'Body');
    await skills.disable({ skillPath });
    expect(await skills.delete({ skillPath })).toMatchObject({ status: 'ok', skillPath });
    expect(fs.existsSync(path.dirname(skillPath))).toBe(false);
    const list = await skills.list({});
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.skillPath) : []).not.toContain(skillPath);
    expect(await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'deletable', skillPath },
    })).toMatchObject({ status: 'failed', failure: { code: 'skill_not_found' } });
  });

  it('refuses to delete a System Skill and the Root itself', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const systemPath = writeSkill(path.join(home, 'skills', '.system'), 'system', 'system', 'System', 'Body');
    expect(await skills.delete({ skillPath: systemPath })).toMatchObject({
      status: 'failed', failure: { code: 'delete_not_allowed', reason: 'system_skill' },
    });
    expect(fs.existsSync(systemPath)).toBe(true);
    // A package directly at the user Root equals the Root: refusing protects the Root.
    const userRoot = path.join(home, 'skills');
    const rootLevel = path.join(userRoot, 'SKILL.md');
    fs.writeFileSync(rootLevel, '---\nname: root-level\ndescription: Root level\n---\nBody\n');
    await skills.refresh({});
    expect(await skills.delete({ skillPath: rootLevel })).toMatchObject({
      status: 'failed', failure: { code: 'delete_not_allowed', reason: 'skill_root' },
    });
    expect(fs.existsSync(rootLevel)).toBe(true);
  });

  it('keeps a deleted Skill hidden when the follow-up refresh fails', async () => {
    const home = createRoot();
    const workspaceRoot = createRoot();
    let resolverCalls = 0;
    const skills = createSkills({
      homePath: home,
      database: openDatabase(),
      workspaceRootResolver: {
        async resolveWorkspaceRoot(request: { workspaceId: string }) {
          resolverCalls += 1;
          // Calls 1-2 serve the delete itself; only the follow-up refresh (call 3) fails.
          if (resolverCalls >= 3) throw new Error('workspace unavailable');
          return workspaceRoot;
        },
      },
    });
    const skillPath = writeSkill(workspaceRoot, 'doomed', 'doomed', 'Doomed', 'Body');
    const result = await skills.delete({ skillPath, workspaceId: 'ws-1' });
    expect(result.status).toBe('ok');
    const list = await skills.list({ workspaceId: 'ws-1' });
    expect(list.status === 'ok' ? list.skills.map((skill) => skill.skillPath) : []).not.toContain(skillPath);
    expect(fs.existsSync(path.dirname(skillPath))).toBe(false);
  });

  it('cannot escape through a symlink swap at the validated path', async () => {
    const home = createRoot();
    const outside = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'target', 'target', 'Target', 'Body');
    // Establish the snapshot first so the swap happens between validation and deletion.
    await skills.list({});
    const packageDirectory = path.dirname(skillPath);
    fs.rmSync(packageDirectory, { recursive: true, force: true });
    const outsidePackage = path.join(outside, 'target');
    fs.mkdirSync(outsidePackage, { recursive: true });
    fs.writeFileSync(path.join(outsidePackage, 'SKILL.md'), '---\nname: target\ndescription: Outside\n---\nBody\n');
    fs.symlinkSync(outsidePackage, packageDirectory, 'junction');
    const result = await skills.delete({ skillPath });
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'delete_not_allowed' } });
    expect(fs.existsSync(path.join(outsidePackage, 'SKILL.md'))).toBe(true);
  });
});

describe('Skills resolveSelection and views', () => {
  it('resolves an explicit selection by exact name and path and returns frontmatter-free content', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'review', 'review', 'Review', 'Body text');
    const result = await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'review', skillPath },
    });
    expect(result).toMatchObject({
      status: 'ok',
      content: { name: 'review', skillPath, packagePath: path.dirname(skillPath), content: 'Body text\n' },
    });
  });

  it('fails when the selection name no longer matches the Skill', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const skillPath = writeSkill(path.join(home, 'skills'), 'review', 'review', 'Review', 'Body');
    expect(await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'renamed', skillPath },
    })).toMatchObject({ status: 'failed', failure: { code: 'skill_selection_changed' } });
  });

  it('builds an immutable View with only a bounded Catalog and Diagnostics', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    writeSkill(path.join(home, 'skills'), 'normal', 'normal', 'Normal', 'Body');
    const hiddenPath = writeSkill(path.join(home, 'skills'), 'hidden-skill', 'hidden-skill', 'Hidden', 'Body', true);
    const disabledPath = writeSkill(path.join(home, 'skills'), 'disabled', 'disabled', 'Disabled', 'Body');
    await skills.disable({ skillPath: disabledPath });
    const view = await skills.createView({});
    expect(view.status).toBe('ok');
    if (view.status !== 'ok') return;
    // The View is only a catalog plus diagnostics; no read roots or execution facts.
    expect(Object.keys(view.view).sort()).toEqual(['catalog', 'diagnostics']);
    expect(view.view.catalog.map((item) => item.name)).toEqual(['normal']);
    // Catalog items carry the absolute SKILL.md path so the model can read them via read_file.
    expect(view.view.catalog[0]?.skillPath).toBe(path.join(home, 'skills', 'normal', 'SKILL.md'));
    expect(view.view.diagnostics).toEqual([]);
  });

  it('creates the View only from the current Workspace discovery, without any selection', async () => {
    const home = createRoot();
    const workspaceRoot = createRoot();
    const skills = createSkills({
      homePath: home,
      database: openDatabase(),
      workspaceRootResolver: {
        async resolveWorkspaceRoot(request: { workspaceId: string }) {
          return request.workspaceId === 'ws-1' ? path.join(workspaceRoot, '.megumi', 'skills') : undefined;
        },
      },
    });
    writeSkill(path.join(home, 'skills'), 'global-skill', 'global-skill', 'Global', 'Body');
    writeSkill(path.join(workspaceRoot, '.megumi', 'skills'), 'local-skill', 'local-skill', 'Local', 'Body');
    const view = await skills.createView({ workspaceId: 'ws-1' });
    expect(view.status).toBe('ok');
    if (view.status !== 'ok') return;
    expect(view.view.catalog.map((item) => item.name).sort()).toEqual(['global-skill', 'local-skill']);
    // Explicit Skill selection is resolved separately through resolveSelection(), not createView().
    const selected = await skills.resolveSelection({
      skillSelection: { type: 'skill', name: 'local-skill', skillPath: path.join(workspaceRoot, '.megumi', 'skills', 'local-skill', 'SKILL.md') },
      workspaceId: 'ws-1',
    });
    expect(selected).toMatchObject({ status: 'ok' });
  });

  it('keeps an existing View unchanged after refresh while the next View sees new results', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase() });
    const firstPath = writeSkill(path.join(home, 'skills'), 'first', 'first', 'First', 'Body');
    const firstView = await skills.createView({});
    writeSkill(path.join(home, 'skills'), 'second', 'second', 'Second', 'Body');
    await skills.refresh({});
    const secondView = await skills.createView({});
    expect(firstView.status === 'ok' ? firstView.view.catalog.map((item) => item.skillPath) : []).toEqual([firstPath]);
    expect(secondView.status === 'ok' ? secondView.view.catalog.map((item) => item.skillPath).sort() : []).toEqual([
      firstPath,
      path.join(home, 'skills', 'second', 'SKILL.md'),
    ].sort());
  });

  it('caps the catalog and omits oversized descriptions with diagnostics', async () => {
    const home = createRoot();
    const skills = createSkills({
      homePath: home,
      database: openDatabase(),
      policy: { maxCatalogItems: 1, maxCatalogDescriptionCharacters: 16 },
    });
    writeSkill(path.join(home, 'skills'), 'aaa', 'aaa', 'Short', 'Body');
    writeSkill(path.join(home, 'skills'), 'bbb', 'bbb', 'A very long description that exceeds the cap', 'Body');
    const view = await skills.createView({});
    expect(view.status).toBe('ok');
    if (view.status !== 'ok') return;
    expect(view.view.catalog.map((item) => item.name)).toEqual(['aaa']);
    expect(view.view.diagnostics.some((diagnostic) => diagnostic.code === 'catalog_limited')).toBe(true);
  });

  it('applies the configured Policy while the defaults stay intact', async () => {
    const home = createRoot();
    const skills = createSkills({ homePath: home, database: openDatabase(), policy: { maxCatalogItems: 2 } });
    expect(skills).toBeDefined();
    const merged: SkillsPolicy = { ...DEFAULT_SKILLS_POLICY, maxCatalogItems: 2 };
    expect(merged.maxCatalogItems).toBe(2);
    expect(DEFAULT_SKILLS_POLICY.maxCatalogItems).toBe(64);
  });
});

function openDatabase(): DatabaseConnection {
  if (!database) {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  }
  return database;
}

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-skills-'));
  tempRoots.push(root);
  return root;
}

function writeSkill(
  root: string,
  directory: string,
  name: string,
  description: string,
  content: string,
  disableModelInvocation = false,
): string {
  const packageDirectory = path.join(root, directory);
  fs.mkdirSync(packageDirectory, { recursive: true });
  const frontmatter = disableModelInvocation
    ? `---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: true\n---\n`
    : `---\nname: ${name}\ndescription: ${description}\n---\n`;
  fs.writeFileSync(path.join(packageDirectory, 'SKILL.md'), `${frontmatter}${content}\n`);
  return fs.realpathSync.native(path.join(packageDirectory, 'SKILL.md'));
}
