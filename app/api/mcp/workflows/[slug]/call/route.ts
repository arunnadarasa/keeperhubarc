import { withX402 } from "@x402/next";
import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { checkConcurrencyLimit } from "@/app/api/execute/_lib/concurrency-limit";
import { enforceExecutionLimit } from "@/lib/billing/execution-guard";
import { db } from "@/lib/db";
import { organization, workflowExecutions, workflows } from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { checkIpRateLimit, getClientIp } from "@/lib/mcp/rate-limit";
import { executeWorkflow } from "@/lib/workflow-executor.workflow";
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-store";
import {
  buildPaymentConfig,
  extractPayerAddress,
  findExistingPayment,
  hashPaymentSignature,
  recordPayment,
  resolveCreatorWallet,
} from "@/lib/x402/payment-gate";
import {
  isTimeoutError,
  pollForPaymentConfirmation,
} from "@/lib/x402/reconcile";
import { server } from "@/lib/x402/server";
import { CALL_ROUTE_COLUMNS, type CallRouteWorkflow } from "@/lib/x402/types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, PAYMENT-SIGNATURE",
} as const;

export function OPTIONS(): NextResponse {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Validates required fields from a JSON Schema object against the request body.
 * Only checks that required fields are present -- does not strictly validate types
 * or reject extra fields (callers may include metadata).
 */
function validateInputSchema(
  inputSchema: Record<string, unknown>,
  body: Record<string, unknown>
): { valid: true } | { valid: false; error: string } {
  if (!("properties" in inputSchema)) {
    return { valid: true };
  }

  const required = inputSchema.required;
  if (!Array.isArray(required)) {
    return { valid: true };
  }

  for (const field of required) {
    if (typeof field === "string" && !(field in body)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  return { valid: true };
}

/**
 * Runs execution guards, creates a workflow execution record, and starts the
 * workflow in the background. Returns { executionId, status: "running" }
 * immediately (fire-and-forget pattern).
 *
 * Shared by both free and paid call paths to avoid duplicating the
 * guard/insert/start sequence.
 */
async function createAndStartExecution(
  workflow: CallRouteWorkflow,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const executionGuard = await enforceExecutionLimit(workflow.organizationId);
  if (executionGuard.blocked) {
    const guardBody = await executionGuard.response.json();
    return NextResponse.json(guardBody, { status: 429, headers: corsHeaders });
  }

  const concurrencyCheck = await checkConcurrencyLimit();
  if (!concurrencyCheck.allowed) {
    return NextResponse.json(
      {
        error: "Too many concurrent workflow executions",
        running: concurrencyCheck.running,
        limit: concurrencyCheck.limit,
      },
      { status: 429, headers: { ...corsHeaders, "Retry-After": "30" } }
    );
  }

  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId: workflow.id,
      userId: workflow.userId,
      status: "running",
      input: body,
    })
    .returning();

  const executionId = execution.id;

  // Fire-and-forget: return immediately, workflow runs in background
  start(executeWorkflow, [
    {
      nodes: workflow.nodes as WorkflowNode[],
      edges: workflow.edges as WorkflowEdge[],
      triggerInput: body,
      executionId,
      workflowId: workflow.id,
      organizationId: workflow.organizationId ?? undefined,
    },
  ]).catch((err: unknown) => {
    logSystemError(
      ErrorCategory.WORKFLOW_ENGINE,
      "[x402/call] Error starting workflow execution",
      err,
      { endpoint: "/api/mcp/workflows/[slug]/call", workflowId: workflow.id }
    );
  });

  return NextResponse.json(
    { executionId, status: "running" },
    { headers: corsHeaders }
  );
}

async function lookupWorkflow(
  slug: string,
  orgSlug?: string
): Promise<CallRouteWorkflow | null> {
  const filters = [
    eq(workflows.listedSlug, slug),
    eq(workflows.isListed, true),
  ];

  if (orgSlug) {
    const rows = await db
      .select(CALL_ROUTE_COLUMNS)
      .from(workflows)
      .innerJoin(organization, eq(workflows.organizationId, organization.id))
      .where(and(...filters, eq(organization.slug, orgSlug)))
      .limit(1);
    return rows[0]?.workflows ?? null;
  }

  const rows = await db
    .select(CALL_ROUTE_COLUMNS)
    .from(workflows)
    .where(and(...filters))
    .limit(1);
  return rows[0] ?? null;
}

function validateBody(
  workflow: CallRouteWorkflow,
  body: Record<string, unknown>
): NextResponse | null {
  if (workflow.inputSchema !== null && "properties" in workflow.inputSchema) {
    const validation = validateInputSchema(workflow.inputSchema, body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: corsHeaders }
      );
    }
  }
  return null;
}

async function checkIdempotency(
  paymentSig: string | null
): Promise<NextResponse | null> {
  if (!paymentSig) {
    return null;
  }
  const hash = hashPaymentSignature(paymentSig);
  const existing = await findExistingPayment(hash);
  if (existing) {
    return NextResponse.json(
      { executionId: existing.executionId },
      { headers: corsHeaders }
    );
  }
  return null;
}

async function handleTimeoutReconciliation(
  gateErr: unknown,
  request: Request,
  innerHandler: (req: NextRequest) => Promise<NextResponse>
): Promise<NextResponse> {
  const msg = gateErr instanceof Error ? gateErr.message : String(gateErr);
  if (isTimeoutError(msg)) {
    const payerAddr = request.headers.get("X-PAYER-ADDRESS");
    const nonce = request.headers.get("X-PAYMENT-NONCE");
    if (payerAddr && nonce) {
      const confirmed = await pollForPaymentConfirmation({
        payerAddress: payerAddr,
        nonce,
      });
      if (confirmed) {
        // Re-check idempotency before executing. A client retry may have
        // already created an execution while we were polling on-chain state.
        const paymentSig = request.headers.get("PAYMENT-SIGNATURE");
        const idempotent = await checkIdempotency(paymentSig);
        if (idempotent) {
          return idempotent;
        }
        return innerHandler(request as NextRequest);
      }
    }
  }
  throw gateErr;
}

// 30 requests per minute per IP - prevents a single caller from exhausting
// the workflow owner's execution quota. In-memory, per-pod; effective limit
// is LIMIT * num_replicas. Replace with Redis when replica count grows.
const CALL_RATE_LIMIT = 30;
const CALL_RATE_WINDOW_MS = 60_000;

function checkCallRateLimit(request: Request): NextResponse | null {
  const clientIp = getClientIp(request);
  const rateCheck = checkIpRateLimit(
    clientIp,
    CALL_RATE_LIMIT,
    CALL_RATE_WINDOW_MS
  );
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": String(rateCheck.retryAfter),
        },
      }
    );
  }
  return null;
}

async function handleWriteWorkflow(
  request: Request,
  workflow: CallRouteWorkflow
): Promise<NextResponse> {
  const writeBody = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const writeBodyError = validateBody(workflow, writeBody);
  if (writeBodyError) {
    return writeBodyError;
  }
  const { generateCalldataForWorkflow } = await import("@/lib/mcp/calldata");
  const result = generateCalldataForWorkflow(workflow.nodes, writeBody);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: 400, headers: corsHeaders }
    );
  }
  return NextResponse.json(
    {
      type: "calldata",
      to: result.to,
      data: result.data,
      value: result.value,
    },
    { headers: corsHeaders }
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const rateLimited = checkCallRateLimit(request);
    if (rateLimited) {
      return rateLimited;
    }

    const { slug } = await params;
    const orgSlug = new URL(request.url).searchParams.get("org") ?? undefined;

    const workflow = await lookupWorkflow(slug, orgSlug);
    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    if (workflow.workflowType === "write") {
      return handleWriteWorkflow(request, workflow);
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const bodyError = validateBody(workflow, body);
    if (bodyError) {
      return bodyError;
    }

    const price = Number(workflow.priceUsdcPerCall ?? "0");
    if (price <= 0) {
      return createAndStartExecution(workflow, body);
    }

    const creatorWalletAddress = await resolveCreatorWallet(
      workflow.organizationId
    );
    if (!creatorWalletAddress) {
      return NextResponse.json(
        { error: "Workflow creator has no payment wallet configured" },
        { status: 503, headers: corsHeaders }
      );
    }

    const paymentSig = request.headers.get("PAYMENT-SIGNATURE");
    const idempotent = await checkIdempotency(paymentSig);
    if (idempotent) {
      return idempotent;
    }

    const payerAddress = extractPayerAddress(paymentSig);
    const paymentConfig = buildPaymentConfig(workflow, creatorWalletAddress);

    // innerHandler closes over the already-parsed body so we never call
    // request.json() a second time (ReadableStream is single-consume).
    const innerHandler = async (_req: NextRequest): Promise<NextResponse> => {
      const response = await createAndStartExecution(workflow, body);

      // Record payment after execution is created so we have the executionId
      const result = (await response.clone().json()) as Record<string, unknown>;
      if (result.executionId) {
        await recordPayment({
          workflowId: workflow.id,
          paymentHash: paymentSig
            ? hashPaymentSignature(paymentSig)
            : (result.executionId as string),
          executionId: result.executionId as string,
          amountUsdc: workflow.priceUsdcPerCall ?? "0",
          payerAddress,
          creatorWalletAddress,
        });
      }

      return response;
    };

    const gatedHandler = withX402(innerHandler, paymentConfig, server);
    try {
      return (await gatedHandler(request as NextRequest)) as NextResponse;
    } catch (gateErr) {
      return handleTimeoutReconciliation(gateErr, request, innerHandler);
    }
  } catch (err) {
    logSystemError(
      ErrorCategory.WORKFLOW_ENGINE,
      "[x402/call] Unexpected error in call route",
      err,
      { endpoint: "/api/mcp/workflows/[slug]/call" }
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
