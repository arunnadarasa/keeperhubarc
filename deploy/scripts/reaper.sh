#!/bin/sh
set -e

URL="$1"

if [ -z "$URL" ]; then
  echo '{"error":"missing URL argument"}' >&2
  exit 1
fi

if [ -z "$SCHEDULER_SERVICE_API_KEY" ]; then
  echo '{"error":"SCHEDULER_SERVICE_API_KEY not set"}' >&2
  exit 1
fi

echo "Environment variables are ready"

curl -sS \
  -w '\n{"http_code":%{http_code},"time_total":%{time_total}}' \
  -H "X-Service-Key: ${SCHEDULER_SERVICE_API_KEY}" \
  "$URL"
