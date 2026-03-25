import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type ApiResponse = Record<string, unknown>;

async function callApi(
  baseUrl: string,
  authHeader: string,
  path: string,
  method: string,
  body?: unknown
): Promise<ApiResponse> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader,
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API call failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as ApiResponse;
  }

  return { result: await response.text() };
}

export function registerTools(
  server: McpServer,
  baseUrl: string,
  authHeader: string
): void {
  // =========================================================================
  // Workflow CRUD
  // =========================================================================

  server.tool(
    "list_workflows",
    "List all workflows for the authenticated organization. Optionally filter by projectId or tagId.",
    {
      projectId: z
        .string()
        .optional()
        .describe("Optional project ID to filter workflows"),
      tagId: z
        .string()
        .optional()
        .describe("Optional tag ID to filter workflows"),
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.projectId) {
        params.set("projectId", args.projectId);
      }
      if (args.tagId) {
        params.set("tagId", args.tagId);
      }
      const query = params.toString();
      const path = `/api/workflows${query ? `?${query}` : ""}`;
      const data = await callApi(baseUrl, authHeader, path, "GET");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_workflow",
    "Get a single workflow by ID, including its nodes, edges, and configuration.",
    {
      workflowId: z.string().describe("The workflow ID"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/workflows/${args.workflowId}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "create_workflow",
    "Create a new workflow with nodes and edges. Nodes define the trigger and actions; edges define the execution flow.",
    {
      name: z.string().describe("Workflow name"),
      description: z
        .string()
        .optional()
        .describe("Optional workflow description"),
      nodes: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Workflow nodes (trigger + action nodes)"),
      edges: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Workflow edges connecting nodes"),
      projectId: z
        .string()
        .optional()
        .describe("Optional project ID to assign the workflow to"),
      tagId: z
        .string()
        .optional()
        .describe("Optional tag ID to label the workflow"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        "/api/workflows",
        "POST",
        {
          name: args.name,
          description: args.description,
          nodes: args.nodes,
          edges: args.edges,
          projectId: args.projectId,
          tagId: args.tagId,
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "update_workflow",
    "Update an existing workflow's name, description, nodes, edges, or project/tag assignment.",
    {
      workflowId: z.string().describe("The workflow ID to update"),
      name: z.string().optional().describe("New workflow name"),
      description: z.string().optional().describe("New workflow description"),
      nodes: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Updated workflow nodes"),
      edges: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Updated workflow edges"),
      projectId: z
        .string()
        .nullable()
        .optional()
        .describe("Project ID to assign (null to unassign)"),
      tagId: z
        .string()
        .nullable()
        .optional()
        .describe("Tag ID to assign (null to unassign)"),
    },
    async (args) => {
      const { workflowId, ...body } = args;
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/workflows/${workflowId}`,
        "PUT",
        body
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "delete_workflow",
    "Delete a workflow by ID. This action is irreversible.",
    {
      workflowId: z.string().describe("The workflow ID to delete"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/workflows/${args.workflowId}`,
        "DELETE"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Execution
  // =========================================================================

  server.tool(
    "execute_workflow",
    "Trigger a manual execution of a workflow. Returns the execution ID for status polling.",
    {
      workflowId: z.string().describe("The workflow ID to execute"),
      input: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional input data to pass to the workflow trigger"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/workflow/${args.workflowId}/execute`,
        "POST",
        { input: args.input ?? {} }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_execution_status",
    "Get the current status of a workflow execution by execution ID.",
    {
      executionId: z
        .string()
        .describe("The execution ID returned by execute_workflow"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/executions/${args.executionId}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_execution_logs",
    "Get detailed step-by-step logs for a workflow execution.",
    {
      executionId: z.string().describe("The execution ID to fetch logs for"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/executions/${args.executionId}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // AI Workflow Generation
  // =========================================================================

  server.tool(
    "ai_generate_workflow",
    "Generate a complete workflow from a natural language description using AI. Returns a workflow definition ready to be created.",
    {
      prompt: z
        .string()
        .describe(
          "Natural language description of the workflow to generate, e.g. 'Monitor USDC transfers over $10k and send a Discord alert'"
        ),
      context: z
        .string()
        .optional()
        .describe("Additional context or constraints for the AI generator"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        "/api/ai/generate",
        "POST",
        { prompt: args.prompt, context: args.context }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Discovery
  // =========================================================================

  server.tool(
    "list_action_schemas",
    "List all available action schemas, triggers, and supported chains. Use this to discover what actions and integrations are available for workflow creation.",
    {
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category (e.g., 'web3', 'discord', 'system', 'triggers')"
        ),
      includeChains: z
        .boolean()
        .optional()
        .describe(
          "Whether to include supported blockchain networks (default: true)"
        ),
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.category) {
        params.set("category", args.category);
      }
      if (args.includeChains === false) {
        params.set("includeChains", "false");
      }
      const query = params.toString();
      const path = `/api/mcp/schemas${query ? `?${query}` : ""}`;
      const data = await callApi(baseUrl, authHeader, path, "GET");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "search_plugins",
    "Search for available workflow plugins and integrations by keyword.",
    {
      query: z
        .string()
        .describe("Search query to find relevant plugins or actions"),
    },
    async (args) => {
      const params = new URLSearchParams({ category: args.query });
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/mcp/schemas?${params.toString()}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_plugin",
    "Get schema details for a specific plugin or integration type.",
    {
      pluginType: z
        .string()
        .describe(
          "Plugin type identifier (e.g., 'web3', 'discord', 'sendgrid')"
        ),
    },
    async (args) => {
      const params = new URLSearchParams({ category: args.pluginType });
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/mcp/schemas?${params.toString()}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "list_integrations",
    "List all configured integrations (credentials) for the organization. These are required for actions like Discord notifications or Sendgrid emails.",
    {},
    async () => {
      const data = await callApi(
        baseUrl,
        authHeader,
        "/api/integrations",
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_wallet_integration",
    "Get details for a specific wallet integration. Required for web3 write actions like fund transfers and contract writes.",
    {
      integrationId: z.string().describe("The integration (wallet) ID"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/integrations/${args.integrationId}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Templates
  // =========================================================================

  server.tool(
    "search_templates",
    "Search for pre-built workflow templates that can be deployed and customized.",
    {
      query: z
        .string()
        .optional()
        .describe("Search query to find relevant templates"),
      category: z.string().optional().describe("Filter templates by category"),
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.query) {
        params.set("q", args.query);
      }
      if (args.category) {
        params.set("category", args.category);
      }
      const query = params.toString();
      const path = `/api/workflows/public${query ? `?${query}` : ""}`;
      const data = await callApi(baseUrl, authHeader, path, "GET");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "get_template",
    "Get details of a specific workflow template by ID.",
    {
      templateId: z.string().describe("The template workflow ID"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/workflows/${args.templateId}`,
        "GET"
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.tool(
    "deploy_template",
    "Clone a public template workflow into the organization as a new workflow.",
    {
      templateId: z.string().describe("The template workflow ID to clone"),
      name: z
        .string()
        .optional()
        .describe("Optional name for the cloned workflow"),
    },
    async (args) => {
      const data = await callApi(
        baseUrl,
        authHeader,
        `/api/workflows/${args.templateId}/duplicate`,
        "POST",
        { name: args.name }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // =========================================================================
  // Meta
  // =========================================================================

  server.tool(
    "tools_documentation",
    "Get documentation on how to use the KeeperHub MCP tools, including examples and best practices for workflow creation.",
    {},
    () => {
      const text = [
        "KeeperHub MCP Tools Documentation",
        "",
        "WORKFLOW CREATION",
        "1. Call list_action_schemas to discover available actions and triggers",
        "2. Call ai_generate_workflow with a natural language prompt to generate a workflow",
        "3. Call create_workflow with the generated definition to persist it",
        "4. Call execute_workflow to run it manually",
        "5. Call get_execution_status to poll for completion",
        "",
        "WORKFLOW MANAGEMENT",
        "- list_workflows: List all org workflows (filter by projectId or tagId)",
        "- get_workflow: Fetch a single workflow by ID",
        "- update_workflow: Modify name, nodes, edges, project, or tag",
        "- delete_workflow: Permanently delete a workflow",
        "",
        "INTEGRATIONS",
        "- list_integrations: See all configured credentials (Discord, Sendgrid, wallets)",
        "- get_wallet_integration: Get a specific wallet credential (needed for web3 writes)",
        "",
        "TEMPLATES",
        "- search_templates: Browse public workflow templates",
        "- get_template: Inspect a template's structure",
        "- deploy_template: Clone a template into your org",
        "",
        "TEMPLATE SYNTAX",
        "Reference outputs from previous nodes using: {{@nodeId:Label.field}}",
        "Example: {{@check-balance:Check Balance.balance}}",
        "",
        "CHAIN IDs",
        "- Ethereum Mainnet: 1",
        "- Base: 8453",
        "- Sepolia Testnet: 11155111",
        "- Use list_action_schemas (with includeChains: true) for the full list",
      ].join("\n");

      return {
        content: [{ type: "text", text }],
      };
    }
  );
}
