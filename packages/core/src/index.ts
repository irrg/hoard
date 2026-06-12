export { Scheduler, FairScheduler } from './scheduler.js';
export type { RunTask } from './scheduler.js';
export { fetchWithRetry, streamToFile, md5sum, runConcurrently, NoDownloadError } from './utils.js';

export interface ProviderRuntime {
  network<T>(task: () => Promise<T>): Promise<T>;
  filesystem<T>(task: () => Promise<T>): Promise<T>;
}

export const directRuntime: ProviderRuntime = {
  network: (t) => t(),
  filesystem: (t) => t(),
};
