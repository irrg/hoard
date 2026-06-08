import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({ existsSync: vi.fn() }));

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  appendFile: vi.fn(),
}));

vi.mock("../src/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/utils.js")>();
  return { ...actual, download: vi.fn(), md5sum: vi.fn() };
});

import { existsSync } from "fs";
import { readFile, writeFile, mkdir, rename, appendFile } from "fs/promises";
import { download, md5sum, NoDownloadError } from "../src/utils.js";
import { Game } from "../src/game.js";
import type { Upload } from "../src/game.js";

const gameData = {
  id: 1111,
  game_id: 9999,
  game: {
    title: "Test Game",
    user: { username: "dev" },
    url: "https://dev.itch.io/test-game",
    id: 9999,
  },
};

function makeGame() {
  return new Game(gameData);
}

function makeUpload(overrides: Partial<Upload> = {}): Upload {
  return { id: 42, filename: "game.zip", md5_hash: "abc123", ...overrides };
}

function mockSession(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce({
    status: 200,
    json: async () => ({ uuid: "test-uuid" }),
  });
}

describe("Game.loadDownloads", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("populates downloads from API response", async () => {
    const uploads = [makeUpload(), makeUpload({ id: 43, filename: "manual.pdf" })];
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ uploads }),
    });
    const g = makeGame();
    await g.loadDownloads("tok");
    expect(g.downloads).toHaveLength(2);
  });

  it("includes download_key_id when game has an owned-key id", async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ uploads: [] }) });
    await makeGame().loadDownloads("tok");
    expect(fetchMock.mock.calls[0][0]).toContain("download_key_id=1111");
  });

  it("omits download_key_id for games without an owned-key id", async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ uploads: [] }) });
    await new Game({ game: gameData.game }).loadDownloads("tok");
    expect(fetchMock.mock.calls[0][0]).not.toContain("download_key_id");
  });

  it("returns empty downloads on JSON parse failure", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => { throw new SyntaxError("bad"); },
    });
    const g = makeGame();
    await g.loadDownloads("tok");
    expect(g.downloads).toHaveLength(0);
  });
});

describe("Game.doDownload", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(appendFile).mockResolvedValue(undefined);
    vi.mocked(download).mockResolvedValue(undefined);
    vi.mocked(md5sum).mockResolvedValue("abc123");
  });

  it("fetches a session UUID and downloads the file", async () => {
    mockSession(fetchMock);
    await makeGame().doDownload(makeUpload(), "mytoken");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("download-sessions"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining("uuid=test-uuid"),
      expect.any(String),
      "Test Game",
      "game.zip",
    );
  });

  it("includes download_key_id in download URL for owned-key games", async () => {
    mockSession(fetchMock);
    await makeGame().doDownload(makeUpload(), "tok");
    expect(download).toHaveBeenCalledWith(
      expect.stringContaining("download_key_id=1111"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it("writes .md5 sidecar after successful verified download", async () => {
    mockSession(fetchMock);
    vi.mocked(md5sum).mockResolvedValue("abc123");
    await makeGame().doDownload(makeUpload({ md5_hash: "abc123" }), "tok");
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(".md5"),
      "abc123",
    );
  });

  it("logs failure but does not throw when MD5 verification fails post-download", async () => {
    mockSession(fetchMock);
    vi.mocked(md5sum).mockResolvedValue("wrong-hash");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeGame().doDownload(makeUpload({ md5_hash: "abc123" }), "tok");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to verify"));
    expect(writeFile).not.toHaveBeenCalledWith(expect.stringContaining(".md5"), expect.anything());
    consoleSpy.mockRestore();
  });

  it("skips when file exists and has no md5_hash", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    await makeGame().doDownload(makeUpload({ md5_hash: undefined }), "tok");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("skips when .md5 sidecar matches", async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValue("abc123" as unknown as Buffer);
    await makeGame().doDownload(makeUpload(), "tok");
    expect(download).not.toHaveBeenCalled();
  });

  it("skips and writes sidecar when computed MD5 matches and sidecar is absent", async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(md5sum).mockResolvedValue("abc123");
    await makeGame().doDownload(makeUpload(), "tok");
    expect(download).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining(".md5"), "abc123");
  });

  it("moves file to old/ and re-downloads on .md5 mismatch", async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValue("old-hash" as unknown as Buffer);
    mockSession(fetchMock);
    await makeGame().doDownload(makeUpload(), "tok");
    expect(rename).toHaveBeenCalledWith(
      expect.stringContaining("game.zip"),
      expect.stringContaining("old"),
    );
    expect(download).toHaveBeenCalled();
  });

  it("moves file to old/ and re-downloads when computed MD5 mismatches", async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(md5sum).mockResolvedValue("different-hash");
    mockSession(fetchMock);
    await makeGame().doDownload(makeUpload(), "tok");
    expect(rename).toHaveBeenCalled();
    expect(download).toHaveBeenCalled();
  });

  it("returns early without downloading when session request fails", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      json: async () => { throw new SyntaxError("bad"); },
    });
    await makeGame().doDownload(makeUpload(), "tok");
    expect(download).not.toHaveBeenCalled();
  });

  it("logs to errors.txt with redacted API key on NoDownloadError", async () => {
    mockSession(fetchMock);
    vi.mocked(download).mockRejectedValue(new NoDownloadError("no headers"));
    await makeGame().doDownload(makeUpload(), "secret-key");
    expect(appendFile).toHaveBeenCalledWith(
      "downloads/errors.txt",
      expect.stringContaining("api_key=REDACTED"),
    );
    const logged = vi.mocked(appendFile).mock.calls[0][1] as string;
    expect(logged).not.toContain("secret-key");
  });

  it("logs to errors.txt on generic Error", async () => {
    mockSession(fetchMock);
    vi.mocked(download).mockRejectedValue(new Error("network failure"));
    await makeGame().doDownload(makeUpload(), "tok");
    expect(appendFile).toHaveBeenCalledWith("downloads/errors.txt", expect.stringContaining("game.zip"));
  });
});
