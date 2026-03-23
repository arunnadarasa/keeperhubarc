import axios, { type AxiosError } from "axios";
import {
  JWT_TOKEN_PASSWORD,
  JWT_TOKEN_USERNAME,
  KEEPERHUB_API_KEY,
  KEEPERHUB_API_URL,
} from "../config/environment";
import { logger } from "../config/logger";

const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 30_000;

function getRetryDelay(error: AxiosError): number {
  const retryAfter = error.response?.headers?.["retry-after"];
  if (retryAfter) {
    const parsed = Number(retryAfter);
    if (!Number.isNaN(parsed)) {
      return parsed * 1000;
    }
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HttpService {
  private accessToken: string | undefined;

  async get(url: string): Promise<any> {
    return this._withRetry(
      () => axios.get(url, { headers: this.getHeaders() }).then((r) => r.data),
      url,
    );
  }

  async post(
    url: string,
    data: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<any> {
    return this._withRetry(
      () =>
        axios
          .post(url, data, { headers: this.getHeaders(extraHeaders) })
          .then((r) => r.data),
      url,
    );
  }

  async _withRetry(
    requestFn: () => Promise<any>,
    url: string,
    attempt = 1,
  ): Promise<any> {
    try {
      return await requestFn();
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 429 && attempt < MAX_ATTEMPTS) {
        const delay = getRetryDelay(axiosError);
        logger.log(
          `[HttpService] 429 received (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}ms: ${url}`,
        );
        await sleep(delay);
        return this._withRetry(requestFn, url, attempt + 1);
      }
      throw error;
    }
  }

  async authorize(): Promise<HttpService> {
    const payload = new URLSearchParams();
    payload.append("username", JWT_TOKEN_USERNAME);
    payload.append("password", JWT_TOKEN_PASSWORD);

    const url = `${KEEPERHUB_API_URL}/auth/token`;
    const { data } = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    this.accessToken = data.access_token;

    return this;
  }

  getHeaders(
    extraHeaders: Record<string, string> = {},
  ): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      "X-Internal-Token": KEEPERHUB_API_KEY,
      "X-Service-Key": KEEPERHUB_API_KEY,
      ...extraHeaders,
    };
  }
}

export const httpService = new HttpService();
