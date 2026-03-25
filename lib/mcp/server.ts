import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools";

export function createMcpServer(
  baseUrl: string,
  authHeader: string
): McpServer {
  const server = new McpServer({
    name: "keeperhub",
    version: "1.0.0",
  });

  registerTools(server, baseUrl, authHeader);

  return server;
}
