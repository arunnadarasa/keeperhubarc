#!/usr/bin/env bash
# Runs k6 load test at increasing VU tiers, collecting per-tier results.
# Outputs a JSON file with per-tier summaries for CI consumption.
#
# Usage: ./ci-staged-load-test.sh [base_url]
# Env: BASE_URL, TEST_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
RESULTS_DIR="${RESULTS_DIR:-/tmp/k6-results}"
TIERS=(1 10 25 50 100)

mkdir -p "$RESULTS_DIR"

# JSON array accumulator
echo '[]' > "$RESULTS_DIR/all-tiers.json"

overall_exit=0

for vus in "${TIERS[@]}"; do
  echo "========================================="
  echo "Running load test tier: ${vus} VUs"
  echo "========================================="

  summary_file="$RESULTS_DIR/tier-${vus}.json"
  output_file="$RESULTS_DIR/tier-${vus}-output.txt"

  tier_exit=0
  k6 run "$SCRIPT_DIR/load-test.js" \
    --vus "$vus" \
    --iterations "$((vus * 1))" \
    --summary-export "$summary_file" \
    -e BASE_URL="$BASE_URL" \
    -e TEST_API_KEY="${TEST_API_KEY:-}" \
    -e CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID:-}" \
    -e CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET:-}" \
    -e K6_SCENARIO=ci \
    --no-usage-report \
    2>&1 | tee "$output_file" || tier_exit=$?

  # Extract key metrics from the summary JSON, with fallbacks if file is missing
  if [ -f "$summary_file" ]; then
    # Parse metrics from k6 summary export
    tier_json=$(python3 -c "
import json, sys, re

with open('$summary_file') as f:
    data = json.load(f)

metrics = data.get('metrics', {})

# HTTP request duration
dur = metrics.get('http_req_duration', {}).get('values', {})
p95 = dur.get('p(95)', 0)
p99 = dur.get('p(99)', 0)
avg = dur.get('avg', 0)
med = dur.get('med', 0)

# HTTP request failed rate
failed = metrics.get('http_req_failed', {}).get('values', {})
fail_rate = failed.get('rate', 0)

# Total requests
reqs = metrics.get('http_reqs', {}).get('values', {})
total_reqs = int(reqs.get('count', 0))
rps = reqs.get('rate', 0)

# Checks
checks = metrics.get('checks', {}).get('values', {})
check_passes = int(checks.get('passes', 0))
check_fails = int(checks.get('fails', 0))
check_rate = checks.get('rate', 1)

success_rate = (1 - fail_rate) * 100

# Parse issues from output
issues = []
with open('$output_file') as f:
    output = f.read()

# Look for common error patterns
error_patterns = [
    (r'status (\d{3})', 'HTTP errors'),
    (r'connection refused', 'Connection refused'),
    (r'context deadline exceeded', 'Timeout'),
    (r'i/o timeout', 'I/O timeout'),
    (r'no such host', 'DNS resolution failed'),
]

status_codes = {}
for line in output.split('\n'):
    for pattern, label in error_patterns:
        matches = re.findall(pattern, line, re.IGNORECASE)
        for m in matches:
            if pattern == r'status (\d{3})':
                code = int(m)
                if code >= 400:
                    status_codes[code] = status_codes.get(code, 0) + 1
            elif label not in issues:
                issues.append(label)

for code, count in sorted(status_codes.items()):
    issues.append(f'HTTP {code} ({count}x)')

# Check for failed k6 checks in output
failed_checks = re.findall(r'(.+?)\.+:\s+\d+\.\d+%\s+.*\u2717\s+(\d+)', output)
for check_name, fail_count in failed_checks:
    check_name = check_name.strip()
    if int(fail_count) > 0:
        issues.append(f'{check_name} failed ({fail_count}x)')

result = {
    'vus': $vus,
    'exit_code': $tier_exit,
    'total_requests': total_reqs,
    'rps': round(rps, 1),
    'success_rate': round(success_rate, 2),
    'p95_ms': round(p95, 1),
    'p99_ms': round(p99, 1),
    'avg_ms': round(avg, 1),
    'median_ms': round(med, 1),
    'checks_passed': check_passes,
    'checks_failed': check_fails,
    'issues': issues if issues else ['None']
}

print(json.dumps(result))
")
  else
    tier_json="{\"vus\":$vus,\"exit_code\":$tier_exit,\"total_requests\":0,\"rps\":0,\"success_rate\":0,\"p95_ms\":0,\"p99_ms\":0,\"avg_ms\":0,\"median_ms\":0,\"checks_passed\":0,\"checks_failed\":0,\"issues\":[\"k6 failed to produce summary\"]}"
  fi

  # Append tier result to the accumulated JSON array
  python3 -c "
import json
with open('$RESULTS_DIR/all-tiers.json') as f:
    arr = json.load(f)
arr.append(json.loads('$tier_json'))
with open('$RESULTS_DIR/all-tiers.json', 'w') as f:
    json.dump(arr, f, indent=2)
"

  echo "Tier $vus result: $tier_json"
  echo ""

  if [ "$tier_exit" -ne 0 ]; then
    overall_exit=1
  fi
done

echo "========================================="
echo "All tiers complete. Results: $RESULTS_DIR/all-tiers.json"
echo "========================================="

cat "$RESULTS_DIR/all-tiers.json"

exit $overall_exit
