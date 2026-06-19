// Persists desktop project/workspace roots in SQLite without owning workspace policy.
import path from 'node:path';
import type { SqliteDatabase } from '../connection';
import { decodeJson, encodeJson } from '../json';

export type DesktopProjectStatus = 'available' | 'missing';

export interface DesktopProject {
  id: string;
  name: string;
  path: string;
  status: DesktopProjectStatus;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
  metadata?: Record<string, unknown>;
}

export interface UpsertDesktopProjectInput {
  path: string;
  name?: string;
  now: string;
  status: DesktopProjectStatus;
  metadata?: Record<string, unknown>;
}

export class SqliteProjectRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listProjects(): DesktopProject[] {
    return this.database
      .prepare('SELECT * FROM desktop_projects ORDER BY last_opened_at DESC')
      .all()
      .map(rowFromDatabase);
  }

  getProject(id: string): DesktopProject | undefined {
    const row = this.database.prepare('SELECT * FROM desktop_projects WHERE id = ?').get(id);
    return row ? rowFromDatabase(row) : undefined;
  }

  upsertFromPath(input: UpsertDesktopProjectInput): DesktopProject {
    const resolved = path.resolve(input.path);
    const existing = this.database.prepare('SELECT * FROM desktop_projects WHERE path = ?').get(resolved);
    const id = existing ? String((existing as { id: string }).id) : projectIdFromPath(resolved);
    const name = input.name ?? path.basename(resolved);
    if (existing) {
      this.database.prepare(`
        UPDATE desktop_projects
        SET name = ?, status = ?, updated_at = ?, last_opened_at = ?, metadata_json = ?
        WHERE id = ?
      `).run(name, input.status, input.now, input.now, encodeJson(input.metadata), id);
    } else {
      this.database.prepare(`
        INSERT INTO desktop_projects (id, name, path, status, created_at, updated_at, last_opened_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, resolved, input.status, input.now, input.now, input.now, encodeJson(input.metadata));
    }
    return this.getProject(id) ?? missingProject(id);
  }

  touchProject(id: string, now: string): DesktopProject | undefined {
    this.database.prepare('UPDATE desktop_projects SET updated_at = ?, last_opened_at = ? WHERE id = ?').run(now, now, id);
    return this.getProject(id);
  }

  updateStatus(id: string, status: DesktopProjectStatus): DesktopProject | undefined {
    this.database.prepare('UPDATE desktop_projects SET status = ? WHERE id = ?').run(status, id);
    return this.getProject(id);
  }

  removeProject(id: string): boolean {
    return this.database.prepare('DELETE FROM desktop_projects WHERE id = ?').run(id).changes > 0;
  }
}

function rowFromDatabase(row: unknown): DesktopProject {
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    name: String(value.name),
    path: String(value.path),
    status: value.status === 'missing' ? 'missing' : 'available',
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
    lastOpenedAt: String(value.last_opened_at),
    ...(value.metadata_json ? { metadata: decodeJson<Record<string, unknown>>(String(value.metadata_json)) } : {}),
  };
}

function projectIdFromPath(projectPath: string): string {
  return `project_${Buffer.from(projectPath).toString('base64url').slice(0, 40)}`;
}

function missingProject(id: string): DesktopProject {
  throw new Error(`Project row was not persisted: ${id}`);
}
