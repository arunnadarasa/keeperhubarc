import { ENABLE_INPROC_LISTENERS } from "../lib/config/environment";
import { syncModule } from "../lib/sync/redis";
import type { ChildProcessMap, NetworksMap } from "../lib/types";
import { fetchActiveWorkflows } from "../lib/utils/fetch-utils";
import { logger } from "../lib/utils/logger";
import { createRegistry } from "./listener/factory";
import type { ListenerRegistry } from "./listener/registry";
import { buildRegistration } from "./listener/workflow-mapper";
import {
  handleActiveWorkflows,
  removeExcessProcesses,
} from "./process/manager";

const childProcesses: ChildProcessMap = {};

// Lazy: creating the registry opens a Redis connection for dedup, which we
// should not do unless the in-process path is actually in use.
let registry: ListenerRegistry | null = null;

function getRegistry(): ListenerRegistry {
  if (!registry) {
    registry = createRegistry();
  }
  return registry;
}

async function reconcileForked(
  workflows: unknown[],
  networks: NetworksMap,
): Promise<void> {
  await removeExcessProcesses({
    workflows: workflows as never[],
    childProcesses,
    syncService: syncModule,
    logger,
  });

  await handleActiveWorkflows({
    workflows: workflows as never[],
    childProcesses,
    networks: { networks },
    syncService: syncModule,
    logger,
  });
}

async function reconcileInproc(
  workflows: unknown[],
  networks: NetworksMap,
): Promise<void> {
  const reg = getRegistry();

  const activeIds = new Set<string>(
    workflows
      .map((w) => (w as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string"),
  );

  // Remove listeners for workflows that are no longer active.
  for (const id of reg.ids()) {
    if (!activeIds.has(id)) {
      logger.log(`[Reconciler] removing listener ${id} (no longer active)`);
      reg.remove(id);
    }
  }

  // Add listeners for active workflows that are not yet registered.
  for (const workflow of workflows) {
    const id = (workflow as { id?: unknown }).id;
    if (typeof id !== "string" || reg.has(id)) {
      continue;
    }
    const registration = buildRegistration(
      workflow as Parameters<typeof buildRegistration>[0],
      networks,
    );
    if (!registration) {
      continue;
    }
    await reg.add(registration);
  }
}

async function synchronizeData(): Promise<void> {
  logger.log("Synchronizing data");
  try {
    const result = await fetchActiveWorkflows();
    if (!result) {
      logger.warn("No data received from worker, skipping sync cycle");
      return;
    }
    const { workflows, networks } = result;

    logger.log(`Found ${workflows.length} workflows`);
    logger.log(`Found ${Object.keys(networks).length} networks`);
    if (!Array.isArray(workflows)) {
      throw new Error(
        "Invalid data received from database. Expected an array.",
      );
    }

    if (ENABLE_INPROC_LISTENERS) {
      await reconcileInproc(workflows, networks);
    } else {
      await reconcileForked(workflows, networks);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error during synchronization: ${message}`);
  }
}

export { getRegistry, synchronizeData };
