import "server-only";

import { and, count, desc, eq, inArray, isNotNull, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { workflowPayments } from "@/lib/db/schema-payments";
import type {
  EarningsSummary,
  SettlementStatus,
  WorkflowEarningsRow,
} from "./types";

export function parsePlatformFeePercent(envValue: string | undefined): number {
  const parsed = Number.parseInt(envValue ?? "30", 10);
  return parsed || 30;
}

export function computeRevenueSplit(
  gross: number,
  platformFeePercent: number
): { creatorShare: number; platformFee: number } {
  const creatorShare = gross * ((100 - platformFeePercent) / 100);
  const platformFee = gross - creatorShare;
  return { creatorShare, platformFee };
}

export function formatUsdc(amount: number): string {
  return `$${amount.toFixed(2)} USDC`;
}

export function deriveSettlementStatus(
  invocationCount: number
): SettlementStatus {
  return invocationCount > 0 ? "settled" : "no_payments";
}

type CallerRow = {
  workflowId: string;
  payerAddress: string;
  callCount: number;
};

export function groupTopCallers(rows: CallerRow[]): Map<string, string[]> {
  const grouped = new Map<string, CallerRow[]>();

  for (const row of rows) {
    const existing = grouped.get(row.workflowId);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.workflowId, [row]);
    }
  }

  const result = new Map<string, string[]>();
  for (const [workflowId, callerRows] of grouped) {
    const sorted = [...callerRows].sort((a, b) => b.callCount - a.callCount);
    result.set(
      workflowId,
      sorted.slice(0, 3).map((r) => r.payerAddress)
    );
  }

  return result;
}

export async function getEarningsSummary(
  organizationId: string,
  page: number,
  pageSize: number
): Promise<EarningsSummary> {
  const platformFeePercent = parsePlatformFeePercent(
    process.env.PLATFORM_FEE_PERCENT
  );
  const creatorSharePercent = 100 - platformFeePercent;

  const listedWorkflows = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      listedSlug: workflows.listedSlug,
    })
    .from(workflows)
    .where(
      and(
        eq(workflows.organizationId, organizationId),
        eq(workflows.isListed, true)
      )
    );

  if (listedWorkflows.length === 0) {
    return {
      totalGrossRevenue: formatUsdc(0),
      totalCreatorEarnings: formatUsdc(0),
      totalPlatformFees: formatUsdc(0),
      totalInvocations: 0,
      platformFeePercent,
      creatorSharePercent,
      workflows: [],
      total: 0,
      page,
      pageSize,
      hasListedWorkflows: false,
    };
  }

  const orgWorkflowIds = listedWorkflows.map((w) => w.id);

  const revenueRows = await db
    .select({
      workflowId: workflowPayments.workflowId,
      grossRevenue: sum(workflowPayments.amountUsdc),
      invocationCount: count(workflowPayments.id),
    })
    .from(workflowPayments)
    .where(inArray(workflowPayments.workflowId, orgWorkflowIds))
    .groupBy(workflowPayments.workflowId)
    .orderBy(desc(sum(workflowPayments.amountUsdc)));

  const callerRows = await db
    .select({
      workflowId: workflowPayments.workflowId,
      payerAddress: workflowPayments.payerAddress,
      callCount: count(workflowPayments.id),
    })
    .from(workflowPayments)
    .where(
      and(
        inArray(workflowPayments.workflowId, orgWorkflowIds),
        isNotNull(workflowPayments.payerAddress)
      )
    )
    .groupBy(workflowPayments.workflowId, workflowPayments.payerAddress)
    .orderBy(desc(count(workflowPayments.id)));

  const topCallersMap = groupTopCallers(
    callerRows
      .filter(
        (r): r is typeof r & { payerAddress: string } => r.payerAddress !== null
      )
      .map((r) => ({
        workflowId: r.workflowId,
        payerAddress: r.payerAddress,
        callCount: r.callCount,
      }))
  );

  const revenueByWorkflowId = new Map(
    revenueRows.map((r) => [r.workflowId, r])
  );

  let totalGross = 0;
  let totalInvocations = 0;

  const allRows: WorkflowEarningsRow[] = listedWorkflows.map((workflow) => {
    const revenue = revenueByWorkflowId.get(workflow.id);
    const gross = Number(revenue?.grossRevenue ?? "0");
    const invocationCount = revenue?.invocationCount ?? 0;
    const { creatorShare, platformFee } = computeRevenueSplit(
      gross,
      platformFeePercent
    );

    totalGross += gross;
    totalInvocations += invocationCount;

    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      listedSlug: workflow.listedSlug,
      grossRevenue: formatUsdc(gross),
      creatorShare: formatUsdc(creatorShare),
      platformFee: formatUsdc(platformFee),
      invocationCount,
      topCallers: topCallersMap.get(workflow.id) ?? [],
      settlementStatus: deriveSettlementStatus(invocationCount),
    };
  });

  const total = allRows.length;
  const offset = (page - 1) * pageSize;
  const paginatedRows = allRows.slice(offset, offset + pageSize);

  const { creatorShare: totalCreatorEarnings, platformFee: totalPlatformFees } =
    computeRevenueSplit(totalGross, platformFeePercent);

  return {
    totalGrossRevenue: formatUsdc(totalGross),
    totalCreatorEarnings: formatUsdc(totalCreatorEarnings),
    totalPlatformFees: formatUsdc(totalPlatformFees),
    totalInvocations,
    platformFeePercent,
    creatorSharePercent,
    workflows: paginatedRows,
    total,
    page,
    pageSize,
    hasListedWorkflows: true,
  };
}
