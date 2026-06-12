export {
  NoDownloadError,
  fetchWithRetry,
  streamToFile,
  md5sum,
  runConcurrently,
} from '@irrg/hoard-core';

export function normalizePathPart(part: string, compat: boolean): string {
  if (compat) {
    return part.replace(/[^a-zA-Z0-9.\s]/g, '_').replace(/\s+/g, ' ');
  }
  let p = unescapeHtml(part);
  p = p.replace(/[<>:"/\\|?*]/g, ' - ');
  p = p.replace(/^(\s*-\s*)+|(\s*-\s*)+$/g, '');
  p = p.replace(/(\s+-\s+)+/g, ' - ');
  p = p.replace(/\s+/g, ' ').trim();
  return p;
}

function unescapeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
