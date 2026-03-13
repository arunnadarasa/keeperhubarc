"use client";

import { Copy, Eye, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useState } from "react";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { refetchSidebar } from "@/keeperhub/lib/refetch-sidebar";
import { api, type SavedWorkflow } from "@/lib/api-client";
import { authClient, useSession } from "@/lib/auth-client";
import { WorkflowMiniMap } from "./workflow-mini-map";
import { WorkflowNodeIcons } from "./workflow-node-icons";

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
      {workflows.map((workflow) => {
        const isDuplicating = duplicatingIds.has(workflow.id);
        const isFeatured = featuredIds?.has(workflow.id) ?? false;

        return (
          <article
            className="group relative flex aspect-square flex-col overflow-hidden rounded-xl border border-border/20 bg-[var(--color-hub-card)] transition-all duration-200 hover:border-border/50 hover:shadow-[0_0_20px_rgba(9,253,103,0.03)] motion-reduce:transition-none"
            key={workflow.id}
          >
            {/* Subtle workflow preview */}
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-1/2 opacity-35">
              <WorkflowMiniMap
                edges={workflow.edges}
                height={120}
                nodes={workflow.nodes}
                width={200}
              />
            </div>

            {isFeatured && (
              <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-[var(--color-bg-accent)] px-2 py-0.5">
                <Star className="size-2.5 fill-[var(--color-text-accent)] text-[var(--color-text-accent)]" />
                <span className="font-medium text-[var(--color-text-accent)] text-[10px]">
                  Featured
                </span>
              </div>
            )}

            <div className="flex flex-1 flex-col justify-between p-4">
              <div className="flex flex-col gap-3">
                <WorkflowNodeIcons nodes={workflow.nodes} />

                <div>
                  <h3 className="line-clamp-2 font-semibold text-sm leading-snug">
                    {workflow.name}
                  </h3>
                  {workflow.description && (
                    <p className="mt-1.5 line-clamp-4 text-muted-foreground/80 text-xs leading-relaxed">
                      {workflow.description}
                    </p>
                  )}
                </div>
              </div>

              {workflow.publicTags && workflow.publicTags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-3">
                  {workflow.publicTags.slice(0, 3).map((tag) => (
                    <span
                      className="rounded-full bg-[var(--color-hub-icon-bg)] px-2 py-0.5 text-muted-foreground text-[10px]"
                      key={tag.slug}
                    >
                      {tag.name}
                    </span>
                  ))}
                  {workflow.publicTags.length > 3 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default rounded-full bg-[var(--color-hub-icon-bg)] px-1.5 py-0.5 text-muted-foreground text-[10px]">
                          +{workflow.publicTags.length - 3}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        className="flex flex-col gap-0.5"
                        side="bottom"
                      >
                        {workflow.publicTags.map((tag) => (
                          <span className="text-xs" key={tag.slug}>
                            {tag.name}
                          </span>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            {/* Hover overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-[var(--color-hub-card)] via-[var(--color-hub-card)]/80 via-30% to-transparent opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none">
              <div className="flex w-full gap-2 p-4 pt-8">
                <button
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-text-accent)] font-medium text-[#0a0f14] text-xs transition-colors hover:bg-[var(--color-text-accent)]/90 disabled:opacity-50"
                  disabled={isDuplicating}
                  onClick={(e) => handleDuplicate(e, workflow.id)}
                  type="button"
                >
                  <Copy className="size-3" />
                  {isDuplicating ? "Duplicating..." : "Use Template"}
                </button>
                <button
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-[var(--color-hub-icon-bg)] px-3 text-muted-foreground text-xs transition-colors hover:border-border hover:text-foreground"
                  onClick={(e) => handlePreview(e, workflow.id)}
                  type="button"
                >
                  <Eye className="size-3" />
                  Preview
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
