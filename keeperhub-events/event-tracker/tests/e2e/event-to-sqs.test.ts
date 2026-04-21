/**
 * E2E baseline for the current fork-based event-tracker architecture.
 *
 * Requires the `test` docker-compose profile (test-anvil, test-localstack,
 * test-redis). Run with:
 *
 *   docker compose --profile test up -d test-anvil test-localstack test-localstack-init test-redis
 *   pnpm test
 *
 * Skipped when SKIP_INFRA_TESTS=true.
 */

import type { SQSClient } from "@aws-sdk/client-sqs";
import type { ethers } from "ethers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAnvilChainId,
  getAnvilRpcUrl,
  getAnvilWallet,
  getAnvilWssUrl,
  waitForAnvil,
} from "./helpers/anvil-helpers";
import {
  type DeployedFixture,
  deployEventEmitter,
} from "./helpers/fixture-contract";
import { type MockApiServer, startMockApi } from "./helpers/mock-api";
import {
  createQueue,
  deleteQueue,
  makeSqsClient,
  pollForMessage,
  purgeQueue,
} from "./helpers/sqs-helpers";

const SKIP_INFRA_TESTS = process.env.SKIP_INFRA_TESTS === "true";
const AWS_ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4567";
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6380);
const TEST_QUEUE_NAME = "keeperhub-event-tracker-test-queue";
const WORKFLOW_ID = "test-workflow-keep-295";

function buildWorkflow(address: string, abi: unknown[]): unknown {
  return {
    id: WORKFLOW_ID,
    name: "Phase 0 Baseline",
    userId: "test-user",
    organizationId: "test-org",
    enabled: true,
    nodes: [
      {
        id: "node-1",
        type: "trigger",
        selected: false,
        data: {
          type: "event-trigger",
          label: "Emitted",
          status: "active",
          description: "Baseline listener for fork architecture",
          config: {
            network: String(getAnvilChainId()),
            eventName: "Emitted",
            contractABI: JSON.stringify(abi),
            triggerType: "event",
            contractAddress: address,
          },
        },
      },
    ],
  };
}

function buildNetworks(): Record<number, unknown> {
  const now = new Date().toISOString();
  return {
    [getAnvilChainId()]: {
      id: `local-${getAnvilChainId()}`,
      chainId: getAnvilChainId(),
      name: "Anvil",
      symbol: "ETH",
      chainType: "evm",
      defaultPrimaryRpc: getAnvilRpcUrl(),
      defaultFallbackRpc: getAnvilRpcUrl(),
      defaultPrimaryWss: getAnvilWssUrl(),
      defaultFallbackWss: getAnvilWssUrl(),
      isTestnet: true,
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
    },
  };
}

describe.skipIf(SKIP_INFRA_TESTS)(
  "event-tracker: on-chain event -> SQS (fork architecture baseline)",
  () => {
    let fixture: DeployedFixture;
    let wallet: ethers.Wallet;
    let mockApi: MockApiServer;
    let sqsClient: SQSClient;
    let queueUrl: string;
    // Modules imported dynamically after env is set up, so redis.ts picks up
    // the correct REDIS_HOST/PORT before it constructs its client.
    let syncModule: {
      registerContainer: () => Promise<void>;
      removeAllContainers: () => Promise<void>;
      rtStorage?: { quit?: () => Promise<unknown> };
    };
    let synchronizeData: () => Promise<void>;

    beforeAll(async () => {
      await waitForAnvil();
      wallet = getAnvilWallet();
      fixture = await deployEventEmitter(wallet);

      sqsClient = makeSqsClient(AWS_ENDPOINT);
      queueUrl = await createQueue(sqsClient, TEST_QUEUE_NAME, AWS_ENDPOINT);
      await purgeQueue(sqsClient, queueUrl);

      mockApi = await startMockApi();
      mockApi.setResponse("/api/workflows/events", {
        workflows: [buildWorkflow(fixture.address, fixture.abi)],
        networks: buildNetworks(),
      });

      process.env.KEEPERHUB_API_URL = mockApi.url;
      process.env.KEEPERHUB_API_KEY = "test-key";
      process.env.SQS_QUEUE_URL = queueUrl;
      process.env.AWS_ENDPOINT_URL = AWS_ENDPOINT;
      process.env.AWS_REGION = "us-east-1";
      process.env.AWS_ACCESS_KEY_ID = "test";
      process.env.AWS_SECRET_ACCESS_KEY = "test";
      process.env.REDIS_HOST = REDIS_HOST;
      process.env.REDIS_PORT = String(REDIS_PORT);
      process.env.NODE_ENV = "test";

      const redisMod = await import("../../lib/sync/redis");
      syncModule = redisMod.syncModule;
      const mainMod = await import("../../src/main");
      synchronizeData = mainMod.synchronizeData;

      await syncModule.removeAllContainers();
      await syncModule.registerContainer();
    }, 120_000);

    afterAll(async () => {
      // Ask the fork architecture to tear down its child processes by sending
      // an empty workflow list, then disconnect Redis so vitest exits cleanly.
      try {
        mockApi?.setResponse("/api/workflows/events", {
          workflows: [],
          networks: {},
        });
        if (synchronizeData) {
          await synchronizeData();
        }
      } catch {
        // best-effort cleanup
      }
      try {
        await syncModule?.removeAllContainers?.();
      } catch {
        // ignore
      }
      try {
        // SyncModule holds its Redis client as a protected `rtStorage` field.
        // Closing it lets vitest exit without hanging on open handles.
        await syncModule?.rtStorage?.quit?.();
      } catch {
        // ignore
      }
      await mockApi?.close();
      await deleteQueue(sqsClient, queueUrl);
    }, 30_000);

    it("forwards an emitted contract event to SQS", async () => {
      await synchronizeData();

      // Give the forked child time to boot, connect WSS, and register the
      // filter before we emit. 5s is generous for local anvil.
      await new Promise((r) => setTimeout(r, 5_000));

      const emitEvent = fixture.contract.getFunction("emitEvent");
      const tx = await emitEvent(42n);
      await tx.wait();

      const message = await pollForMessage(sqsClient, queueUrl, 20_000);
      expect(message, "no SQS message received within timeout").not.toBeNull();
      const body = JSON.parse(message?.Body ?? "{}") as {
        workflowId: string;
        triggerType: string;
        triggerData: unknown;
      };
      expect(body.workflowId).toBe(WORKFLOW_ID);
      expect(body.triggerType).toBe("event");
      expect(body.triggerData).toBeDefined();
    }, 90_000);
  },
);
