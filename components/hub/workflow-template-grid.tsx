"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, useCallback, useState } from "react";
import { toast } from "sonner";
import { api, type RatingResponse, type SavedWorkflow } from "@/lib/api-client";
import { authClient, useSession } from "@/lib/auth-client";
import { refetchSidebar } from "@/lib/refetch-sidebar";
import { WorkflowTemplateCard } from "./workflow-template-card";

type WorkflowTemplateGridProps = {
  workflows: SavedWorkflow[];
  featuredIds?: Set<string>;
};

type RatingOverride = {
  averageRating: number;
  ratingCount: number;
  userRating: number | null;
};

export function WorkflowTemplateGrid({
  workflows,
  featuredIds,
}: WorkflowTemplateGridProps): React.ReactElement | null {
  const router = useRouter();
  const { data: session } = useSession();
  const [duplicatingIds, setDuplicatingIds] = useState<Set<string>>(new Set());
  const [ratingOverrides, setRatingOverrides] = useState<
    Record<string, RatingOverride>
  >({});

  const handleDuplicate = async (
    e: MouseEvent,
    workflowId: string
  ): Promise<void> => {
    e.stopPropagation();

    if (duplicatingIds.has(workflowId)) {
      return;
    }

    setDuplicatingIds((prev) => new Set(prev).add(workflowId));

    try {
      if (!session?.user) {
        await authClient.signIn.anonymous();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const duplicated = await api.workflow.duplicate(workflowId);
      refetchSidebar();
      toast.success("Template duplicated");
      router.push(`/workflows/${duplicated.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to duplicate"
      );
    } finally {
      setDuplicatingIds((prev) => {
        const next = new Set(prev);
        next.delete(workflowId);
        return next;
      });
    }
  };

  const handlePreview = (e: MouseEvent, workflowId: string): void => {
    e.stopPropagation();
    router.push(`/workflows/${workflowId}`);
  };

  const applyRatingResponse = useCallback(
    (
      workflowId: string,
      result: RatingResponse,
      userRating: number | null
    ): void => {
      setRatingOverrides((prev) => ({
        ...prev,
        [workflowId]: {
          averageRating: result.averageRating,
          ratingCount: result.ratingCount,
          userRating,
        },
      }));
    },
    []
  );

  const handleRate = useCallback(
    async (workflowId: string, rating: number): Promise<void> => {
      if (!session?.user) {
        toast.error("Sign in to rate workflows");
        return;
      }

      try {
        const result = await api.workflow.rateWorkflow(workflowId, rating);
        applyRatingResponse(workflowId, result, rating);
        toast.success("Rating submitted");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rate workflow"
        );
      }
    },
    [session, applyRatingResponse]
  );

  const handleRemoveRating = useCallback(
    async (workflowId: string): Promise<void> => {
      try {
        const result = await api.workflow.removeRating(workflowId);
        applyRatingResponse(workflowId, result, null);
        toast.success("Rating removed");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to remove rating"
        );
      }
    },
    [applyRatingResponse]
  );

  if (workflows.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {workflows.map((workflow) => {
        const override = ratingOverrides[workflow.id];
        return (
          <WorkflowTemplateCard
            averageRating={
              override?.averageRating ?? workflow.averageRating ?? 0
            }
            canRate={workflow.canRate ?? false}
            isDuplicating={duplicatingIds.has(workflow.id)}
            isFeatured={featuredIds?.has(workflow.id) ?? false}
            key={workflow.id}
            onDuplicate={(e) => handleDuplicate(e, workflow.id)}
            onPreview={(e) => handlePreview(e, workflow.id)}
            onRate={(rating) => handleRate(workflow.id, rating)}
            onRemoveRating={() => handleRemoveRating(workflow.id)}
            ratingCount={override?.ratingCount ?? workflow.ratingCount ?? 0}
            userRating={
              override ? override.userRating : (workflow.userRating ?? null)
            }
            workflow={workflow}
          />
        );
      })}
    </div>
  );
}
