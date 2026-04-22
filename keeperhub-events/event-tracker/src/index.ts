import os from "node:os";
import { syncModule } from "../lib/sync/redis";
import { logger } from "../lib/utils/logger";
import { synchronizeData } from "./main";

// Fatal-error handlers: an uncaught exception or unhandled rejection inside a
// listener callback is almost always a bug that leaves the process in an
// indeterminate state. Log and exit so K8s restarts the pod. Under the fork
// model the blast radius was one child; under the in-process model the blast
// radius is the whole pod, which makes these handlers load-bearing for the
// Phase 4+ path.
process.on("uncaughtException", (err: Error) => {
  logger.error(`[Fatal] uncaughtException: ${err.message}\n${err.stack ?? ""}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack ?? "") : "";
  logger.error(`[Fatal] unhandledRejection: ${message}\n${stack}`);
  process.exit(1);
});

logger.log(`Initializing container: ${os.hostname()}`);

const initialize = async (): Promise<void> => {
  try {
    await syncModule.removeAllContainers();
    logger.log("Cleared stale Redis state from previous deploys");

    await syncModule.registerContainer();
    await synchronizeData();

    setInterval(synchronizeData, 30_000);

    logger.log("Initialization complete.");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error during initialization: ${message}`);
  }
};

initialize();
