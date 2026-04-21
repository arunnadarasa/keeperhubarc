import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const IMPORT_RELATIVE_TURNKEY_OPERATIONS =
  /from ["']\.\/turnkey-operations["']/;
const IMPORT_ALIAS_TURNKEY_OPERATIONS =
  /from ["']@\/lib\/turnkey\/turnkey-operations["']/;
const AGENTIC_RPID_DEFINITION = /AGENTIC_RPID\s*=\s*["']([^"']+)["']/g;
const EXPORT_CREATE_AGENTIC_WALLET =
  /export\s+(async\s+)?function\s+createAgenticWallet/;
const EXPORT_GET_TURNKEY_CLIENT_FOR_ORG =
  /export\s+function\s+getTurnkeyClientForOrg/;

describe("agentic-wallet module boundary", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/turnkey/agentic-wallet.ts"),
    "utf8"
  );

  it("does not import from turnkey-operations", () => {
    expect(source).not.toMatch(IMPORT_RELATIVE_TURNKEY_OPERATIONS);
    expect(source).not.toMatch(IMPORT_ALIAS_TURNKEY_OPERATIONS);
  });

  it("does not reference createTurnkeyWallet", () => {
    expect(source).not.toContain("createTurnkeyWallet");
  });

  it("defines AGENTIC_RPID exactly once as keeperhub.com", () => {
    const matches = source.match(AGENTIC_RPID_DEFINITION);
    expect(matches).toHaveLength(1);
    expect(source).toContain('AGENTIC_RPID = "keeperhub.com"');
  });

  it("does not leak app.keeperhub.com variant", () => {
    expect(source).not.toContain("app.keeperhub.com");
  });

  it("exports createAgenticWallet and getTurnkeyClientForOrg", () => {
    expect(source).toMatch(EXPORT_CREATE_AGENTIC_WALLET);
    expect(source).toMatch(EXPORT_GET_TURNKEY_CLIENT_FOR_ORG);
  });
});
