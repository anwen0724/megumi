import crypto from 'node:crypto';
import path from 'node:path';
import type { MegumiDatabase } from '../connection';
import type { ProjectRecord, ProjectStatus } from '@megumi/shared/project-contracts';

type NodePlatform = NodeJS.Platform;

interface ProjectRow {
  project_id: string;
  name: string;
  repo_path: string;
  repo_path_key: string;
  status: ProjectStatus;
  created_at: string;
  last_opened_at: string;
}

export interface ProjectUpsertInput {
  repoPath: string;
  now: string;
  status?: ProjectStatus;
  platform?: NodePlatform;
}

export class ProjectRepository {
  constructor(private readonly database: MegumiDatabase) {}

  listProjects(): ProjectRecord[] {
    return (this.database
      .prepare('SELECT * FROM projects ORDER BY last_opened_at DESC, name ASC')
      .all() as ProjectRow[]).map(fromProjectRow);
  }

  getProject(projectId: string): ProjectRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM projects WHERE project_id = ?')
      .get(projectId) as ProjectRow | undefined;

    return row ? fromProjectRow(row) : undefined;
  }

  getProjectByRepoPathKey(repoPathKey: string): ProjectRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM projects WHERE repo_path_key = ?')
      .get(repoPathKey) as ProjectRow | undefined;

    return row ? fromProjectRow(row) : undefined;
  }

  upsertFromRepoPath(input: ProjectUpsertInput): ProjectRecord {
    const platform = input.platform ?? process.platform;
    const repoPath = normalizeProjectRepoPath(input.repoPath, platform);
    const repoPathKey = toProjectRepoPathKey(repoPath, platform);
    const existing = this.getProjectByRepoPathKey(repoPathKey);
    const row: ProjectRow = {
      project_id: existing?.projectId ?? createProjectIdFromRepoPathKey(repoPathKey),
      name: basenameProjectRepoPath(repoPath, platform),
      repo_path: repoPath,
      repo_path_key: repoPathKey,
      status: input.status ?? 'available',
      created_at: existing?.createdAt ?? input.now,
      last_opened_at: input.now,
    };

    this.database.prepare(`
      INSERT INTO projects (
        project_id,
        name,
        repo_path,
        repo_path_key,
        status,
        created_at,
        last_opened_at
      ) VALUES (
        @project_id,
        @name,
        @repo_path,
        @repo_path_key,
        @status,
        @created_at,
        @last_opened_at
      )
      ON CONFLICT(repo_path_key) DO UPDATE SET
        name = excluded.name,
        repo_path = excluded.repo_path,
        status = excluded.status,
        last_opened_at = excluded.last_opened_at
    `).run(row);

    const saved = this.getProject(row.project_id);

    if (!saved) {
      throw new Error(`Project was not saved for ${repoPath}`);
    }

    return saved;
  }

  touchProject(projectId: string, openedAt: string): ProjectRecord | undefined {
    this.database
      .prepare('UPDATE projects SET last_opened_at = @opened_at WHERE project_id = @project_id')
      .run({
        project_id: projectId,
        opened_at: openedAt,
      });

    return this.getProject(projectId);
  }

  updateStatus(projectId: string, status: ProjectStatus): ProjectRecord | undefined {
    this.database
      .prepare('UPDATE projects SET status = @status WHERE project_id = @project_id')
      .run({
        project_id: projectId,
        status,
      });

    return this.getProject(projectId);
  }

  removeProject(projectId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM projects WHERE project_id = ?')
      .run(projectId);

    return result.changes > 0;
  }
}

export function normalizeProjectRepoPath(repoPath: string, platform: NodePlatform = process.platform): string {
  return pathApiFor(platform).resolve(repoPath);
}

export function toProjectRepoPathKey(repoPath: string, platform: NodePlatform = process.platform): string {
  const normalized = normalizeProjectRepoPath(repoPath, platform);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function createProjectIdFromRepoPathKey(repoPathKey: string): string {
  const digest = crypto.createHash('sha256').update(repoPathKey).digest('hex').slice(0, 16);
  return `project:${digest}`;
}

function fromProjectRow(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    name: row.name,
    repoPath: row.repo_path,
    repoPathKey: row.repo_path_key,
    status: row.status,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

function basenameProjectRepoPath(repoPath: string, platform: NodePlatform): string {
  return pathApiFor(platform).basename(repoPath);
}

function pathApiFor(platform: NodePlatform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}
