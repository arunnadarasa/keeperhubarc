import { spawn } from "node:child_process";
import { deserialize } from "node:v8";

type LogEntry = {
  level: "log" | "warn" | "error";
  args: unknown[];
};

export type ChildOutcome =
  | { ok: true; result: unknown; logs: LogEntry[] }
  | {
      ok: false;
      errorMessage: string;
      errorStack?: string;
      logs: LogEntry[];
    };

/**
 * Environment variables forwarded to the sandbox child process. Everything
 * else is dropped so that a sandbox escape cannot read pod secrets from
 * process.env nor from /proc/self/environ (the child is a fresh OS process
 * started with execve, so its kernel-level environ is exactly this set).
 * Keep minimal: only what Node itself needs to start and make TLS calls.
 * Do NOT add application secrets here.
 */
const CHILD_ENV_ALLOWLIST = [
  "NODE_ENV",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "TZ",
  "LANG",
  "LC_ALL",
] as const;

function buildChildEnv(): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const key of CHILD_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as NodeJS.ProcessEnv;
}

/**
 * Script executed by the child node process. Reads a single JSON payload
 * from stdin, runs the user code in a vm.createContext sandbox, and writes
 * the outcome to stdout as a base64-encoded v8-serialized buffer so that
 * BigInt, Date, Map, Set, and typed arrays round-trip without JSON loss.
 * Inlined here so the Next.js bundler does not have to emit and resolve a
 * separate worker module at runtime.
 */
const CHILD_SOURCE = `
"use strict";
const { createContext, runInContext } = require("node:vm");
const v8 = require("node:v8");
const dnsPromises = require("node:dns").promises;
const { BlockList, isIP } = require("node:net");

const MAX_LOG_ENTRIES = 200;

// SSRF guard: ported from lib/safe-fetch.ts (KEEP-314). Modeled on the
// main-app pattern but inlined here because the sandbox package is
// zero-runtime-dep by design and the grandchild gets only node: builtins.
// The defense here is DNS-resolved denylist — it catches hostnames that
// resolve to RFC 1918, loopback, link-local (IMDS), CGNAT, and reserved
// ranges, where the old substring check only caught named metadata hosts.
// TOCTOU: we do not have undici's per-connect hook (would require adding
// undici as a sandbox dep), so there is a small window between our
// dns.lookup and the fetch's internal connect where the record could
// change. NetworkPolicy is the real defense for that (tracked elsewhere).
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const IPV4_MAPPED_PREFIX = "::ffff:";
const IPV4_MAPPED_HEX_REGEX = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

const SSRF_BLOCK_LIST = new BlockList();
SSRF_BLOCK_LIST.addSubnet("0.0.0.0", 8, "ipv4");
SSRF_BLOCK_LIST.addSubnet("10.0.0.0", 8, "ipv4");
SSRF_BLOCK_LIST.addSubnet("100.64.0.0", 10, "ipv4");
SSRF_BLOCK_LIST.addSubnet("127.0.0.0", 8, "ipv4");
SSRF_BLOCK_LIST.addSubnet("169.254.0.0", 16, "ipv4");
SSRF_BLOCK_LIST.addSubnet("172.16.0.0", 12, "ipv4");
SSRF_BLOCK_LIST.addSubnet("192.0.0.0", 24, "ipv4");
SSRF_BLOCK_LIST.addSubnet("192.0.2.0", 24, "ipv4");
SSRF_BLOCK_LIST.addSubnet("192.88.99.0", 24, "ipv4");
SSRF_BLOCK_LIST.addSubnet("192.168.0.0", 16, "ipv4");
SSRF_BLOCK_LIST.addSubnet("198.18.0.0", 15, "ipv4");
SSRF_BLOCK_LIST.addSubnet("198.51.100.0", 24, "ipv4");
SSRF_BLOCK_LIST.addSubnet("203.0.113.0", 24, "ipv4");
SSRF_BLOCK_LIST.addSubnet("224.0.0.0", 4, "ipv4");
SSRF_BLOCK_LIST.addSubnet("240.0.0.0", 4, "ipv4");
SSRF_BLOCK_LIST.addAddress("255.255.255.255", "ipv4");
SSRF_BLOCK_LIST.addAddress("::", "ipv6");
SSRF_BLOCK_LIST.addAddress("::1", "ipv6");
// Note: ::ffff:0:0/96 (IPv4-mapped IPv6) not added — Node treats that
// subnet as "all IPv4" which would make every IPv4 check return true.
// IPv4-mapped IPv6 pointing at private IPv4 is caught via the mapped
// extraction below.
SSRF_BLOCK_LIST.addSubnet("64:ff9b::", 96, "ipv6");
SSRF_BLOCK_LIST.addSubnet("100::", 64, "ipv6");
SSRF_BLOCK_LIST.addSubnet("fc00::", 7, "ipv6");
SSRF_BLOCK_LIST.addSubnet("fe80::", 10, "ipv6");
SSRF_BLOCK_LIST.addSubnet("ff00::", 8, "ipv6");

function extractMappedIpv4(ipv6) {
  const lower = ipv6.toLowerCase();
  if (!lower.startsWith(IPV4_MAPPED_PREFIX)) {
    return undefined;
  }
  const suffix = lower.slice(IPV4_MAPPED_PREFIX.length);
  if (isIP(suffix) === 4) {
    return suffix;
  }
  const hexMatch = suffix.match(IPV4_MAPPED_HEX_REGEX);
  if (!hexMatch) {
    return undefined;
  }
  const high = Number.parseInt(hexMatch[1] || "", 16);
  const low = Number.parseInt(hexMatch[2] || "", 16);
  if (!(Number.isFinite(high) && Number.isFinite(low))) {
    return undefined;
  }
  return [((high >> 8) & 0xff), (high & 0xff), ((low >> 8) & 0xff), (low & 0xff)].join(".");
}

function isBlockedIp(ip) {
  const family = isIP(ip);
  if (family === 0) {
    return { blocked: false };
  }
  const familyKey = family === 4 ? "ipv4" : "ipv6";
  if (SSRF_BLOCK_LIST.check(ip, familyKey)) {
    return { blocked: true, ip: ip };
  }
  if (family === 6) {
    const mapped = extractMappedIpv4(ip);
    if (mapped && SSRF_BLOCK_LIST.check(mapped, "ipv4")) {
      return { blocked: true, ip: mapped };
    }
  }
  return { blocked: false };
}

function stripIpv6Brackets(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

async function checkHostnameSsrf(hostname) {
  if (isIP(hostname) !== 0) {
    return isBlockedIp(hostname);
  }
  // all:true catches split-horizon DNS where A and AAAA differ — one
  // private address in the response is enough to reject.
  const records = await dnsPromises.lookup(hostname, { all: true });
  for (const rec of records) {
    const check = isBlockedIp(rec.address);
    if (check.blocked) {
      return check;
    }
  }
  return { blocked: false };
}

function safeCloneArg(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    try {
      return String(value);
    } catch (_e) {
      return "[unserializable]";
    }
  }
}

function run(input) {
  const { code, timeoutMs } = input;
  const logs = [];

  function capture(level) {
    return function capturedLogger() {
      if (logs.length >= MAX_LOG_ENTRIES) {
        return;
      }
      const args = new Array(arguments.length);
      for (let i = 0; i < arguments.length; i++) {
        args[i] = safeCloneArg(arguments[i]);
      }
      logs.push({ level: level, args: args });
    };
  }

  const capturedConsole = {
    log: capture("log"),
    warn: capture("warn"),
    error: capture("error"),
  };

  function extractUrl(resource) {
    if (typeof resource === "string") {
      return resource;
    }
    if (resource && typeof resource.url === "string") {
      return resource.url;
    }
    try {
      return String(resource);
    } catch (_) {
      return "";
    }
  }

  async function sandboxedFetch(resource, init) {
    const url = extractUrl(resource);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_e) {
      throw new TypeError("sandbox fetch: invalid URL: " + url);
    }
    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      throw new Error("sandbox fetch: scheme not allowed: " + parsed.protocol);
    }

    const hostname = stripIpv6Brackets(parsed.hostname);
    const ssrfCheck = await checkHostnameSsrf(hostname);
    if (ssrfCheck.blocked) {
      const targetIp = ssrfCheck.ip;
      const suffix = targetIp && targetIp !== hostname ? " -> " + targetIp : "";
      throw new Error(
        "sandbox fetch: SSRF blocked (" + hostname + suffix + ")"
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(function onTimeout() {
      controller.abort();
    }, timeoutMs);

    const callerSignal = init && init.signal ? init.signal : undefined;
    if (callerSignal && callerSignal.aborted) {
      controller.abort();
    } else if (callerSignal) {
      callerSignal.addEventListener(
        "abort",
        function onCallerAbort() {
          controller.abort();
        },
        { once: true }
      );
    }

    const nextInit = Object.assign({}, init, { signal: controller.signal });
    return fetch(resource, nextInit).finally(function clearTimer() {
      clearTimeout(timer);
    });
  }

  const sandbox = createContext({
    console: capturedConsole,
    fetch: sandboxedFetch,

    BigInt: BigInt, JSON: JSON, Math: Math, Date: Date, Array: Array,
    Object: Object, String: String, Number: Number, Boolean: Boolean,
    RegExp: RegExp, Symbol: Symbol,
    Map: Map, Set: Set, WeakMap: WeakMap, WeakSet: WeakSet, Promise: Promise,

    Error: Error, TypeError: TypeError, RangeError: RangeError,
    SyntaxError: SyntaxError, ReferenceError: ReferenceError, URIError: URIError,

    parseInt: parseInt, parseFloat: parseFloat,
    isNaN: isNaN, isFinite: isFinite, Infinity: Infinity, NaN: NaN,

    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    encodeURI: encodeURI, decodeURI: decodeURI,
    atob: atob, btoa: btoa,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder,

    ArrayBuffer: ArrayBuffer, DataView: DataView,
    Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array,
    Int8Array: Int8Array, Int16Array: Int16Array, Int32Array: Int32Array,
    Float32Array: Float32Array, Float64Array: Float64Array,
    BigInt64Array: BigInt64Array, BigUint64Array: BigUint64Array,

    URL: URL, URLSearchParams: URLSearchParams, Headers: Headers,
    Request: Request, Response: Response,
    AbortController: AbortController, AbortSignal: AbortSignal,

    structuredClone: structuredClone, Intl: Intl,
    crypto: { randomUUID: crypto.randomUUID.bind(crypto) },

    SharedArrayBuffer: undefined,
  });

  const wrappedCode = "(async () => {\\n" + code + "\\n})()";

  const userPromise = runInContext(wrappedCode, sandbox, {
    timeout: timeoutMs,
    filename: "user-code.js",
  }).then(
    function onResult(result) {
      return { ok: true, result: result, logs: logs };
    },
    function onError(err) {
      return {
        ok: false,
        errorMessage:
          err && err.message ? String(err.message) : String(err),
        errorStack: err && err.stack ? String(err.stack) : undefined,
        logs: logs,
      };
    }
  );

  // In-child wall-clock timeout. The vm \`timeout\` option only covers sync
  // CPU; a user promise that never settles (e.g. \`await new Promise(() => {})\`)
  // would otherwise let the child exit cleanly with code 0 the moment stdin
  // EOFs and no handles remain, producing a no-result outcome in the parent
  // instead of a timeout. The timer also keeps the event loop alive until a
  // race resolution.
  let timeoutTimer;
  const timeoutPromise = new Promise(function onTimeoutRace(resolveRace) {
    timeoutTimer = setTimeout(function onTimeoutFire() {
      resolveRace({
        ok: false,
        errorMessage:
          "Script execution timed out after " + String(timeoutMs) + " ms",
        logs: logs,
      });
    }, timeoutMs);
  });
  const settledUserPromise = userPromise.finally(function clearTimer() {
    clearTimeout(timeoutTimer);
  });
  return Promise.race([settledUserPromise, timeoutPromise]);
}

function writeResult(message) {
  let payload;
  try {
    payload = v8.serialize(message).toString("base64");
  } catch (cloneErr) {
    payload = v8
      .serialize({
        ok: false,
        errorMessage:
          "Result is not serializable: " +
          (cloneErr && cloneErr.message
            ? cloneErr.message
            : String(cloneErr)),
        errorStack: undefined,
        logs: [],
      })
      .toString("base64");
  }
  // Prefix with sentinel so the parent can ignore stray writes from user code
  // that reaches process.stdout via a sandbox escape.
  process.stdout.write("\\x01RESULT\\x02" + payload + "\\n");
}

let stdinBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function onData(chunk) {
  stdinBuf += chunk;
});
process.stdin.on("end", async function onEnd() {
  let input;
  try {
    input = JSON.parse(stdinBuf);
  } catch (e) {
    writeResult({
      ok: false,
      errorMessage: "Bad input to sandbox: " + (e && e.message ? e.message : String(e)),
      logs: [],
    });
    return;
  }
  try {
    const outcome = await run(input);
    writeResult(outcome);
  } catch (err) {
    writeResult({
      ok: false,
      errorMessage: err && err.message ? String(err.message) : String(err),
      errorStack: err && err.stack ? String(err.stack) : undefined,
      logs: [],
    });
  }
});
`;

const RESULT_SENTINEL = "\u0001RESULT\u0002";

function parseChildOutput(stdout: string): ChildOutcome {
  const idx = stdout.lastIndexOf(RESULT_SENTINEL);
  if (idx === -1) {
    return {
      ok: false,
      errorMessage: "Sandbox produced no result",
      logs: [],
    };
  }
  const newlineIdx = stdout.indexOf("\n", idx);
  const end = newlineIdx === -1 ? stdout.length : newlineIdx;
  const base64 = stdout.slice(idx + RESULT_SENTINEL.length, end).trim();
  try {
    return deserialize(Buffer.from(base64, "base64")) as ChildOutcome;
  } catch (_err) {
    return {
      ok: false,
      errorMessage: "Sandbox produced malformed result",
      logs: [],
    };
  }
}

/**
 * Spawn a child Node process with a scrubbed env, run the user code inside
 * it, and return the child's outcome. Kills the child on timeout or when
 * the caller's AbortSignal fires.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single cohesive spawner with timeout + stream aggregation + graceful teardown + signal wiring
async function runInChild(
  code: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<ChildOutcome> {
  return await new Promise<ChildOutcome>((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, errorMessage: "ABORTED", logs: [] });
      return;
    }

    const child = spawn(process.execPath, ["-e", CHILD_SOURCE], {
      env: buildChildEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const onAbort = (): void => {
      finish({ ok: false, errorMessage: "ABORTED", logs: [] });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(outcome: ChildOutcome): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch (_err) {
          // ignore; child may already have exited
        }
      }
      resolve(outcome);
    }

    const killTimer = setTimeout(() => {
      finish({ ok: false, errorMessage: "WALL_CLOCK_TIMEOUT", logs: [] });
    }, timeoutMs + 1000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err: Error) => {
      finish({
        ok: false,
        errorMessage: err.message || String(err),
        errorStack: err.stack,
        logs: [],
      });
    });

    child.on("close", (exitCode: number | null) => {
      const parsed = parseChildOutput(stdout);
      if (parsed.ok || exitCode === 0) {
        finish(parsed);
        return;
      }
      // Non-zero exit with no parseable result; surface stderr as a hint.
      finish({
        ok: false,
        errorMessage:
          parsed.errorMessage !== "Sandbox produced no result"
            ? parsed.errorMessage
            : `Sandbox process exited with code ${String(exitCode)}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ""}`,
        logs: [],
      });
    });

    try {
      child.stdin.write(JSON.stringify({ code, timeoutMs }));
      child.stdin.end();
    } catch (err) {
      finish({
        ok: false,
        errorMessage: `Failed to send code to sandbox: ${err instanceof Error ? err.message : String(err)}`,
        logs: [],
      });
    }
  });
}

/**
 * Public API: run `code` in a fresh scrubbed child process with a wall-clock
 * timeout of `timeoutMs` milliseconds. Resolves with a ChildOutcome describing
 * either the user result (v8-deserialized) or a structured error.
 */
export async function runCode(input: {
  code: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ChildOutcome> {
  return runInChild(input.code, input.timeoutMs, input.signal);
}
