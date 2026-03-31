import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentRegistrations } from "@/lib/db/schema";

export async function GET(_request: Request): Promise<NextResponse> {
  try {
    const rows = await db.select().from(agentRegistrations).limit(1);
    const registration = rows[0] ?? null;

    const registrationJson = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "KeeperHub",
      description:
        "Web3 workflow automation platform. Build and deploy on-chain automations through a visual builder. Workflows are callable by AI agents via MCP.",
      image: "https://app.keeperhub.com/keeperhub_logo.png",
      services: [
        { name: "mcp", endpoint: "https://app.keeperhub.com/mcp" },
        { name: "web", endpoint: "https://app.keeperhub.com" },
        { name: "ens", endpoint: "keeperhub.eth" },
      ],
      x402Support: true,
      active: true,
      registrations: registration
        ? [
            {
              agentId: registration.agentId,
              agentRegistry: `eip155:1:${registration.registryAddress}`,
            },
          ]
        : [],
    };

    return NextResponse.json(registrationJson, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
    });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to load agent registry" },
      { status: 500 }
    );
  }
}
