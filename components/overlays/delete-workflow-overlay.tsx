"use client";

import { AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Overlay } from "./overlay";
import { useOverlay } from "./overlay-provider";
import type { OverlayAction } from "./types";

type DeleteWorkflowWithRunsOverlayProps = {
  overlayId: string;
  workflowName: string;
  onViewRuns: () => void;
  onForceDelete: () => void | Promise<void>;
};

export function DeleteWorkflowWithRunsOverlay({
  overlayId,
  workflowName,
  onViewRuns,
  onForceDelete,
}: DeleteWorkflowWithRunsOverlayProps) {
  const { pop } = useOverlay();

  const actions: OverlayAction[] = [
    {
      label: "Cancel",
      variant: "outline",
      onClick: () => pop(),
    },
    {
      label: "Delete Everything",
      variant: "destructive",
      onClick: async () => {
        await onForceDelete();
        pop();
      },
    },
  ];

  return (
    <Overlay
      actions={actions}
      overlayId={overlayId}
      title="Workflow has run history"
    >
      <div className="-mb-2 flex gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangleIcon className="size-5 text-destructive" />
        </div>
        <div className="space-y-4 pt-2">
          <p className="text-muted-foreground text-sm">
            &quot;{workflowName}&quot; has execution history. Run history may
            contain sensitive data you want to save before deleting.
          </p>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="!bg-white !text-black hover:!bg-white/90"
              onClick={() => {
                onViewRuns();
                pop();
              }}
            >
              View runs
            </Button>
            <p className="text-muted-foreground text-xs">
              or delete everything below
            </p>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
