export {
  NoDownloadError,
  fetchWithRetry,
  streamToFile,
  md5sum,
  runConcurrently,
} from '@irrg/hoard-core';

export function cleanPath(p: string): string {
  return p.replace(/[<>:|?*"/\\]/g, '-').replace(/\.{2,}/g, '-');
}
