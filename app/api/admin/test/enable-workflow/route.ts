import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { workflows } from "@/lib/db/schema";
import { syncWorkflowSchedule } from "@/lib/schedule-service";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = authenticateAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { workflowId?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { workflowId } = body;
  if (!workflowId) {
    return NextResponse.json(
      { error: "workflowId is required" },
      { status: 400 }
    );
  }

  try {
    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // Enable the workflow
    await db
      .update(workflows)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(workflows.id, workflowId));

    // Sync schedule (creates workflow_schedules record for Schedule triggers)
    const syncResult = await syncWorkflowSchedule(
      workflowId,
      workflow.nodes as Parameters<typeof syncWorkflowSchedule>[1]
    );

    return NextResponse.json({
      workflowId,
      enabled: true,
      scheduleSync: syncResult,
    });
  } catch (error) {
    console.error("Admin enable-workflow failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
