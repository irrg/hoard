export declare class NoDownloadError extends Error {
    constructor(message: string);
}
export declare function fetchWithRetry(url: string, options?: RequestInit, retries?: number): Promise<Response>;
export declare function streamToFile(url: string, outPath: string, cookie?: string): Promise<void>;
export declare function md5sum(filePath: string): Promise<string>;
export declare function cleanPath(p: string): string;
export declare function runConcurrently(tasks: Array<() => Promise<void>>, limit: number): Promise<void>;
