// Provides the default node:fs-backed project file system for the product project
// service. File system access is a Host privilege, so it lives in the local
// adapter layer rather than the workspace product service.
import { stat as nodeStat } from 'node:fs/promises';
import type { ProjectFileSystem } from '../../../workspace/project-service';

export function createLocalProjectFileSystem(): ProjectFileSystem {
  return {
    stat: (path) => nodeStat(path),
  };
}
