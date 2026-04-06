"use client";

import { Copy, Eye, Star, X } from "lucide-react";
import { type MouseEvent, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  averageRating?: number;
  ratingCount?: number;
  userRating?: number | null;
  canRate?: boolean;
  className?: string;
  onDuplicate: (e: MouseEvent) => void;
  onPreview: (e: MouseEvent) => void;
  onRate?: (rating: number) => void;
  onRemoveRating?: () => void;
};

function RatePopoverButton({
  userRating,
  onRate,
  onRemove,
  onOpenChange,
}: {
  userRating: number | null;
  onRate: (rating: number) => void;
  onRemove?: () => void;
  onOpenChange?: (open: boolean) => void;
}): React.ReactElement {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const displayValue = hoverValue ?? userRating ?? 0;

  const handleRate = (rating: number): void => {
    onRate(rating);
    handleOpenChange(false);
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-amber-400 text-xs transition-colors hover:border-amber-500/50 hover:bg-amber-500/20"
          onClick={(e) => e.stopPropagation()}
          type="button"
        >
          <Star className={`size-3.5 ${userRating ? "fill-amber-400" : ""}`} />
          {userRating ? `${String(userRating)}/5` : "Rate"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-50 w-auto border-border/50 bg-[var(--color-hub-card)] p-3"
        side="top"
        sideOffset={4}
      >
        <div className="flex flex-col items-center gap-2">
          <div
            aria-label="Rate this workflow"
            className="flex gap-0.5"
            onMouseLeave={() => setHoverValue(null)}
            role="radiogroup"
          >
            {Array.from({ length: 5 }, (_, i) => {
              const starValue = i + 1;
              return (
                <button
                  aria-label={`${String(starValue)} star${starValue > 1 ? "s" : ""}`}
                  className="rounded p-0.5 transition-transform hover:scale-110"
                  key={`r-${String(starValue)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRate(starValue);
                  }}
                  onMouseEnter={() => setHoverValue(starValue)}
                  type="button"
                >
                  <Star
                    className={`size-6 ${
                      displayValue >= starValue
                        ? "fill-amber-400 text-amber-400"
                        : "text-muted-foreground/20"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <div className="h-4 text-center">
            {hoverValue && (
              <span className="text-muted-foreground text-[11px]">
                {hoverValue} {hoverValue === 1 ? "star" : "stars"}
              </span>
            )}
            {!hoverValue && userRating && onRemove && (
              <button
                className="flex items-center gap-0.5 text-muted-foreground/50 text-[11px] transition-colors hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                  handleOpenChange(false);
                }}
                type="button"
              >
                <X className="size-3" />
                Remove
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function WorkflowTemplateCard({
  workflow,
  isDuplicating,
  isFeatured = false,
  averageRating = 0,
  ratingCount = 0,
  userRating = null,
  canRate = false,
  className,
  onDuplicate,
  onPreview,
  onRate,
  onRemoveRating,
}: WorkflowTemplateCardProps): React.ReactElement {
  const [ratePopoverOpen, setRatePopoverOpen] = useState(false);

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
          {ratingCount > 0 && (
            <div className="mt-2 flex items-center gap-0.5">
              {Array.from({ length: 5 }, (_, i) => {
                const starValue = i + 1;
                const filled = averageRating >= starValue;
                const half = !filled && averageRating >= starValue - 0.5;
                let starClass = "text-muted-foreground/20";
                if (filled) {
                  starClass = "fill-amber-400 text-amber-400";
                } else if (half) {
                  starClass = "fill-amber-400/50 text-amber-400";
                }
                return (
                  <Star
                    className={`size-3 ${starClass}`}
                    key={`d-${String(starValue)}`}
                  />
                );
              })}
              <span className="ml-0.5 font-medium text-muted-foreground text-xs">
                {averageRating.toFixed(1)}
              </span>
              <span className="text-muted-foreground/50 text-[10px]">
                ({ratingCount})
              </span>
            </div>
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

      <div
        className={`pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-[var(--color-hub-card)] via-[var(--color-hub-card)] via-60% to-transparent transition-opacity duration-200 motion-reduce:transition-none ${ratePopoverOpen ? "pointer-events-auto opacity-100" : "opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"}`}
      >
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
          {canRate && onRate && (
            <RatePopoverButton
              onOpenChange={setRatePopoverOpen}
              onRate={onRate}
              onRemove={onRemoveRating}
              userRating={userRating}
            />
          )}
        </div>
      </div>
    </article>
  );
}
