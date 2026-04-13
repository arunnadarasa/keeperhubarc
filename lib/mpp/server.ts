import { createHash } from "node:crypto";

const TEMPO_USDC_ADDRESS = "0x20c000000000000000000000b9537d11c60e8b50";

export function createMppServer(): unknown {
  // Lazy require to avoid loading mppx when MPP_SECRET_KEY is not set.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const server = require("mppx/server") as typeof import("mppx/server");
  const { Mppx, tempo } = server;

  return Mppx.create({
    methods: [tempo.charge({ currency: TEMPO_USDC_ADDRESS })],
  });
}

let _mppServer: ReturnType<typeof createMppServer> | null = null;

export function getMppServer(): ReturnType<typeof createMppServer> {
  if (!_mppServer) {
    _mppServer = createMppServer();
  }
  return _mppServer;
}

export function extractMppPayerAddress(source: string | null): string | null {
  if (!source) {
    return null;
  }
  if (!source.includes(":")) {
    return source.startsWith("0x") ? source : null;
  }
  const parts = source.split(":");
  return parts.at(-1) ?? null;
}

export function hashMppCredential(authHeaderValue: string): string {
  return createHash("sha256").update(authHeaderValue).digest("hex");
}
