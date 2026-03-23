import axios from "axios";
import { WORKER_URL } from "../config/environment";
import type { SyncData } from "../types";
import { logger } from "./logger";

export async function fetchActiveWorkflows(): Promise<SyncData | null> {
  try {
    const { data } = await axios.get<SyncData>(`${WORKER_URL}/data`);
    return data;
  } catch (error: any) {
    logger.warn(`Failed to fetch active workflows: ${error.message}`);
    return null;
  }
}
