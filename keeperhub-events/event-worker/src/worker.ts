import express, { type Request, type Response } from "express";
import {
  KEEPERHUB_API_URL,
  PORT,
  TIMEOUT_BETWEEN_SYNC,
} from "./config/environment";
import { logger } from "./config/logger";
import { httpService } from "./services/http-service";

const app = express();

app.use(express.json());

const synchronizedData: { workflows: any[]; networks: Record<string, any> } = {
  workflows: [],
  networks: {},
};

async function fetchData(): Promise<void> {
  try {
    const { workflows, networks } = await httpService.get(
      `${KEEPERHUB_API_URL}/api/workflows/events?active=true`,
    );

    synchronizedData.workflows = workflows;
    synchronizedData.networks = networks;

    logger.log(
      `[Event Worker - External sync] - ${synchronizedData.workflows.length} active workflows`,
    );
    logger.log(`Service active - uptime: ${process.uptime()}`);
  } catch (error) {
    const err = error as Error;
    logger.error("Error fetching data:");
    logger.error(`Error fetching data: ${JSON.stringify(error, null, 2)}`);
    logger.error(`Error fetching data: ${err.message}`);
  }
}

fetchData();

setInterval(fetchData, TIMEOUT_BETWEEN_SYNC);

app.get("/data", (_: Request, res: Response) => {
  logger.log(
    `[Event Worker - Internal sync] - ${JSON.stringify(
      synchronizedData.workflows.length,
    )} active workflows`,
  );

  res.json(synchronizedData);
});

app.post("/workflow/:id/execute", async (req: Request, res: Response) => {
  const { ...payload } = req.body;
  const { id } = req.params;
  const wrappedPayload = { input: payload };

  try {
    const response = await httpService.post(
      `${KEEPERHUB_API_URL}/api/workflow/${id}/execute`,
      wrappedPayload,
      {
        "X-Internal-Execution": "true",
      },
    );

    logger.log(
      `Workflow ${id} executed successfully - response: ${JSON.stringify(
        response,
        null,
        2,
      )}`,
    );

    return res.status(200).json(response);
  } catch (error) {
    const err = error as Error;
    logger.error(`Workflow ${id} execution failed - error: ${err.message}`);
    return res.status(500).json({ error: "Error executing workflow" });
  }
});

app.post("/refresh", async (_: Request, res: Response) => {
  try {
    logger.log("Manual refresh listeners triggered");
    await fetchData();
    res.json({
      status: "success",
      message: "Data refreshed successfully",
      workflows: synchronizedData.workflows.length,
    });
  } catch (error) {
    const err = error as Error;
    logger.error(err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.listen(PORT, () => {
  logger.log(`Worker service running on port ${PORT}`);
});
