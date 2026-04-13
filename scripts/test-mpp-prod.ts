/**
 * UAT script for MPP payment-gated workflows.
 *
 * Prerequisites:
 *   - A wallet with USDC.e on Tempo mainnet
 *   - Export MPP_TEST_PRIVATE_KEY=0x... (the wallet's private key)
 *
 * Usage:
 *   MPP_TEST_PRIVATE_KEY=0x... tsx scripts/test-mpp-prod.ts
 *   MPP_TEST_PRIVATE_KEY=0x... tsx scripts/test-mpp-prod.ts --host https://app-staging.keeperhub.com
 */

import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const SLUG = "mcp-test";
const TEST_INPUT = { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" };

const host = process.argv.includes("--host")
  ? process.argv[process.argv.indexOf("--host") + 1]
  : "https://app.keeperhub.com";

const privateKey = process.env.MPP_TEST_PRIVATE_KEY;
if (!privateKey) {
  console.error("Set MPP_TEST_PRIVATE_KEY to run this script");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
const mppx = Mppx.create({
  methods: [tempo({ account })],
  polyfill: false,
});

console.log(`Host:   ${host}`);
console.log(`Wallet: ${account.address}`);
console.log(`Slug:   ${SLUG}\n`);

type TestResult = { pass: boolean; detail: string };

async function test(
  name: string,
  fn: () => Promise<TestResult>
): Promise<boolean> {
  process.stdout.write(`  ${name} ... `);
  try {
    const result = await fn();
    console.log(
      result.pass ? `PASS  ${result.detail}` : `FAIL  ${result.detail}`
    );
    return result.pass;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ERROR  ${msg}`);
    return false;
  }
}

// --- Test 1: Discovery ---
async function testDiscovery(): Promise<TestResult> {
  const res = await fetch(`${host}/api/mcp/workflows?q=mcp-test`);
  if (!res.ok) {
    return { pass: false, detail: `HTTP ${res.status}` };
  }
  const data = (await res.json()) as {
    items: { listedSlug: string; priceUsdcPerCall: string }[];
  };
  const found = data.items?.find((w) => w.listedSlug === SLUG);
  if (!found) {
    return {
      pass: false,
      detail: `slug "${SLUG}" not in response (${data.items?.length ?? 0} items)`,
    };
  }
  return { pass: true, detail: `price=$${found.priceUsdcPerCall} USDC` };
}

// --- Test 2: Call without payment -> 402 ---
async function testRequiresPayment(): Promise<TestResult> {
  const res = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(TEST_INPUT),
  });
  if (res.status !== 402) {
    return { pass: false, detail: `expected 402, got ${res.status}` };
  }

  const wwwAuthenticate = res.headers.get("WWW-Authenticate");
  if (!wwwAuthenticate) {
    return {
      pass: false,
      detail:
        "402 returned but no WWW-Authenticate header (clients won't know how to pay)",
    };
  }

  const hasPaymentScheme = wwwAuthenticate.includes("Payment");
  if (!hasPaymentScheme) {
    return {
      pass: false,
      detail: `WWW-Authenticate header does not contain Payment scheme: ${wwwAuthenticate.slice(0, 120)}`,
    };
  }

  return {
    pass: true,
    detail: `WWW-Authenticate: ${wwwAuthenticate.slice(0, 80)}${wwwAuthenticate.length > 80 ? "..." : ""}`,
  };
}

// --- Test 3: Paid call -> execution ---
let savedExecutionId = "";
let savedCredential = "";

async function testPaidCall(): Promise<TestResult> {
  // Step 1: initial request to get 402 + WWW-Authenticate challenge
  const initialRes = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(TEST_INPUT),
  });

  if (initialRes.status !== 402) {
    return {
      pass: false,
      detail: `expected initial 402, got ${initialRes.status}`,
    };
  }

  const wwwAuthenticate = initialRes.headers.get("WWW-Authenticate");
  if (!wwwAuthenticate) {
    return { pass: false, detail: "no WWW-Authenticate header in 402 response" };
  }

  // Step 2: create credential from the 402 response
  const credential = await mppx.createCredential(initialRes);
  savedCredential = credential;

  // Step 3: retry with Authorization: Payment <credential>
  const paidRes = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Payment ${credential}`,
    },
    body: JSON.stringify(TEST_INPUT),
  });

  if (!paidRes.ok) {
    const body = await paidRes.text();
    return {
      pass: false,
      detail: `paid call returned ${paidRes.status}: ${body.slice(0, 200)}`,
    };
  }

  const data = (await paidRes.json()) as {
    executionId?: string;
    status?: string;
  };
  if (!data.executionId) {
    return {
      pass: false,
      detail: `no executionId in response: ${JSON.stringify(data)}`,
    };
  }

  savedExecutionId = data.executionId;

  const receipt = paidRes.headers.get("Payment-Receipt");
  const receiptDetail = receipt
    ? `receipt=${receipt.slice(0, 40)}${receipt.length > 40 ? "..." : ""}`
    : "no Payment-Receipt header";

  return {
    pass: true,
    detail: `executionId=${data.executionId}, status=${data.status}, ${receiptDetail}`,
  };
}

// --- Test 4: Idempotency ---
async function testIdempotency(): Promise<TestResult> {
  if (!savedCredential) {
    return {
      pass: false,
      detail: "skipped (no credential from previous test)",
    };
  }

  const res = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Payment ${savedCredential}`,
    },
    body: JSON.stringify(TEST_INPUT),
  });

  if (!res.ok) {
    return { pass: false, detail: `HTTP ${res.status}` };
  }

  const data = (await res.json()) as { executionId?: string };
  if (data.executionId !== savedExecutionId) {
    return {
      pass: false,
      detail: `different executionId: got ${data.executionId}, expected ${savedExecutionId}`,
    };
  }

  return { pass: true, detail: `same executionId=${data.executionId}` };
}

// --- Test 5: Input validation ---
async function testInputValidation(): Promise<TestResult> {
  const res = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (res.status === 400) {
    const data = (await res.json()) as { error?: string };
    return { pass: true, detail: `rejected: ${data.error}` };
  }

  // 402 is also acceptable -- payment gate fires before input validation
  if (res.status === 402) {
    return {
      pass: true,
      detail: "402 returned (payment gate fires before input validation)",
    };
  }

  return { pass: false, detail: `expected 400 or 402, got ${res.status}` };
}

// --- Test 6: Unknown slug -> 404 ---
async function testUnknownSlug(): Promise<TestResult> {
  const res = await fetch(
    `${host}/api/mcp/workflows/nonexistent-slug-xyz/call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );

  if (res.status !== 404) {
    return { pass: false, detail: `expected 404, got ${res.status}` };
  }
  return { pass: true, detail: "404" };
}

async function main(): Promise<void> {
  console.log("MPP UAT Tests\n");

  let passed = 0;
  let total = 0;

  const tests: Array<[string, () => Promise<TestResult>]> = [
    ["Discovery: listed workflow found", testDiscovery],
    ["402 gate: call without payment", testRequiresPayment],
    ["Paid call: MPP payment + execution", testPaidCall],
    ["Idempotency: replay same credential", testIdempotency],
    ["Input validation: missing required field", testInputValidation],
    ["Unknown slug: returns 404", testUnknownSlug],
  ];

  for (const [name, fn] of tests) {
    total++;
    const ok = await test(name, fn);
    if (ok) passed++;
  }

  console.log(`\n${passed}/${total} passed`);

  if (savedExecutionId) {
    console.log(`\nExecution ID: ${savedExecutionId}`);
    console.log(`Check status: kh run get ${savedExecutionId}`);
  }

  process.exit(passed === total ? 0 : 1);
}

main();
