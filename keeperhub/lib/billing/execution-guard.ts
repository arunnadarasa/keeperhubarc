import "server-only";

import { NextResponse } from "next/server";
import { isBillingEnabled } from "./feature-flag";
import { checkExecutionLimit, type ExecutionLimitResult } from "./plans-server";

type GuardAllowed = {
  blocked: false;
  limitResult: ExecutionLimitResult | null;
};

type GuardBlocked = {
  blocked: true;
  response: NextResponse;
};

export type ExecutionGuardResult = GuardAllowed | GuardBlocked;

/**
 * Enforce execution limits for a given organization.
 *
 * - Returns `{ blocked: false }` if billing is disabled or org is null.
 * - Returns `{ blocked: false }` if within limits or overage is enabled (billed later).
 * - Returns `{ blocked: true, response }` with 429 if free plan limit exceeded.
 */
export async function enforceExecutionLimit(
  organizationId: string | null | undefined
): Promise<ExecutionGuardResult> {
  if (!isBillingEnabled()) {
    return { blocked: false, limitResult: null };
  }

  if (organizationId === null || organizationId === undefined) {
    return { blocked: false, limitResult: null };
  }

  const result = await checkExecutionLimit(organizationId);

  if (result.allowed) {
    return { blocked: false, limitResult: result };
  }

  return {
    blocked: true,
    response: NextResponse.json(
      {
        error: "Monthly execution limit exceeded",
        limit: result.limit,
        used: result.used,
        plan: result.plan,
      },
      { status: 429 }
    ),
  };
}
