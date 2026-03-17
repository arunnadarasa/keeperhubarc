"use client";

import { Search, Workflow } from "lucide-react";
import Link from "next/link";
import { WorkflowTemplateGrid } from "@/components/hub/workflow-template-grid";
import { Button } from "@/components/ui/button";
import type { SavedWorkflow } from "@/lib/api-client";

type HubResultsProps = {
  communityWorkflows: SavedWorkflow[];
  searchResults: SavedWorkflow[] | null;
  isSearchActive: boolean;
  featuredIds?: Set<string>;
  onClearFilters?: () => void;
};

export function HubResults({
  communityWorkflows,
  searchResults,
  isSearchActive,
  featuredIds,
  onClearFilters,
}: HubResultsProps): React.ReactElement {
  const workflows = isSearchActive ? searchResults : communityWorkflows;

  if (!workflows || workflows.length === 0) {
    if (isSearchActive) {
      return (
        <section className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="mb-3 size-8 text-muted-foreground/40" />
          <p className="mb-3 text-muted-foreground text-sm">
            No templates match your filters.
          </p>
          {onClearFilters && (
            <Button
              className="h-8 text-xs"
              onClick={onClearFilters}
              variant="outline"
            >
              Clear filters
            </Button>
          )}
        </section>
      );
    }

    return (
      <section className="flex flex-col items-center justify-center py-16 text-center">
        <Workflow className="mb-3 size-8 text-muted-foreground/40" />
        <p className="mb-3 text-muted-foreground text-sm">
          No templates available yet.
        </p>
        <Button asChild className="h-8 text-xs" variant="outline">
          <Link href="/workflows/new">Create a workflow</Link>
        </Button>
      </section>
    );
  }

  return (
    <section>
      <WorkflowTemplateGrid featuredIds={featuredIds} workflows={workflows} />
    </section>
  );
}
