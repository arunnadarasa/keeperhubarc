"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
// start custom keeperhub code //
import { refetchSidebar } from "@/keeperhub/lib/refetch-sidebar";
import { api } from "@/lib/api-client";
import { authClient, useSession } from "@/lib/auth-client";
// end keeperhub code //
import {
  currentWorkflowIdAtom,
  currentWorkflowNameAtom,
  edgesAtom,
  hasSidebarBeenShownAtom,
  isTransitioningFromHomepageAtom,
  nodesAtom,
  type WorkflowNode,
} from "@/lib/workflow-store";

// start custom keeperhub code //
function createDefaultNodes() {
  const triggerId = nanoid();
  const actionId = nanoid();
  const edgeId = nanoid();

  const triggerNode: WorkflowNode = {
    id: triggerId,
    type: "trigger" as const,
    position: { x: 0, y: 0 },
    data: {
      label: "",
      description: "",
      type: "trigger" as const,
      config: { triggerType: "Manual" },
      status: "idle" as const,
    },
  };

  const actionNode: WorkflowNode = {
    id: actionId,
    type: "action" as const,
    position: { x: 272, y: 0 },
    selected: true,
    data: {
      label: "",
      description: "",
      type: "action" as const,
      config: {},
      status: "idle" as const,
    },
  };

  const edge = {
    id: edgeId,
    source: triggerId,
    target: actionId,
    type: "animated",
  };

  return { nodes: [triggerNode, actionNode], edges: [edge] };
}
// end keeperhub code //

const Home = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const setNodes = useSetAtom(nodesAtom);
  const setEdges = useSetAtom(edgesAtom);
  const setCurrentWorkflowId = useSetAtom(currentWorkflowIdAtom);
  const setCurrentWorkflowName = useSetAtom(currentWorkflowNameAtom);
  const setHasSidebarBeenShown = useSetAtom(hasSidebarBeenShownAtom);
  const setIsTransitioningFromHomepage = useSetAtom(
    isTransitioningFromHomepageAtom
  );
  const hasCreatedWorkflowRef = useRef(false);
  const currentWorkflowName = useAtomValue(currentWorkflowNameAtom);

  // Reset sidebar animation state when on homepage
  useEffect(() => {
    setHasSidebarBeenShown(false);
  }, [setHasSidebarBeenShown]);

  // Update page title when workflow name changes
  useEffect(() => {
    document.title = `${currentWorkflowName} - KeeperHub`;
  }, [currentWorkflowName]);

  // Helper to create anonymous session if needed
  const ensureSession = useCallback(async () => {
    if (!session) {
      await authClient.signIn.anonymous();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, [session]);

  // start custom keeperhub code //
  // Handler to add initial nodes and create the workflow.
  // Creation is done here (not in a useEffect watching nodes) to avoid a race
  // condition where stale nodes from a previously-open workflow would be picked
  // up by the effect before the init effect's setNodes([placeholder]) is applied.
  const handleAddNode = useCallback(async () => {
    if (hasCreatedWorkflowRef.current) {
      return;
    }
    hasCreatedWorkflowRef.current = true;

    const { nodes: defaultNodes, edges: defaultEdges } = createDefaultNodes();
    setNodes(defaultNodes);
    setEdges(defaultEdges);

    try {
      await ensureSession();

      const newWorkflow = await api.workflow.create({
        name: "Untitled Workflow",
        description: "",
        nodes: defaultNodes,
        edges: defaultEdges,
      });

      refetchSidebar();
      sessionStorage.setItem("animate-sidebar", "true");
      setIsTransitioningFromHomepage(true);
      router.replace(`/workflows/${newWorkflow.id}`);
    } catch (error) {
      console.error("Failed to create workflow:", error);
      toast.error("Failed to create workflow");
      hasCreatedWorkflowRef.current = false;
    }
  }, [
    setNodes,
    setEdges,
    ensureSession,
    router,
    setIsTransitioningFromHomepage,
  ]);
  // end keeperhub code //

  // Initialize with a temporary "add" node on mount
  useEffect(() => {
    const addNodePlaceholder: WorkflowNode = {
      id: "add-node-placeholder",
      type: "add",
      position: { x: 0, y: 0 },
      data: {
        label: "",
        type: "add",
        onClick: handleAddNode,
      },
      draggable: false,
      selectable: false,
    };
    setNodes([addNodePlaceholder]);
    setEdges([]);
    setCurrentWorkflowId(null);
    setCurrentWorkflowName("New Workflow");
    hasCreatedWorkflowRef.current = false;
  }, [
    setNodes,
    setEdges,
    setCurrentWorkflowId,
    setCurrentWorkflowName,
    handleAddNode,
  ]);

  // Canvas and toolbar are rendered by PersistentCanvas in the layout
  return null;
};

export default Home;
