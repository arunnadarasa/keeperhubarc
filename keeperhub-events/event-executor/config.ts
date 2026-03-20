function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export const KEEPERHUB_API_URL = requireEnv(
  "KEEPERHUB_API_URL",
  "http://localhost:3000",
);
export const KEEPERHUB_API_KEY = requireEnv("KEEPERHUB_API_KEY");

export const AWS_REGION = requireEnv("AWS_REGION", "us-east-1");
export const AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL;

export const SQS_QUEUE_URL = requireEnv(
  "SQS_QUEUE_URL",
  "http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/keeperhub-events-queue",
);
