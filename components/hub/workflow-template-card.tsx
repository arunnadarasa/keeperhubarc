"use client";

import { Copy, Eye, Star } from "lucide-react";
import type { MouseEvent } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SavedWorkflow } from "@/lib/api-client";
import { WorkflowMiniMap } from "./workflow-mini-map";

type WorkflowTemplateCardProps = {
  workflow: SavedWorkflow;
  isDuplicating: boolean;
  isFeatured?: boolean;
  className?: string;
  onDuplicate: (e: MouseEvent) => void;
  onPreview: (e: MouseEvent) => void;
};

export function WorkflowTemplateCard({
  workflow,
  isDuplicating,
  isFeatured = false,
  className,
  onDuplicate,
  onPreview,
}: WorkflowTemplateCardProps): React.ReactElement {
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border border-border/20 bg-[var(--color-hub-card)] transition-all duration-200 hover:border-border/50 hover:shadow-[0_0_20px_rgba(9,253,103,0.03)] motion-reduce:transition-none ${className ?? "aspect-square"}`}
    >
      <div className="relative flex flex-1 flex-col p-4">
        <div className="shrink-0">
          <div className="flex items-start gap-2">
            <h3 className="line-clamp-2 flex-1 font-semibold text-sm leading-snug">
              {workflow.name}
            </h3>
            {isFeatured && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-bg-accent)] px-2 py-0.5">
                <Star className="size-2.5 fill-[var(--color-text-accent)] text-[var(--color-text-accent)]" />
                <span className="font-medium text-[var(--color-text-accent)] text-[10px]">
                  Featured
                </span>
              </span>
            )}
          </div>
          {workflow.description && (
            <p className="mt-1.5 line-clamp-3 text-muted-foreground/80 text-xs leading-relaxed">
              {workflow.description}
            </p>
          )}
        </div>

        <div className="pointer-events-none my-auto shrink opacity-30 transition-opacity duration-200 group-hover:opacity-50">
          <WorkflowMiniMap
            edges={workflow.edges}
            height={160}
            nodes={workflow.nodes}
            width={280}
          />
        </div>

        {workflow.publicTags && workflow.publicTags.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1">
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
                <TooltipContent className="flex flex-col gap-0.5" side="bottom">
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

      <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-[var(--color-hub-card)] via-[var(--color-hub-card)]/80 via-30% to-transparent opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 motion-reduce:transition-none">
        <div className="flex w-full gap-2 p-4 pt-12">
          <button
            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-text-accent)] font-medium text-[#0a0f14] text-xs transition-colors hover:bg-[var(--color-text-accent)]/90 disabled:opacity-50"
            disabled={isDuplicating}
            onClick={onDuplicate}
            type="button"
          >
            <Copy className="size-3" />
            {isDuplicating ? "Duplicating..." : "Use Template"}
          </button>
          <button
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border/50 bg-[var(--color-hub-icon-bg)] px-3 text-muted-foreground text-xs transition-colors hover:border-border hover:text-foreground"
            onClick={onPreview}
            type="button"
          >
            <Eye className="size-3" />
            Preview
          </button>
        </div>
      </div>
    </article>
  );
}
