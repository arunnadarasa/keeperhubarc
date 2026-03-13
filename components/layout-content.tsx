"use client";

import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import { PersistentCanvas } from "@/components/workflow/persistent-canvas";
import { WorkflowToolbar } from "@/components/workflow/workflow-toolbar";
import { NavigationSidebar } from "@/keeperhub/components/navigation-sidebar";

export function LayoutContent({ children }: { children: ReactNode }) {
  return (
    <ReactFlowProvider>
      <WorkflowToolbar persistent />
      <PersistentCanvas />
      <div className="pointer-events-none relative z-10">{children}</div>
      <NavigationSidebar />
    </ReactFlowProvider>
  );
}
