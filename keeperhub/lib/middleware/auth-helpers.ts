import { authenticateApiKey } from "@/keeperhub/lib/api-key-auth";
import { getOrgContext } from "@/keeperhub/lib/middleware/org-context";
import { auth } from "@/lib/auth";

export type DualAuthContext =
  | { userId: string | null; organizationId: string | null }
  | { error: string; status: number };

/**
 * Resolves user and organization context from either API key or session auth.
 * API key auth sets userId to null (org-level access only).
 *
 * @param required - If true (default), returns 401 when neither auth method succeeds.
 *   Set to false for routes that allow unauthenticated access (e.g. public workflows).
 */
export async function getDualAuthContext(
  request: Request,
  options?: { required?: boolean }
): Promise<DualAuthContext> {
  const required = options?.required ?? true;

  const apiKeyAuth = await authenticateApiKey(request);
  if (apiKeyAuth.authenticated) {
    return {
      userId: null,
      organizationId: apiKeyAuth.organizationId || null,
    };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    if (required) {
      return { error: "Unauthorized", status: 401 };
    }
    return { userId: null, organizationId: null };
  }

  const orgContext = await getOrgContext();
  return {
    userId: session.user.id,
    organizationId: orgContext.organization?.id || null,
  };
}

/**
 * Resolves the organization ID from either an API key or session.
 * Used by PATCH/DELETE routes that only need org-level authorization.
 */
export async function resolveOrganizationId(
  request: Request
): Promise<{ organizationId: string } | { error: string; status: number }> {
  const apiKeyAuth = await authenticateApiKey(request);

  if (apiKeyAuth.authenticated) {
    const organizationId = apiKeyAuth.organizationId;
    if (!organizationId) {
      return { error: "No active organization", status: 400 };
    }
    return { organizationId };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { error: "Unauthorized", status: 401 };
  }

  const orgContext = await getOrgContext();
  const organizationId = orgContext.organization?.id;
  if (!organizationId) {
    return { error: "No active organization", status: 400 };
  }
  return { organizationId };
}

/**
 * Resolves both organization ID and user ID from either an API key or session.
 * Used by POST routes that need to track the creator.
 */
export async function resolveCreatorContext(
  request: Request
): Promise<
  { organizationId: string; userId: string } | { error: string; status: number }
> {
  const apiKeyAuth = await authenticateApiKey(request);
  if (apiKeyAuth.authenticated) {
    const organizationId = apiKeyAuth.organizationId || null;
    const userId = apiKeyAuth.userId || null;
    if (!organizationId) {
      return { error: "No active organization", status: 400 };
    }
    if (!userId) {
      return {
        error: "API key has no associated user. Please recreate the API key.",
        status: 400,
      };
    }
    return { organizationId, userId };
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { error: "Unauthorized", status: 401 };
  }

  const context = await getOrgContext();
  const organizationId = context.organization?.id || null;
  if (!organizationId) {
    return { error: "No active organization", status: 400 };
  }
  return { organizationId, userId: session.user.id };
}
