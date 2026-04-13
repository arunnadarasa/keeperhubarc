export type PaymentProtocol = "x402" | "mpp";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, PAYMENT-SIGNATURE",
  "Access-Control-Expose-Headers": "Payment-Receipt",
} as const;

type Dual402Params = {
  price: string;
  creatorWalletAddress: string;
  workflowName: string;
};

export function buildDual402Response(params: Dual402Params): Response {
  const { price, creatorWalletAddress, workflowName } = params;

  const x402Requirements = {
    accepts: {
      scheme: "exact",
      network: "eip155:8453",
      payTo: creatorWalletAddress,
      price: `$${Number(price).toFixed(2)}`,
    },
    description: `Pay to run workflow: ${workflowName}`,
  };

  const x402Header = Buffer.from(JSON.stringify(x402Requirements)).toString(
    "base64"
  );

  const headers = new Headers(CORS_HEADERS);
  headers.set("X-PAYMENT-REQUIREMENTS", x402Header);
  headers.set("Cache-Control", "no-store");

  return new Response(
    JSON.stringify({
      error: "Payment Required",
      x402: x402Requirements,
    }),
    { status: 402, headers }
  );
}

export type PaymentMeta = {
  protocol: PaymentProtocol;
  chain: "base" | "tempo";
  payerAddress: string | null;
};

export function detectProtocol(
  request: Request
): PaymentProtocol | "error" | null {
  const hasAuthorization = request.headers
    .get("authorization")
    ?.startsWith("Payment ");
  const hasPaymentSig = Boolean(request.headers.get("PAYMENT-SIGNATURE"));

  if (hasAuthorization && hasPaymentSig) {
    return "error";
  }
  if (hasAuthorization) {
    return "mpp";
  }
  if (hasPaymentSig) {
    return "x402";
  }
  return null;
}
