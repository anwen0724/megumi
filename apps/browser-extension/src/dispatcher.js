/* Dispatches one claimed read-only task to its platform-specific executor. */
import { executePlatformSearch } from './executors/platform-search.js';

export async function dispatchTask(task) {
  if (!task || task.request?.operation !== 'search') {
    return { status: 'failed', failure: { code: 'invalid_response', message: 'Unsupported browser task.' } };
  }
  if (!['xiaohongshu', 'douyin', 'zhihu'].includes(task.request.sourceId)) {
    return { status: 'failed', failure: { code: 'invalid_response', message: 'Unknown browser source.' } };
  }
  return executePlatformSearch(task.request);
}
