export { Scheduler } from './scheduler.js';
export type { RunTask } from './scheduler.js';
export { fetchWithRetry, streamToFile, md5sum, runConcurrently, NoDownloadError } from './utils.js';

export interface HoardProvider {
  loadOrders(keys?: string[]): Promise<void>;
  downloadLibrary(): Promise<{ downloaded: number; errors: number }>;
}
