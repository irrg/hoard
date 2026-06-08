import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Library } from "../src/library.js";
import { NoDownloadError } from "../src/utils.js";
import type { Game } from "../src/game.js";
import type { UserProfile, Collection, BundleKey } from "../src/library.js";

function mockResponse(body: unknown, status = 200) {
  return {
    status,
    json: async () => body,
  } as unknown as Response;
}

function gameFixture(id: number) {
  return {
    id,
    game_id: id * 10,
    game: {
      title: `Game ${id}`,
      user: { username: "dev" },
      url: `https://dev.itch.io/game-${id}`,
      id: id * 10,
    },
  };
}

describe("Library", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("defaults to 4 jobs", () => {
      expect(new Library("tok").jobs).toBe(4);
    });

    it("caps jobs at 8", () => {
      expect(new Library("tok", 100).jobs).toBe(8);
    });
  });

  describe("loadGamePage", () => {
    it("returns game count and populates lib.games", async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ owned_keys: [gameFixture(1), gameFixture(2)] }),
      );
      const lib = new Library("tok");
      const n = await lib.loadGamePage(1);
      expect(n).toBe(2);
      expect(lib.games).toHaveLength(2);
      expect(lib.games[0].name).toBe("Game 1");
    });

    it("returns 0 for an empty page", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ owned_keys: [] }));
      const lib = new Library("tok");
      expect(await lib.loadGamePage(1)).toBe(0);
    });

    it("returns 0 when owned_keys is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      const lib = new Library("tok");
      expect(await lib.loadGamePage(1)).toBe(0);
    });

    it("returns 0 and logs on JSON parse failure", async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        json: async () => {
          throw new SyntaxError("bad json");
        },
      } as unknown as Response);
      const lib = new Library("tok");
      expect(await lib.loadGamePage(1)).toBe(0);
      expect(lib.games).toHaveLength(0);
    });

    it("sends the Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ owned_keys: [] }));
      await new Library("my-token").loadGamePage(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("page=1"),
        expect.objectContaining({ headers: { Authorization: "my-token" } }),
      );
    });
  });

  describe("loadOwnedGames", () => {
    it("paginates until an empty page is returned", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ owned_keys: [gameFixture(1), gameFixture(2)] }))
        .mockResolvedValueOnce(mockResponse({ owned_keys: [gameFixture(3)] }))
        .mockResolvedValueOnce(mockResponse({ owned_keys: [] }));

      const lib = new Library("tok");
      await lib.loadOwnedGames();

      expect(lib.games).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("stops on the first page when it has no games", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ owned_keys: [] }));
      const lib = new Library("tok");
      await lib.loadOwnedGames();
      expect(lib.games).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("downloadLibrary", () => {
    function fakeGame(fail: "none" | "download" | "other" = "none"): Game {
      return {
        name: "Fake Game",
        download: fail === "none"
          ? vi.fn().mockResolvedValue(undefined)
          : fail === "download"
            ? vi.fn().mockRejectedValue(new NoDownloadError("nope"))
            : vi.fn().mockRejectedValue(new Error("unexpected")),
      } as unknown as Game;
    }

    it("downloads all games and logs completion", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const lib = new Library("tok");
      lib.games = [fakeGame(), fakeGame()];
      await lib.downloadLibrary();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Downloaded 2 Games"));
      consoleSpy.mockRestore();
    });

    it("counts NoDownloadError as an error, not a crash", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const lib = new Library("tok");
      lib.games = [fakeGame(), fakeGame("download")];
      await lib.downloadLibrary();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("1 Errors"));
      consoleSpy.mockRestore();
    });

    it("propagates unexpected errors", async () => {
      const lib = new Library("tok");
      lib.games = [fakeGame("other")];
      await expect(lib.downloadLibrary()).rejects.toThrow("unexpected");
    });

    it("passes platform filter through to game.download", async () => {
      const game = fakeGame();
      const lib = new Library("tok");
      lib.games = [game];
      await lib.downloadLibrary("osx");
      expect(game.download).toHaveBeenCalledWith("tok", "osx");
    });
  });

  describe("getProfile", () => {
    it("returns user profile on success", async () => {
      const profile: UserProfile = { id: 1, username: "robb", display_name: "Robb" };
      fetchMock.mockResolvedValueOnce(mockResponse({ user: profile }));
      await expect(new Library("tok").getProfile()).resolves.toEqual(profile);
    });

    it("returns null when user is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      await expect(new Library("tok").getProfile()).resolves.toBeNull();
    });

    it("returns null on JSON parse failure", async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        json: async () => { throw new SyntaxError("bad"); },
      } as unknown as Response);
      await expect(new Library("tok").getProfile()).resolves.toBeNull();
    });

    it("sends Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ user: { id: 1, username: "u" } }));
      await new Library("my-token").getProfile();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/profile"),
        expect.objectContaining({ headers: { Authorization: "my-token" } }),
      );
    });
  });

  describe("loadCollections", () => {
    it("returns collections array on success", async () => {
      const collections: Collection[] = [
        { id: 10, title: "Favorites", games_count: 5 },
        { id: 11, title: "Wishlist", games_count: 3 },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse({ collections }));
      await expect(new Library("tok").loadCollections()).resolves.toEqual(collections);
    });

    it("returns empty array when collections is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      await expect(new Library("tok").loadCollections()).resolves.toEqual([]);
    });

    it("returns empty array on JSON parse failure", async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        json: async () => { throw new SyntaxError("bad"); },
      } as unknown as Response);
      await expect(new Library("tok").loadCollections()).resolves.toEqual([]);
    });

    it("sends Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ collections: [] }));
      await new Library("my-token").loadCollections();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/profile/collections"),
        expect.objectContaining({ headers: { Authorization: "my-token" } }),
      );
    });
  });

  describe("loadCollection", () => {
    function collectionGame(id: number) {
      return {
        game: {
          id,
          title: `Game ${id}`,
          url: `https://dev.itch.io/game-${id}`,
          user: { username: "dev" },
        },
      };
    }

    it("paginates until an empty page", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ collection_games: [collectionGame(1), collectionGame(2)] }))
        .mockResolvedValueOnce(mockResponse({ collection_games: [collectionGame(3)] }))
        .mockResolvedValueOnce(mockResponse({ collection_games: [] }));
      const lib = new Library("tok");
      await lib.loadCollection(42);
      expect(lib.games).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("stops on the first page when empty", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ collection_games: [] }));
      const lib = new Library("tok");
      await lib.loadCollection(42);
      expect(lib.games).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops when collection_games is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      const lib = new Library("tok");
      await lib.loadCollection(42);
      expect(lib.games).toHaveLength(0);
    });

    it("stops on JSON parse failure", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ collection_games: [collectionGame(1)] }))
        .mockResolvedValueOnce({
          status: 500,
          json: async () => { throw new SyntaxError("bad"); },
        } as unknown as Response);
      const lib = new Library("tok");
      await lib.loadCollection(42);
      expect(lib.games).toHaveLength(1);
    });

    it("includes collection id in request URL", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ collection_games: [] }));
      await new Library("tok").loadCollection(99);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/collections/99/collection-games"),
        expect.any(Object),
      );
    });

    it("sends Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ collection_games: [] }));
      await new Library("my-token").loadCollection(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: { Authorization: "my-token" } }),
      );
    });
  });

  describe("loadBundles", () => {
    function bundleKeyFixture(id: number): BundleKey {
      return {
        id: id * 100,
        bundle_id: id,
        bundle: { id, title: `Bundle ${id}`, games_count: id * 10 },
      };
    }

    it("returns bundle keys on success", async () => {
      const bundle_keys = [bundleKeyFixture(1), bundleKeyFixture(2)];
      fetchMock.mockResolvedValueOnce(mockResponse({ bundle_keys }));
      await expect(new Library("tok").loadBundles()).resolves.toEqual(bundle_keys);
    });

    it("returns empty array when bundle_keys is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      await expect(new Library("tok").loadBundles()).resolves.toEqual([]);
    });

    it("returns empty array on JSON parse failure", async () => {
      fetchMock.mockResolvedValueOnce({
        status: 500,
        json: async () => { throw new SyntaxError("bad"); },
      } as unknown as Response);
      await expect(new Library("tok").loadBundles()).resolves.toEqual([]);
    });

    it("sends Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ bundle_keys: [] }));
      await new Library("my-token").loadBundles();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/profile/owned-bundles"),
        expect.objectContaining({ headers: { Authorization: "my-token" } }),
      );
    });
  });

  describe("loadBundle", () => {
    function bundleGame(id: number) {
      return {
        game: {
          id,
          title: `Game ${id}`,
          url: `https://dev.itch.io/game-${id}`,
          user: { username: "dev" },
        },
      };
    }

    it("paginates until an empty page", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ bundle_games: [bundleGame(1), bundleGame(2)] }))
        .mockResolvedValueOnce(mockResponse({ bundle_games: [bundleGame(3)] }))
        .mockResolvedValueOnce(mockResponse({ bundle_games: [] }));
      const lib = new Library("tok");
      await lib.loadBundle(42);
      expect(lib.games).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("stops on the first page when empty", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ bundle_games: [] }));
      const lib = new Library("tok");
      await lib.loadBundle(42);
      expect(lib.games).toHaveLength(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops when bundle_games is absent", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({}));
      const lib = new Library("tok");
      await lib.loadBundle(42);
      expect(lib.games).toHaveLength(0);
    });

    it("stops on JSON parse failure", async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse({ bundle_games: [bundleGame(1)] }))
        .mockResolvedValueOnce({
          status: 500,
          json: async () => { throw new SyntaxError("bad"); },
        } as unknown as Response);
      const lib = new Library("tok");
      await lib.loadBundle(42);
      expect(lib.games).toHaveLength(1);
    });

    it("includes bundle id in request URL", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ bundle_games: [] }));
      await new Library("tok").loadBundle(99);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/bundles/99/bundle-games"),
        expect.any(Object),
      );
    });

    it("sends Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ bundle_games: [] }));
      await new Library("my-token").loadBundle(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: { Authorization: "my-token" } }),
      );
    });
  });
});
