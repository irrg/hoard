export { fetchWithRetry, streamToFile, md5sum, runConcurrently } from '@irrg/hoard-core';

export function cleanPath(p: string): string {
  let s = p.replace(/[<>:|?*"/\\]/g, '-');
  s = s.replace(/(.)[.]\1+$/, '-');
  return s.trim();
}
