import { ethers } from "ethers";

export type CalldataResult =
  | { success: true; to: string; data: string; value: string }
  | { success: false; error: string };

type WriteNodeConfig = {
  contractAddress: string;
  abi: string;
  abiFunction: string;
  functionArgs?: string;
  ethValue?: string;
};

type WriteNode = {
  config: WriteNodeConfig;
};

// Defined at module level to satisfy Biome useTopLevelRegex rule
const TRIGGER_TEMPLATE_RE = /\{\{@trigger:Trigger\.(\w+)\}\}/g;
const UNRESOLVED_TEMPLATE_RE = /\{\{@[^}]+\}\}/;

function isWriteActionType(actionType: unknown): boolean {
  if (typeof actionType !== "string") {
    return false;
  }
  return (
    actionType.includes("write-contract") ||
    actionType.includes("protocol-write")
  );
}

export function findFirstWriteActionNode(
  nodes: unknown[]
): WriteNode | undefined {
  for (const node of nodes) {
    if (
      node !== null &&
      typeof node === "object" &&
      "data" in node &&
      node.data !== null &&
      typeof node.data === "object" &&
      "actionType" in node.data &&
      isWriteActionType(node.data.actionType) &&
      "config" in node.data &&
      node.data.config !== null &&
      typeof node.data.config === "object"
    ) {
      const config = node.data.config as WriteNodeConfig;
      return { config };
    }
  }
  return undefined;
}

export function resolveTriggerTemplates(
  value: string,
  triggerInputs: Record<string, unknown>
): string {
  return value.replace(TRIGGER_TEMPLATE_RE, (_match, fieldName: string) => {
    const resolved = triggerInputs[fieldName];
    return resolved !== undefined ? String(resolved) : _match;
  });
}

export function generateCalldataForWorkflow(
  nodes: unknown[],
  triggerInputs: Record<string, unknown>
): CalldataResult {
  const writeNode = findFirstWriteActionNode(nodes);
  if (!writeNode) {
    return { success: false, error: "No write action node found in workflow" };
  }

  const { contractAddress, abi, abiFunction, functionArgs, ethValue } =
    writeNode.config;

  let parsedAbi: unknown[];
  try {
    parsedAbi = JSON.parse(abi) as unknown[];
  } catch {
    return { success: false, error: "Invalid ABI JSON in workflow node" };
  }

  let resolvedArgs: unknown[] = [];
  if (functionArgs) {
    let rawArgs: unknown[];
    try {
      rawArgs = JSON.parse(functionArgs) as unknown[];
    } catch {
      return {
        success: false,
        error: "Invalid functionArgs JSON in workflow node",
      };
    }

    resolvedArgs = rawArgs.map((arg) => {
      if (typeof arg === "string") {
        return resolveTriggerTemplates(arg, triggerInputs);
      }
      return arg;
    });

    for (const arg of resolvedArgs) {
      if (typeof arg === "string" && UNRESOLVED_TEMPLATE_RE.test(arg)) {
        return {
          success: false,
          error: `Unresolvable template reference: ${arg}`,
        };
      }
    }
  }

  const iface = new ethers.Interface(parsedAbi as ethers.InterfaceAbi);
  const data = iface.encodeFunctionData(abiFunction, resolvedArgs);

  const value =
    ethValue && ethValue.length > 0
      ? ethers.parseEther(ethValue).toString()
      : "0";

  return { success: true, to: contractAddress, data, value };
}
