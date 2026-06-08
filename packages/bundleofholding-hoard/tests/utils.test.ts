import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanPath, runConcurrently, NoDownloadError, download, fetchWithRetry } from "../src/utils.js";

describe("download", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws NoDownloadError when content-disposition is missing", async () => {
    fetchMock.mockResolvedValue({
      headers: { get: (h: string) => (h === "content-length" ? "100" : null) },
    });
    await expect(download("http://x.com/f", "/tmp", "name", "f.zip")).rejects.toBeInstanceOf(
      NoDownloadError,
    );
  });
});

describe("fetchWithRetry", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns response immediately when not 429", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    const r = await fetchWithRetry("http://x.com");
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns success", async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: { get: () => null } })
      .mockResolvedValueOnce({ status: 200 });
    const p = fetchWithRetry("http://x.com", undefined, 3);
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("respects Retry-After header", async () => {
    const waits: number[] = [];
    fetchMock
      .mockResolvedValueOnce({ status: 429, headers: { get: () => "5" } })
      .mockResolvedValueOnce({ status: 200 });
    vi.spyOn(global, "setTimeout").mockImplementation((fn, ms) => {
      waits.push(ms as number);
      (fn as () => void)();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    await fetchWithRetry("http://x.com", undefined, 3);
    expect(waits[0]).toBe(5000);
  });

  it("returns last 429 response after exhausting retries", async () => {
    fetchMock.mockResolvedValue({ status: 429, headers: { get: () => null } });
    const p = fetchWithRetry("http://x.com", undefined, 2);
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("NoDownloadError", () => {
  it("is an Error with the right name", () => {
    const e = new NoDownloadError("oops");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("NoDownloadError");
    expect(e.message).toBe("oops");
  });
});

describe("cleanPath", () => {
  it("replaces forbidden characters with dashes", () => {
    expect(cleanPath("game: the/beginning")).toBe("game- the-beginning");
    expect(cleanPath("foo<bar>")).toBe("foo-bar-");
    expect(cleanPath("pipe|name")).toBe("pipe-name");
    expect(cleanPath("back\\slash")).toBe("back-slash");
    expect(cleanPath('"quoted"')).toBe("-quoted-");
  });

  it("replaces trailing repeated-char-dot pattern", () => {
    expect(cleanPath("game...")).toBe("game-");
    expect(cleanPath("foo...")).toBe("foo-");
  });

  it("leaves clean slugs unchanged", () => {
    expect(cleanPath("my-game")).toBe("my-game");
    expect(cleanPath("grinningportal")).toBe("grinningportal");
  });
});

describe("runConcurrently", () => {
  it("runs all tasks", async () => {
    const ran: number[] = [];
    await runConcurrently(
      [1, 2, 3].map((n) => async () => {
        ran.push(n);
      }),
      2,
    );
    expect(ran.sort()).toEqual([1, 2, 3]);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    });
    await runConcurrently(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty task list", async () => {
    await expect(runConcurrently([], 4)).resolves.toBeUndefined();
  });

  it("drains in-flight tasks before propagating a rejection", async () => {
    const completed: number[] = [];
    const tasks = [
      async () => {
        throw new Error("boom");
      },
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        completed.push(2);
      },
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        completed.push(3);
      },
    ];
    await expect(runConcurrently(tasks, 3)).rejects.toThrow("boom");
    expect(completed).toContain(2);
    expect(completed).toContain(3);
  });
});
