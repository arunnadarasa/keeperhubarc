import { findActionById } from "../plugins/registry";
import type { WorkflowNode } from "../lib/workflow-store";
import type { ExecutionMode } from "./types";

/**
 * Determine whether a workflow requires isolated K8s Job execution
 * or can run in-process.
 *
 * Workflows containing web3 write actions (transfer-funds, transfer-token,
 * write-contract, approve-token) require isolation because they handle
 * wallet key material and send on-chain transactions.
 *
 * Read-only and web2 workflows run in-process to avoid K8s Job overhead.
 */
export function determineExecutionMode(
  nodes: WorkflowNode[]
): ExecutionMode {
  for (const node of nodes) {
    if (node.data.type !== "action") {
      continue;
    }

    const actionType = node.data.config?.actionType as string | undefined;
    if (!actionType) {
      continue;
    }

    const action = findActionById(actionType);
    if (!action) {
      continue;
    }

    // requiresCredentials is the signal for state-changing actions that
    // need wallet access. Currently set on web3 write actions:
    // transfer-funds, transfer-token, write-contract, approve-token
    if (action.requiresCredentials) {
      return "k8s-job";
    }
  }

  return "in-process";
}
