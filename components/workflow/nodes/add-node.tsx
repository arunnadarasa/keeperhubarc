"use client";

import type { NodeProps } from "@xyflow/react";
// start custom keeperhub code //
import { Globe, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { GettingStartedChecklist } from "@/keeperhub/components/onboarding/getting-started-checklist";
// end keeperhub code //
import { getAppName, getCustomLogo } from "@/lib/extension-registry";

type AddNodeData = {
  onClick?: () => void;
};

export function AddNode({ data }: NodeProps & { data?: AddNodeData }) {
  const CustomLogo = getCustomLogo();
  const appName = getAppName();
  // start custom keeperhub code //
  const router = useRouter();
  // end keeperhub code //

  return (
    <div className="flex flex-col items-center justify-center gap-8 rounded-lg border border-border border-dashed bg-background/50 p-8 backdrop-blur-sm">
      <div className="flex flex-col items-center text-center">
        {CustomLogo && <CustomLogo className="mb-2 size-10" />}
        <h1 className="mb-1 font-bold text-3xl">{appName}</h1>
        <p className="text-muted-foreground">Automate anything onchain</p>
      </div>
      {/* start custom keeperhub code */}
      <GettingStartedChecklist onCreateWorkflow={data.onClick} />
      <div className="flex gap-3">
        <Button
          className="gap-2 shadow-lg"
          onClick={data.onClick}
          size="default"
        >
          <Plus className="size-4" />
          Start building
        </Button>
        <Button
          className="gap-2 shadow-lg"
          onClick={() => router.push("/hub")}
          size="default"
          variant="outline"
        >
          <Globe className="size-4" />
          Browse Templates
        </Button>
      </div>
      {/* end keeperhub code */}
    </div>
  );
}
