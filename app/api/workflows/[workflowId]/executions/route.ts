import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
// start custom keeperhub code //
import { authenticateApiKey } from "@/keeperhub/lib/api-key-auth";
import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";
import { getOrgContext } from "@/keeperhub/lib/middleware/org-context";
// end keeperhub code //
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowExecutions, workflows } from "@/lib/db/schema";

export async function GET(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;

    // start custom keeperhub code //
    // Try API key authentication first, then fall back to session
    let userId: string | null = null;
    let organizationId: string | null = null;

    const apiKeyAuth = await authenticateApiKey(request);
    if (apiKeyAuth.authenticated) {
      organizationId = apiKeyAuth.organizationId || null;
    } else {
      const session = await auth.api.getSession({
        headers: request.headers,
      });

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      userId = session.user.id;
      const orgContext = await getOrgContext();
      organizationId = orgContext.organization?.id || null;
    }

    // Verify workflow access (owner or org member)
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const isOwner = userId !== null && userId === workflow.userId;
    const isSameOrg =
      !workflow.isAnonymous &&
      workflow.organizationId &&
      organizationId === workflow.organizationId;

    if (!(isOwner || isSameOrg)) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }
    // end keeperhub code //

    // Fetch executions
    const executions = await db.query.workflowExecutions.findMany({
      where: eq(workflowExecutions.workflowId, workflowId),
      orderBy: [desc(workflowExecutions.startedAt)],
      limit: 50,
    });

    return NextResponse.json(executions);
  } catch (error) {
    logSystemError(ErrorCategory.DATABASE, "Failed to get executions", error, {
      endpoint: "/api/workflows/[workflowId]/executions",
      operation: "get",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get executions",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await context.params;

    // start custom keeperhub code //
    // Try API key authentication first, then fall back to session
    let userId: string | null = null;
    let organizationId: string | null = null;

    const apiKeyAuth = await authenticateApiKey(request);
    if (apiKeyAuth.authenticated) {
      organizationId = apiKeyAuth.organizationId || null;
    } else {
      const session = await auth.api.getSession({
        headers: request.headers,
      });

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      userId = session.user.id;
      const orgContext = await getOrgContext();
      organizationId = orgContext.organization?.id || null;
    }

    // Verify workflow access (owner or org member)
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    const isOwner = userId !== null && userId === workflow.userId;
    const isSameOrg =
      !workflow.isAnonymous &&
      workflow.organizationId &&
      organizationId === workflow.organizationId;

    if (!(isOwner || isSameOrg)) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }
    // end keeperhub code //

    // Get all execution IDs for this workflow
    const executions = await db.query.workflowExecutions.findMany({
      where: eq(workflowExecutions.workflowId, workflowId),
      columns: { id: true },
    });

    const executionIds = executions.map((e) => e.id);

    // Delete logs first (if there are any executions)
    if (executionIds.length > 0) {
      const { workflowExecutionLogs } = await import("@/lib/db/schema");
      const { inArray } = await import("drizzle-orm");

      await db
        .delete(workflowExecutionLogs)
        .where(inArray(workflowExecutionLogs.executionId, executionIds));

      // Then delete the executions
      await db
        .delete(workflowExecutions)
        .where(eq(workflowExecutions.workflowId, workflowId));
    }

    return NextResponse.json({
      success: true,
      deletedCount: executionIds.length,
    });
  } catch (error) {
    logSystemError(
      ErrorCategory.DATABASE,
      "Failed to delete executions",
      error,
      {
        endpoint: "/api/workflows/[workflowId]/executions",
        operation: "delete",
      }
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete executions",
      },
      { status: 500 }
    );
  }
}
