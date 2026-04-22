import type { NetworksMap } from "../../lib/types";
import { logger } from "../../lib/utils/logger";
import { buildEventAbi } from "../chains/event-serializer";
import type { AbiEvent } from "../chains/validation";
import type { WorkflowRegistration } from "./registry";

/**
 * Maps the KeeperHub API workflow response shape into a WorkflowRegistration
 * suitable for ListenerRegistry.add(). Returns null for workflows that are
 * malformed (missing nodes, bad ABI JSON, unknown chainId). Callers should
 * skip null-returning workflows rather than throw.
 *
 * Extracted from main.ts so it can be unit-tested in isolation.
 */

interface RawNodeConfig {
  network?: unknown;
  eventName?: unknown;
  contractABI?: unknown;
  contractAddress?: unknown;
}

interface RawNode {
  data?: {
    config?: RawNodeConfig;
  };
}

interface RawWorkflow {
  id?: unknown;
  name?: unknown;
  userId?: unknown;
  nodes?: RawNode[];
}

export function buildRegistration(
  workflow: RawWorkflow,
  networks: NetworksMap,
): WorkflowRegistration | null {
  const workflowId = typeof workflow.id === "string" ? workflow.id : null;
  if (!workflowId) {
    logger.warn("[workflow-mapper] workflow missing id; skipping");
    return null;
  }

  const node = workflow.nodes?.[0];
  if (!node?.data?.config) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} has no node config; skipping`,
    );
    return null;
  }
  const config = node.data.config;

  const chainIdStr = typeof config.network === "string" ? config.network : null;
  if (!chainIdStr) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} has no chainId in node.data.config.network; skipping`,
    );
    return null;
  }
  const chainId = Number(chainIdStr);
  if (!Number.isFinite(chainId)) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} chainId "${chainIdStr}" is not numeric; skipping`,
    );
    return null;
  }
  const network = networks[chainId];
  if (!network) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} references unknown chainId ${chainId}; skipping`,
    );
    return null;
  }

  const contractAddress =
    typeof config.contractAddress === "string" ? config.contractAddress : null;
  if (!contractAddress) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} missing contractAddress; skipping`,
    );
    return null;
  }

  const eventName =
    typeof config.eventName === "string" ? config.eventName : null;
  if (!eventName) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} missing eventName; skipping`,
    );
    return null;
  }

  const abiRaw =
    typeof config.contractABI === "string" ? config.contractABI : null;
  if (!abiRaw) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} missing contractABI; skipping`,
    );
    return null;
  }
  let parsedAbi: unknown;
  try {
    parsedAbi = JSON.parse(abiRaw);
  } catch (err) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} has invalid contractABI JSON: ${String(err)}; skipping`,
    );
    return null;
  }
  if (!Array.isArray(parsedAbi)) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} contractABI is not an array; skipping`,
    );
    return null;
  }
  const rawEventsAbi = (parsedAbi as AbiEvent[]).filter(
    (entry) => entry?.type === "event",
  );
  if (rawEventsAbi.length === 0) {
    logger.warn(
      `[workflow-mapper] workflow ${workflowId} contractABI contains no events; skipping`,
    );
    return null;
  }
  const eventsAbiStrings = rawEventsAbi.map(buildEventAbi);

  const userId = typeof workflow.userId === "string" ? workflow.userId : "";
  const workflowName = typeof workflow.name === "string" ? workflow.name : "";

  return {
    workflowId,
    userId,
    workflowName,
    chainId,
    wssUrl: network.defaultPrimaryWss,
    contractAddress,
    eventName,
    eventsAbiStrings,
    rawEventsAbi,
  };
}
