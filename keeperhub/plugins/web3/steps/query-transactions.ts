import "server-only";

import { eq } from "drizzle-orm";
import { withPluginMetrics } from "@/keeperhub/lib/metrics/instrumentation/plugin";
import { db } from "@/lib/db";
import { explorerConfigs } from "@/lib/db/schema";
import { getAddressUrl } from "@/lib/explorer";
import { getChainIdFromNetwork } from "@/lib/rpc";
import { type StepInput, withStepLogging } from "@/lib/steps/step-handler";
import {
  type QueryTransactionsCoreInput,
  type QueryTransactionsResult,
  queryTransactionsCore,
} from "./query-transactions-core";

export type QueryTransactionsInput = StepInput & QueryTransactionsCoreInput;

export async function queryTransactionsStep(
  input: QueryTransactionsInput
): Promise<QueryTransactionsResult> {
  "use step";

  let enrichedInput: QueryTransactionsInput & { contractAddressLink?: string } =
    input;
  try {
    const chainId = getChainIdFromNetwork(input.network);
    const explorerConfig = await db.query.explorerConfigs.findFirst({
      where: eq(explorerConfigs.chainId, chainId),
    });
    if (explorerConfig) {
      const contractAddressLink = getAddressUrl(
        explorerConfig,
        input.contractAddress
      );
      if (contractAddressLink) {
        enrichedInput = { ...input, contractAddressLink };
      }
    }
  } catch {
    // Non-critical: if lookup fails, input logs without the link
  }

  return withPluginMetrics(
    {
      pluginName: "web3",
      actionName: "query-transactions",
      executionId: input._context?.executionId,
    },
    () => withStepLogging(enrichedInput, () => queryTransactionsCore(input))
  );
}

export const _integrationType = "web3";
