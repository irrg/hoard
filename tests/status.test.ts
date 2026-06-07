import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadConfig = vi.hoisted(() => vi.fn());
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return { ...actual, readConfig: mockReadConfig };
});

import { cmdStatus } from "../src/status.js";

function makeConfig(overrides: Record<string, string | number> = {}) {
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

describe("cmdStatus", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((msg = "") => lines.push(String(msg)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows ✗ for unconfigured storefronts", async () => {
    mockReadConfig.mockResolvedValue(makeConfig());
    await cmdStatus();
    expect(lines.some((l) => l.includes("✗") && l.includes("itchio"))).toBe(true);
    expect(lines.some((l) => l.includes("✗") && l.includes("drivethru"))).toBe(true);
  });

  it("shows ✓ for itchio when username and password set", async () => {
    mockReadConfig.mockResolvedValue(
      makeConfig({ HOARD_ITCHIO_USERNAME: "robb", HOARD_ITCHIO_PASSWORD: "secret" }),
    );
    await cmdStatus(["itchio"]);
    expect(lines.some((l) => l.includes("✓") && l.includes("itchio"))).toBe(true);
  });

  it("shows ✓ for drivethru when API key set", async () => {
    mockReadConfig.mockResolvedValue(makeConfig({ HOARD_DRIVETHRU_API_KEY: "key123" }));
    await cmdStatus(["drivethru"]);
    expect(lines.some((l) => l.includes("✓") && l.includes("drivethru"))).toBe(true);
  });

  it("shows ~ for humblebundle (session cookie is ephemeral)", async () => {
    mockReadConfig.mockResolvedValue(makeConfig({ HOARD_HUMBLEBUNDLE_SESSION: "sess123" }));
    await cmdStatus(["humblebundle"]);
    expect(lines.some((l) => l.includes("~") && l.includes("humblebundle"))).toBe(true);
    expect(lines.some((l) => l.includes("session cookie"))).toBe(true);
  });

  it("shows ✓ for bundleofholding with email+password", async () => {
    mockReadConfig.mockResolvedValue(
      makeConfig({
        HOARD_BUNDLEOFHOLDING_EMAIL: "a@b.com",
        HOARD_BUNDLEOFHOLDING_PASSWORD: "pw",
      }),
    );
    await cmdStatus(["bundleofholding"]);
    expect(lines.some((l) => l.includes("✓") && l.includes("bundleofholding"))).toBe(true);
  });

  it("shows ~ for bundleofholding with cookie", async () => {
    mockReadConfig.mockResolvedValue(makeConfig({ HOARD_BUNDLEOFHOLDING_COOKIE: "cookie123" }));
    await cmdStatus(["bundleofholding"]);
    expect(lines.some((l) => l.includes("~") && l.includes("bundleofholding"))).toBe(true);
  });

  it("only shows requested storefronts", async () => {
    mockReadConfig.mockResolvedValue(makeConfig());
    await cmdStatus(["itchio"]);
    expect(lines.some((l) => l.includes("drivethru"))).toBe(false);
    expect(lines.some((l) => l.includes("itchio"))).toBe(true);
  });

  it("always prints output dir and jobs", async () => {
    mockReadConfig.mockResolvedValue(makeConfig({ HOARD_OUTPUT_DIR: "/mnt/hoard", HOARD_JOBS: 8 }));
    await cmdStatus(["itchio"]);
    expect(lines.some((l) => l.includes("/mnt/hoard"))).toBe(true);
    expect(lines.some((l) => l.includes("8"))).toBe(true);
  });
});
