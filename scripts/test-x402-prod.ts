/**
 * UAT script for x402 payment-gated workflows on prod.
 *
 * Prerequisites:
 *   - A wallet with >= $0.10 USDC on Base mainnet
 *   - Export X402_TEST_PRIVATE_KEY=0x... (the wallet's private key)
 *
 * Usage:
 *   X402_TEST_PRIVATE_KEY=0x... tsx scripts/test-x402-prod.ts
 *   X402_TEST_PRIVATE_KEY=0x... tsx scripts/test-x402-prod.ts --host https://app-staging.keeperhub.com
 */

import type { PaymentRequired } from "@x402/core/types";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const SLUG = "mcp-test";
const TEST_INPUT = { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" };

const host = process.argv.includes("--host")
  ? process.argv[process.argv.indexOf("--host") + 1]
  : "https://app.keeperhub.com";

const privateKey = process.env.X402_TEST_PRIVATE_KEY;
if (!privateKey) {
  console.error("Set X402_TEST_PRIVATE_KEY to run this script");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

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
    console.log(result.pass ? `PASS  ${result.detail}` : `FAIL  ${result.detail}`);
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
  const data = (await res.json()) as { items: { listedSlug: string; priceUsdcPerCall: string }[] };
  const found = data.items?.find((w) => w.listedSlug === SLUG);
  if (!found) {
    return { pass: false, detail: `slug "${SLUG}" not in response (${data.items?.length ?? 0} items)` };
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

  const paymentRequired = res.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequired) {
    return {
      pass: false,
      detail: "402 returned but no PAYMENT-REQUIRED header (clients won't know how to pay)",
    };
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(paymentRequired, "base64").toString("utf-8")
    ) as { accepts?: unknown[]; resource?: { url?: string } | string };
    const acceptCount = Array.isArray(parsed.accepts) ? parsed.accepts.length : 0;
    const resourceUrl =
      typeof parsed.resource === "string"
        ? parsed.resource
        : parsed.resource?.url ?? "?";
    return {
      pass: acceptCount > 0,
      detail: `PAYMENT-REQUIRED has ${acceptCount} accept option(s), resource=${resourceUrl}`,
    };
  } catch {
    return {
      pass: false,
      detail: `PAYMENT-REQUIRED header not valid base64 JSON: ${paymentRequired.slice(0, 80)}...`,
    };
  }
}

// --- Test 3: Paid call -> execution ---
let savedExecutionId = "";
let savedPaymentSig = "";

async function testPaidCall(): Promise<TestResult> {
  // Step 1: initial request to get 402 + payment requirements
  const initialRes = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(TEST_INPUT),
  });

  if (initialRes.status !== 402) {
    return { pass: false, detail: `expected initial 402, got ${initialRes.status}` };
  }

  const paymentRequiredHeader = initialRes.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    return { pass: false, detail: "no PAYMENT-REQUIRED header in 402 response" };
  }

  // Step 2: parse the full paymentRequired object from the 402 response.
  // The shape is x402's PaymentRequired (v2) which isn't exported as a
  // runtime type, so we keep the local type minimal for display and pass
  // the raw object to createPaymentPayload which validates internally.
  const paymentRequired = JSON.parse(
    Buffer.from(paymentRequiredHeader, "base64").toString("utf-8")
  ) as Record<string, unknown> & {
    accepts: Array<{
      scheme: string;
      network: string;
      payTo: string;
      amount: string;
      asset: string;
      maxTimeoutSeconds: number;
      extra: Record<string, unknown>;
    }>;
    resource: { url: string; description: string; mimeType: string };
  };

  const firstAccept = paymentRequired.accepts[0];
  if (!firstAccept) {
    return { pass: false, detail: "no accept options in PAYMENT-REQUIRED" };
  }

  const amountUsdc = Number(firstAccept.amount ?? 0) / 1e6;
  console.log(
    `\n    Payment: $${amountUsdc.toFixed(2)} USDC on ${firstAccept.network} to ${firstAccept.payTo}`
  );

  // Step 3: sign payment (client selects scheme + network automatically)
  const paymentPayload = await client.createPaymentPayload(
    paymentRequired as unknown as PaymentRequired
  );
  const encoded = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  savedPaymentSig = encoded;

  // Step 4: retry with payment
  const paidRes = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": encoded,
    },
    body: JSON.stringify(TEST_INPUT),
  });

  if (!paidRes.ok) {
    const body = await paidRes.text();
    return { pass: false, detail: `paid call returned ${paidRes.status}: ${body.slice(0, 200)}` };
  }

  const data = (await paidRes.json()) as { executionId?: string; status?: string };
  if (!data.executionId) {
    return { pass: false, detail: `no executionId in response: ${JSON.stringify(data)}` };
  }

  savedExecutionId = data.executionId;
  return {
    pass: true,
    detail: `executionId=${data.executionId}, status=${data.status}`,
  };
}

// --- Test 4: Idempotency ---
async function testIdempotency(): Promise<TestResult> {
  if (!savedPaymentSig) {
    return { pass: false, detail: "skipped (no payment sig from previous test)" };
  }

  const res = await fetch(`${host}/api/mcp/workflows/${SLUG}/call`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": savedPaymentSig,
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
    return { pass: true, detail: "402 returned (payment gate fires before input validation)" };
  }

  return { pass: false, detail: `expected 400 or 402, got ${res.status}` };
}

// --- Test 6: Unknown slug -> 404 ---
async function testUnknownSlug(): Promise<TestResult> {
  const res = await fetch(`${host}/api/mcp/workflows/nonexistent-slug-xyz/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (res.status !== 404) {
    return { pass: false, detail: `expected 404, got ${res.status}` };
  }
  return { pass: true, detail: "404" };
}

async function main(): Promise<void> {
  console.log("x402 UAT Tests\n");

  let passed = 0;
  let total = 0;

  const tests: Array<[string, () => Promise<TestResult>]> = [
    ["Discovery: listed workflow found", testDiscovery],
    ["402 gate: call without payment", testRequiresPayment],
    ["Paid call: x402 payment + execution", testPaidCall],
    ["Idempotency: replay same payment sig", testIdempotency],
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
