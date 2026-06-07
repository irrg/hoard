import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSpinnerStart = vi.hoisted(() => vi.fn());
const mockSpinnerStop = vi.hoisted(() => vi.fn());
const mockSpinner = vi.hoisted(() =>
  vi.fn(() => ({ start: mockSpinnerStart, stop: mockSpinnerStop })),
);

vi.mock("@clack/prompts", () => ({ spinner: mockSpinner }));

const mockItchioLogin = vi.hoisted(() => vi.fn());
vi.mock("@irrg/itchio-hoard", () => ({ loginAPI: mockItchioLogin }));

const mockDrivethruAuthenticate = vi.hoisted(() => vi.fn());
vi.mock("@irrg/drivethru-hoard", () => ({
  Library: vi.fn(function () {
    // @ts-expect-error mock constructor
    this.authenticate = mockDrivethruAuthenticate;
  }),
}));

const mockBohLogin = vi.hoisted(() => vi.fn());
vi.mock("@irrg/bundleofholding-hoard", () => ({ loginWeb: mockBohLogin }));

import { cmdCheck } from "../src/check.js";

function makeConfig(overrides: Record<string, string> = {}) {
  return {
    HOARD_ITCHIO_USERNAME: "",
    HOARD_ITCHIO_PASSWORD: "",
    HOARD_HUMBLEBUNDLE_SESSION: "",
    HOARD_DRIVETHRU_API_KEY: "",
    HOARD_BUNDLEOFHOLDING_EMAIL: "",
    HOARD_BUNDLEOFHOLDING_PASSWORD: "",
    HOARD_BUNDLEOFHOLDING_COOKIE: "",
    HOARD_OUTPUT_DIR: "downloads",
    HOARD_JOBS: 4,
    ...overrides,
  };
}

describe("cmdCheck", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpinner.mockReturnValue({ start: mockSpinnerStart, stop: mockSpinnerStop });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("itchio", () => {
    it("reports not configured when credentials missing", async () => {
      await cmdCheck(makeConfig(), ["itchio"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("not configured"));
    });

    it("reports ✓ on successful login", async () => {
      mockItchioLogin.mockResolvedValue("token");
      await cmdCheck(makeConfig({ HOARD_ITCHIO_USERNAME: "robb", HOARD_ITCHIO_PASSWORD: "pw" }), [
        "itchio",
      ]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("✓"));
    });

    it("reports ✗ with error message on login failure", async () => {
      mockItchioLogin.mockRejectedValue(new Error("invalid credentials"));
      await cmdCheck(makeConfig({ HOARD_ITCHIO_USERNAME: "robb", HOARD_ITCHIO_PASSWORD: "pw" }), [
        "itchio",
      ]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("invalid credentials"));
    });
  });

  describe("drivethru", () => {
    it("reports not configured when API key missing", async () => {
      await cmdCheck(makeConfig(), ["drivethru"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("not configured"));
    });

    it("reports ✓ on successful auth", async () => {
      mockDrivethruAuthenticate.mockResolvedValue(undefined);
      await cmdCheck(makeConfig({ HOARD_DRIVETHRU_API_KEY: "key123" }), ["drivethru"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("✓"));
    });

    it("reports ✗ on auth failure", async () => {
      mockDrivethruAuthenticate.mockRejectedValue(new Error("Invalid API key"));
      await cmdCheck(makeConfig({ HOARD_DRIVETHRU_API_KEY: "bad" }), ["drivethru"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("Invalid API key"));
    });
  });

  describe("humblebundle", () => {
    it("reports not configured when session missing", async () => {
      await cmdCheck(makeConfig(), ["humblebundle"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("not configured"));
    });

    it("reports ✓ on successful cookie check", async () => {
      fetchMock.mockResolvedValue({ ok: true });
      await cmdCheck(makeConfig({ HOARD_HUMBLEBUNDLE_SESSION: "sess" }), ["humblebundle"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("✓"));
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("humblebundle.com"),
        expect.objectContaining({
          headers: expect.objectContaining({ Cookie: expect.stringContaining("sess") }),
        }),
      );
    });

    it("reports ✗ on HTTP error", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });
      await cmdCheck(makeConfig({ HOARD_HUMBLEBUNDLE_SESSION: "bad" }), ["humblebundle"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
    });
  });

  describe("bundleofholding", () => {
    it("reports not configured when credentials missing", async () => {
      await cmdCheck(makeConfig(), ["bundleofholding"]);
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("not configured"));
    });

    it("reports ✓ on successful login", async () => {
      mockBohLogin.mockResolvedValue("cookie");
      await cmdCheck(
        makeConfig({
          HOARD_BUNDLEOFHOLDING_EMAIL: "a@b.com",
          HOARD_BUNDLEOFHOLDING_PASSWORD: "pw",
        }),
        ["bundleofholding"],
      );
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("✓"));
    });

    it("reports ✗ on login failure", async () => {
      mockBohLogin.mockRejectedValue(new Error("bad credentials"));
      await cmdCheck(
        makeConfig({
          HOARD_BUNDLEOFHOLDING_EMAIL: "a@b.com",
          HOARD_BUNDLEOFHOLDING_PASSWORD: "pw",
        }),
        ["bundleofholding"],
      );
      expect(mockSpinnerStop).toHaveBeenCalledWith(expect.stringContaining("bad credentials"));
    });
  });

  it("only checks requested storefronts", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await cmdCheck(makeConfig({ HOARD_HUMBLEBUNDLE_SESSION: "sess" }), ["humblebundle"]);
    expect(mockSpinner).toHaveBeenCalledTimes(1);
    expect(mockItchioLogin).not.toHaveBeenCalled();
  });

  it("starts a spinner per storefront", async () => {
    mockItchioLogin.mockResolvedValue("tok");
    mockDrivethruAuthenticate.mockResolvedValue(undefined);
    await cmdCheck(
      makeConfig({
        HOARD_ITCHIO_USERNAME: "u",
        HOARD_ITCHIO_PASSWORD: "p",
        HOARD_DRIVETHRU_API_KEY: "k",
      }),
      ["itchio", "drivethru"],
    );
    expect(mockSpinner).toHaveBeenCalledTimes(2);
    expect(mockSpinnerStart).toHaveBeenCalledTimes(2);
    expect(mockSpinnerStop).toHaveBeenCalledTimes(2);
  });
});
