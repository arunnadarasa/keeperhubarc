import { and, asc, avg, count, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  publicTags,
  workflowPublicTags,
  workflowRatings,
  workflows,
} from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";
type TagInfo = { id: string; name: string; slug: string };

async function resolveTagFilter(tagSlug: string): Promise<string[] | "empty"> {
  const tag = await db.query.publicTags.findFirst({
    where: eq(publicTags.slug, tagSlug),
  });

  if (!tag) {
    return "empty";
  }

  const taggedRows = await db
    .select({ workflowId: workflowPublicTags.workflowId })
    .from(workflowPublicTags)
    .where(eq(workflowPublicTags.publicTagId, tag.id));

  const ids = taggedRows.map((r) => r.workflowId);
  return ids.length === 0 ? "empty" : ids;
}

async function fetchTagsByWorkflow(
  workflowIds: string[]
): Promise<Record<string, TagInfo[]>> {
  if (workflowIds.length === 0) {
    return {};
  }

  const tagJoins = await db
    .select({
      workflowId: workflowPublicTags.workflowId,
      tagId: publicTags.id,
      tagName: publicTags.name,
      tagSlug: publicTags.slug,
    })
    .from(workflowPublicTags)
    .innerJoin(publicTags, eq(publicTags.id, workflowPublicTags.publicTagId))
    .where(inArray(workflowPublicTags.workflowId, workflowIds));

  const result: Record<string, TagInfo[]> = {};
  for (const row of tagJoins) {
    if (!result[row.workflowId]) {
      result[row.workflowId] = [];
    }
    result[row.workflowId].push({
      id: row.tagId,
      name: row.tagName,
      slug: row.tagSlug,
    });
  }
  return result;
}

async function fetchRatingAggregates(
  workflowIds: string[]
): Promise<Record<string, { averageRating: number; ratingCount: number }>> {
  if (workflowIds.length === 0) return {};

  const rows = await db
    .select({
      workflowId: workflowRatings.workflowId,
      avg: avg(workflowRatings.rating),
      count: count(),
    })
    .from(workflowRatings)
    .where(inArray(workflowRatings.workflowId, workflowIds))
    .groupBy(workflowRatings.workflowId);

  const result: Record<string, { averageRating: number; ratingCount: number }> =
    {};
  for (const row of rows) {
    const rawAvg = row.avg ? Number.parseFloat(row.avg) : 0;
    result[row.workflowId] = {
      averageRating: rawAvg > 0 ? rawAvg / 2 : 0, // stored as 2x, convert back
      ratingCount: row.count,
    };
  }
  return result;
}

async function fetchUserRatings(
  userId: string,
  workflowIds: string[]
): Promise<Record<string, number>> {
  if (workflowIds.length === 0) return {};

  const rows = await db
    .select({
      workflowId: workflowRatings.workflowId,
      rating: workflowRatings.rating,
    })
    .from(workflowRatings)
    .where(
      and(
        eq(workflowRatings.userId, userId),
        inArray(workflowRatings.workflowId, workflowIds)
      )
    );

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.workflowId] = row.rating / 2; // stored as 2x, convert back
  }
  return result;
}

async function fetchUserDuplications(
  userId: string,
  workflowIds: string[]
): Promise<Set<string>> {
  if (workflowIds.length === 0) return new Set();

  const rows = await db
    .select({ sourceWorkflowId: workflows.sourceWorkflowId })
    .from(workflows)
    .where(
      and(
        eq(workflows.userId, userId),
        inArray(workflows.sourceWorkflowId, workflowIds)
      )
    );

  const result = new Set<string>();
  for (const row of rows) {
    if (row.sourceWorkflowId) {
      result.add(row.sourceWorkflowId);
    }
  }
  return result;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const isFeaturedRequest = searchParams.get("featured") === "true";
    const featuredProtocol = searchParams.get("featuredProtocol");
    const tagSlug = searchParams.get("tag");
    const sortByRating = searchParams.get("sort") === "stars";

    let workflowIdFilter: string[] | null = null;

    if (tagSlug) {
      const result = await resolveTagFilter(tagSlug);
      if (result === "empty") {
        return NextResponse.json([]);
      }
      workflowIdFilter = result;
    }

    const isProtocolFeaturedRequest = Boolean(featuredProtocol);

    const conditions = [eq(workflows.visibility, "public")];

    if (isProtocolFeaturedRequest) {
      conditions.push(
        eq(workflows.featuredProtocol, featuredProtocol as string)
      );
    } else {
      conditions.push(eq(workflows.featured, isFeaturedRequest));
    }

    if (workflowIdFilter) {
      conditions.push(inArray(workflows.id, workflowIdFilter));
    }

    const publicWorkflows = await db
      .select({
        id: workflows.id,
        name: workflows.name,
        description: workflows.description,
        userId: workflows.userId,
        organizationId: workflows.organizationId,
        isAnonymous: workflows.isAnonymous,
        featured: workflows.featured,
        featuredOrder: workflows.featuredOrder,
        featuredProtocol: workflows.featuredProtocol,
        featuredProtocolOrder: workflows.featuredProtocolOrder,
        projectId: workflows.projectId,
        tagId: workflows.tagId,
        nodes: workflows.nodes,
        edges: workflows.edges,
        visibility: workflows.visibility,
        enabled: workflows.enabled,
        createdAt: workflows.createdAt,
        updatedAt: workflows.updatedAt,
      })
      .from(workflows)
      .where(and(...conditions))
      .orderBy(
        ...(isProtocolFeaturedRequest
          ? [asc(workflows.featuredProtocolOrder), desc(workflows.updatedAt)]
          : isFeaturedRequest
            ? [desc(workflows.featuredOrder), desc(workflows.updatedAt)]
            : [desc(workflows.updatedAt)])
      );

    const workflowIds = publicWorkflows.map((w) => w.id);

    // Fetch tags, ratings, and user's own ratings in parallel
    const session = await auth.api
      .getSession({ headers: request.headers })
      .catch(() => null);
    const userId = session?.user?.id;

    const emptyRecord = {} as Record<string, number>;
    const emptySet = new Set<string>();

    const [tagsByWorkflow, ratingAggregates, userRatings, userDuplications] =
      await Promise.all([
        fetchTagsByWorkflow(workflowIds),
        fetchRatingAggregates(workflowIds),
        userId
          ? fetchUserRatings(userId, workflowIds)
          : Promise.resolve(emptyRecord),
        userId
          ? fetchUserDuplications(userId, workflowIds)
          : Promise.resolve(emptySet),
      ]);

    const mappedWorkflows = publicWorkflows.map((workflow) => {
      const agg = ratingAggregates[workflow.id];
      return {
        ...workflow,
        publicTags: tagsByWorkflow[workflow.id] ?? [],
        averageRating: agg?.averageRating ?? 0,
        ratingCount: agg?.ratingCount ?? 0,
        userRating: userRatings[workflow.id] ?? null,
        canRate: userDuplications.has(workflow.id),
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
      };
    });

    if (sortByRating) {
      mappedWorkflows.sort((a, b) => b.averageRating - a.averageRating);
    }

    return NextResponse.json(mappedWorkflows);
  } catch (error) {
    logSystemError(
      ErrorCategory.DATABASE,
      "Failed to get public workflows",
      error,
      {
        endpoint: "/api/workflows/public",
        operation: "get",
      }
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to get public workflows",
      },
      { status: 500 }
    );
  }
}
