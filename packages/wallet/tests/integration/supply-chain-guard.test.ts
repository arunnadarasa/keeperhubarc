import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("supply-chain guard (DIST-03)", () => {
  it("package.json has no postinstall, preinstall, or install script", async () => {
    const raw = await readFile(
      resolve(import.meta.dirname, "../../package.json"),
      "utf-8"
    );
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    expect(
      scripts.postinstall,
      "postinstall is a supply-chain vector (DIST-03)"
    ).toBeUndefined();
    expect(
      scripts.preinstall,
      "preinstall is a supply-chain vector (DIST-03)"
    ).toBeUndefined();
    expect(
      scripts.install,
      "install is a supply-chain vector (DIST-03)"
    ).toBeUndefined();
  });

  it("viem and commander are pinned to exact versions (no semver ranges)", async () => {
    const raw = await readFile(
      resolve(import.meta.dirname, "../../package.json"),
      "utf-8"
    );
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    expect(deps.viem).toBe("2.48.1");
    expect(deps.commander).toBe("14.0.3");
    for (const [name, range] of Object.entries(deps)) {
      expect(
        range.startsWith("^") || range.startsWith("~"),
        `${name} uses floating range ${range}`
      ).toBe(false);
    }
  });
});
