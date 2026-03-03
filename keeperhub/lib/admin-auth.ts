import crypto from "node:crypto";

export type AdminAuthResult = {
  authenticated: boolean;
  error?: string;
};

function secureCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function authenticateAdmin(request: Request): AdminAuthResult {
  const adminKey = process.env.TEST_API_KEY;
  if (!adminKey) {
    return { authenticated: false, error: "Admin API not configured" };
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      authenticated: false,
      error: "Missing or invalid Authorization header",
    };
  }

  const token = authHeader.slice(7);
  if (!secureCompare(token, adminKey)) {
    return { authenticated: false, error: "Invalid admin API key" };
  }

  return { authenticated: true };
}

export function validateTestEmail(email: string): string | null {
  if (!email?.endsWith("@techops.services")) {
    return "Email must end with @techops.services";
  }
  return null;
}
