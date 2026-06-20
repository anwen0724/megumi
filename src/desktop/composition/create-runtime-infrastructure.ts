// Builds desktop infrastructure implementations for the local runtime composition root.
import fs from 'node:fs';
import path from 'node:path';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqlitePermissionRepository,
  SqliteProjectRepository,
  SqliteRecoveryRepository,
  SqliteRuntimeEventRepository,
  SqliteSessionStateRepository,
  SqliteTimelineMessageRepository,
  SqliteToolExecutionRepository,
  SqliteWorkspaceRepository,
  type SqliteDatabase,
} from '../../database';
import { createAppSettingsStore, type AppSettingsStore } from '../infrastructure/app-settings-store';
import { initializeMegumiHome, type MegumiHomePaths } from '../infrastructure/megumi-home';
import { createProviderSettingsStore, type ProviderSettingsStore } from '../infrastructure/provider-settings-store';
import { createRuntimeJsonlLogger, type RuntimeLogger } from '../infrastructure/runtime-logger';
import type { DesktopHostAdapters } from './create-host-adapters';

export interface DesktopRuntimeInfrastructure {
  database: SqliteDatabase;
  megumiHomePaths: MegumiHomePaths;
  settingsStore: AppSettingsStore;
  providerSettingsStore: ProviderSettingsStore;
  sessionRepository: SqliteSessionStateRepository;
  projectRepository: SqliteProjectRepository;
  runtimeEventRepository: SqliteRuntimeEventRepository;
  timelineMessageRepository: SqliteTimelineMessageRepository;
  recoveryRepository: SqliteRecoveryRepository;
  permissionRepository: SqlitePermissionRepository;
  toolExecutionRepository: SqliteToolExecutionRepository;
  workspaceRepository: SqliteWorkspaceRepository;
  runtimeLogger: RuntimeLogger;
}

export function createRuntimeInfrastructure(options: {
  hosts: DesktopHostAdapters;
  databasePath?: string;
  now: () => string;
}): DesktopRuntimeInfrastructure {
  const megumiHomePaths = initializeMegumiHome({
    env: process.env,
    homeDirectory: path.dirname(options.hosts.megumiHomeHost.getMegumiHome()),
    now: () => new Date(options.now()),
  });
  const databasePath = options.databasePath ?? megumiHomePaths.databasePath;
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const database = openSqliteDatabase(databasePath);
  runDatabaseMigrations(database, { now: options.now });
  const sessionRepository = new SqliteSessionStateRepository(database);
  const projectRepository = new SqliteProjectRepository(database);
  const runtimeEventRepository = new SqliteRuntimeEventRepository(database);
  const timelineMessageRepository = new SqliteTimelineMessageRepository(database);
  const recoveryRepository = new SqliteRecoveryRepository(database, sessionRepository);
  const permissionRepository = new SqlitePermissionRepository(database);
  const toolExecutionRepository = new SqliteToolExecutionRepository(database);
  const workspaceRepository = new SqliteWorkspaceRepository(database);
  const settingsStore = createAppSettingsStore({ settingsPath: megumiHomePaths.settingsPath });
  const providerSettingsStore = createProviderSettingsStore({
    settings: settingsStore,
    env: options.hosts.environmentHost,
  });
  const runtimeLogger = createRuntimeJsonlLogger({ filePath: megumiHomePaths.runtimeLogPath, now: options.now });

  return {
    database,
    megumiHomePaths,
    settingsStore,
    providerSettingsStore,
    sessionRepository,
    projectRepository,
    runtimeEventRepository,
    timelineMessageRepository,
    recoveryRepository,
    permissionRepository,
    toolExecutionRepository,
    workspaceRepository,
    runtimeLogger,
  };
}
