const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AuthorizationCode = {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  userId: string;
  organizationId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: number;
};

export type RefreshTokenEntry = {
  token: string;
  clientId: string;
  userId: string;
  organizationId: string;
  scope: string;
  expiresAt: number;
};

export type OAuthClient = {
  clientId: string;
  clientSecretHash: string;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  grantTypes: string[];
  organizationId: string | null;
  createdAt: number;
};

const authCodes = new Map<string, AuthorizationCode>();
const refreshTokens = new Map<string, RefreshTokenEntry>();
const oauthClients = new Map<string, OAuthClient>();

export function storeAuthCode(entry: AuthorizationCode): void {
  authCodes.set(entry.code, entry);
}

export function getAuthCode(code: string): AuthorizationCode | undefined {
  const entry = authCodes.get(code);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    authCodes.delete(code);
    return undefined;
  }
  return entry;
}

export function deleteAuthCode(code: string): void {
  authCodes.delete(code);
}

export function storeRefreshToken(entry: RefreshTokenEntry): void {
  refreshTokens.set(entry.token, entry);
}

export function getRefreshToken(token: string): RefreshTokenEntry | undefined {
  const entry = refreshTokens.get(token);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    refreshTokens.delete(token);
    return undefined;
  }
  return entry;
}

export function deleteRefreshToken(token: string): void {
  refreshTokens.delete(token);
}

export function storeOAuthClient(client: OAuthClient): void {
  oauthClients.set(client.clientId, client);
}

export function getOAuthClient(clientId: string): OAuthClient | undefined {
  return oauthClients.get(clientId);
}

export function cleanupExpiredAuthCodes(): void {
  const now = Date.now();
  for (const [code, entry] of authCodes) {
    if (now > entry.expiresAt) {
      authCodes.delete(code);
    }
  }
}

export function cleanupExpiredRefreshTokens(): void {
  const now = Date.now();
  for (const [token, entry] of refreshTokens) {
    if (now > entry.expiresAt) {
      refreshTokens.delete(token);
    }
  }
}

export { AUTH_CODE_TTL_MS, REFRESH_TOKEN_TTL_MS };
