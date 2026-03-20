import { KEEPERHUB_API_KEY, KEEPERHUB_API_URL } from "./config";

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${KEEPERHUB_API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Service-Key": KEEPERHUB_API_KEY,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `API ${options.method || "GET"} ${path} failed: ${response.status} ${text}`,
    );
  }

  return response.json() as Promise<T>;
}
