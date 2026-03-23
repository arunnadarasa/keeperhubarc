import { and, avg, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowRatings, workflows } from "@/lib/db/schema";

type RouteParams = { params: Promise<{ workflowId: string }> };

const MIN_RATING = 1;
const MAX_RATING = 5;
const RATING_STEP = 0.5;

function isValidRating(value: number): boolean {
  return (
    value >= MIN_RATING &&
    value <= MAX_RATING &&
    value % RATING_STEP === 0
  );
}

function toStoredRating(value: number): number {
  return Math.round(value * 2);
}

function fromStoredRating(stored: number): number {
  return stored / 2;
}

async function getAggregates(
  workflowId: string
): Promise<{ averageRating: number; ratingCount: number }> {
  const [result] = await db
    .select({
      avg: avg(workflowRatings.rating),
      count: count(),
    })
    .from(workflowRatings)
    .where(eq(workflowRatings.workflowId, workflowId));

  const rawAvg = result.avg ? Number.parseFloat(result.avg) : 0;
  return {
    averageRating: rawAvg > 0 ? fromStoredRating(rawAvg) : 0,
    ratingCount: result.count,
  };
}

async function userHasDuplicated(
  userId: string,
  workflowId: string
): Promise<boolean> {
  const duplicated = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.userId, userId),
        eq(workflows.sourceWorkflowId, workflowId)
      )
    )
    .limit(1);

  return duplicated.length > 0;
}

export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: userId, email } = session.user;

    // Reject anonymous users
    if (
      email?.includes("@http://") ||
      email?.includes("@https://") ||
      email?.startsWith("temp-")
    ) {
      return NextResponse.json(
        { error: "Sign in with a real account to rate workflows" },
        { status: 403 }
      );
    }

    const { workflowId } = await params;

    const body: { rating?: number } = await request.json();
    const { rating } = body;

    if (rating === undefined || rating === null || !isValidRating(rating)) {
      return NextResponse.json(
        { error: `Rating must be ${MIN_RATING}-${MAX_RATING} in ${RATING_STEP} increments` },
        { status: 400 }
      );
    }

    // Verify user has duplicated this workflow
    const hasDuplicated = await userHasDuplicated(userId, workflowId);
    if (!hasDuplicated) {
      return NextResponse.json(
        { error: "You must use this template before rating it" },
        { status: 403 }
      );
    }

    const storedRating = toStoredRating(rating);

    // Upsert: insert or update existing rating
    const existing = await db
      .select({ id: workflowRatings.id })
      .from(workflowRatings)
      .where(
        and(
          eq(workflowRatings.workflowId, workflowId),
          eq(workflowRatings.userId, userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(workflowRatings)
        .set({ rating: storedRating, updatedAt: new Date() })
        .where(eq(workflowRatings.id, existing[0].id));
    } else {
      await db.insert(workflowRatings).values({
        workflowId,
        userId,
        rating: storedRating,
      });
    }

    const aggregates = await getAggregates(workflowId);

    return NextResponse.json({
      rating,
      ...aggregates,
    });
  } catch (error) {
    return apiError(error, "Failed to rate workflow");
  }
}

export async function DELETE(
  request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workflowId } = await params;

    await db
      .delete(workflowRatings)
      .where(
        and(
          eq(workflowRatings.workflowId, workflowId),
          eq(workflowRatings.userId, session.user.id)
        )
      );

    const aggregates = await getAggregates(workflowId);

    return NextResponse.json(aggregates);
  } catch (error) {
    return apiError(error, "Failed to remove rating");
  }
}
