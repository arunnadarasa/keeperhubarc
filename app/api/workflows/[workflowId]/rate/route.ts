import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workflowRatings, workflows } from "@/lib/db/schema";

type RouteParams = { params: Promise<{ workflowId: string }> };

export const VOTE_DIRECTIONS = { upvote: 1, downvote: -1 } as const;
export type VoteDirection = keyof typeof VOTE_DIRECTIONS;

const VALID_DIRECTIONS = new Set<string>(Object.keys(VOTE_DIRECTIONS));

function isValidDirection(value: unknown): value is VoteDirection {
  return typeof value === "string" && VALID_DIRECTIONS.has(value);
}

function storedToDirection(stored: number): VoteDirection {
  return stored === 1 ? "upvote" : "downvote";
}

async function getScore(workflowId: string): Promise<number> {
  const [result] = await db
    .select({
      score: sql<string>`COALESCE(SUM(${workflowRatings.rating}), 0)`,
    })
    .from(workflowRatings)
    .where(eq(workflowRatings.workflowId, workflowId));

  return Number(result.score);
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

    if (
      email?.includes("@http://") ||
      email?.includes("@https://") ||
      email?.startsWith("temp-")
    ) {
      return NextResponse.json(
        { error: "Sign in with a real account to vote on workflows" },
        { status: 403 }
      );
    }

    const { workflowId } = await params;

    const body: { vote?: unknown } = await request.json();
    const { vote } = body;

    if (!isValidDirection(vote)) {
      return NextResponse.json(
        { error: "Vote must be \"upvote\" or \"downvote\"" },
        { status: 400 }
      );
    }

    const hasDuplicated = await userHasDuplicated(userId, workflowId);
    if (!hasDuplicated) {
      return NextResponse.json(
        { error: "You must use this template before voting" },
        { status: 403 }
      );
    }

    const storedValue = VOTE_DIRECTIONS[vote];

    const existing = await db
      .select({ id: workflowRatings.id, rating: workflowRatings.rating })
      .from(workflowRatings)
      .where(
        and(
          eq(workflowRatings.workflowId, workflowId),
          eq(workflowRatings.userId, userId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const current = existing[0];
      if (current.rating === storedValue) {
        // Same direction: toggle off (remove vote)
        await db
          .delete(workflowRatings)
          .where(eq(workflowRatings.id, current.id));

        const score = await getScore(workflowId);
        return NextResponse.json({ userVote: null, score });
      }

      // Opposite direction: switch vote
      await db
        .update(workflowRatings)
        .set({ rating: storedValue, updatedAt: new Date() })
        .where(eq(workflowRatings.id, current.id));
    } else {
      // No existing vote: insert
      await db.insert(workflowRatings).values({
        workflowId,
        userId,
        rating: storedValue,
      });
    }

    const score = await getScore(workflowId);
    return NextResponse.json({ userVote: vote, score });
  } catch (error) {
    return apiError(error, "Failed to vote on workflow");
  }
}
