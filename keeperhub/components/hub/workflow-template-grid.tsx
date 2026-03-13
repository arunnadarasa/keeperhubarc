"use client";

import { useRouter } from "next/navigation";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";
import { refetchSidebar } from "@/keeperhub/lib/refetch-sidebar";
import { api, type SavedWorkflow } from "@/lib/api-client";
import { authClient, useSession } from "@/lib/auth-client";
import { WorkflowTemplateCard } from "./workflow-template-card";

type WorkflowTemplateGridProps = {
  workflows: SavedWorkflow[];
  featuredIds?: Set<string>;
};

export function WorkflowTemplateGrid({
  workflows,
  featuredIds,
}: WorkflowTemplateGridProps): React.ReactElement | null {
  const router = useRouter();
  const { data: session } = useSession();
  const [duplicatingIds, setDuplicatingIds] = useState<Set<string>>(new Set());

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

  if (workflows.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {workflows.map((workflow) => (
        <WorkflowTemplateCard
          isDuplicating={duplicatingIds.has(workflow.id)}
          isFeatured={featuredIds?.has(workflow.id) ?? false}
          key={workflow.id}
          onDuplicate={(e) => handleDuplicate(e, workflow.id)}
          onPreview={(e) => handlePreview(e, workflow.id)}
          workflow={workflow}
        />
      ))}
    </div>
  );
}
