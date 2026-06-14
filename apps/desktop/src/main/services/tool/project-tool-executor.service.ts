// Compatibility wrapper for legacy callers that still request a project tool executor.
import { createBuiltInToolSourceExecutor } from './built-in-tool-source-executor.service';
import {
  createToolExecutionRouter,
  type ToolExecutionRouter,
} from './tool-execution-router.service';
import type { ProjectToolExecutorOptions } from './tool-executors';

export type { ProjectToolFileSystem, ProjectToolExecutorOptions } from './tool-executors';

export type ProjectToolExecutor = ToolExecutionRouter;

export function createProjectToolExecutor(options: ProjectToolExecutorOptions): ProjectToolExecutor {
  // New runtime composition should create ToolExecutionRouter directly. This
  // compatibility wrapper exists for focused tests and pre-Plan-4 call sites.
  return createToolExecutionRouter({
    sourceExecutors: [createBuiltInToolSourceExecutor(options)],
    now: options.now,
    ids: options.ids,
  });
}
