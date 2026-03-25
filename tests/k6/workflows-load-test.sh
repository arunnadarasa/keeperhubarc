#!/usr/bin/env bash
# Execution-focused load test orchestrator.
#
# Creates users and workflows, then observes execution success rate
# in escalating rounds. Each round adds more workflows per user.
# Stops when execution success rate drops below threshold.
#
# Usage: ./workflows-load-test.sh <base_url> [options]
# Options (env vars):
#   USERS=20             Number of test users to create
#   WF_PER_ROUND=5       Workflows added per user per round
#   OBSERVE_WINDOW=600   Observation window in seconds (default 10 min)
#   THRESHOLD=95         Execution success rate threshold (%)
#   MAX_ROUNDS=10        Maximum number of scaling rounds
#   TEST_API_KEY         Admin API key for user creation/cleanup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${1:?Usage: $0 <base_url>}"
USERS="${USERS:-20}"
WF_PER_ROUND="${WF_PER_ROUND:-5}"
OBSERVE_WINDOW="${OBSERVE_WINDOW:-600}"
THRESHOLD="${THRESHOLD:-95}"
MAX_ROUNDS="${MAX_ROUNDS:-10}"
RESULTS_DIR="${RESULTS_DIR:-/tmp/k6-exec-load}"

mkdir -p "$RESULTS_DIR"

# Auth headers for API calls
AUTH_HEADERS=(-H "Content-Type: application/json" -H "Origin: $BASE_URL" -H "Referer: $BASE_URL/")
if [ -n "${TEST_API_KEY:-}" ]; then
  AUTH_HEADERS+=(-H "X-Test-API-Key: $TEST_API_KEY")
fi
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  AUTH_HEADERS+=(-H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
fi

ADMIN_HEADERS=("${AUTH_HEADERS[@]}")
if [ -n "${TEST_API_KEY:-}" ]; then
  ADMIN_HEADERS+=(-H "Authorization: Bearer $TEST_API_KEY")
fi

echo "========================================="
echo "Execution-Focused Load Test"
echo "  Target:           $BASE_URL"
echo "  Users:            $USERS"
echo "  Workflows/round:  $WF_PER_ROUND per user"
echo "  Observe window:   ${OBSERVE_WINDOW}s"
echo "  Threshold:        ${THRESHOLD}% execution success"
echo "  Max rounds:       $MAX_ROUNDS"
echo "========================================="
echo ""

# ─── Phase 1: Create users ───────────────────────────────────────────────

echo "Phase 1: Creating $USERS test users..."
echo '[]' > "$RESULTS_DIR/users.json"

for i in $(seq 1 "$USERS"); do
  ts=$(date +%s%3N)
  email="k6-vu${i}-${ts}@techops.services"
  password="K6LoadTest!2024"
  name="k6-user-${i}"

  # Sign up
  signup_res=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/sign-up/email" \
    "${AUTH_HEADERS[@]}" -d "{\"email\":\"$email\",\"password\":\"$password\",\"name\":\"$name\"}")
  signup_status=$(echo "$signup_res" | tail -1)
  signup_body=$(echo "$signup_res" | sed '$d')

  if [ "$signup_status" != "200" ]; then
    echo "  User $i: signup failed ($signup_status)"
    continue
  fi

  # Get OTP via admin endpoint
  otp=""
  for attempt in $(seq 1 10); do
    otp_res=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/admin/test/otp?email=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$email'))")" \
      "${ADMIN_HEADERS[@]}")
    otp_status=$(echo "$otp_res" | tail -1)
    otp_body=$(echo "$otp_res" | sed '$d')
    if [ "$otp_status" = "200" ]; then
      otp=$(echo "$otp_body" | python3 -c "import sys,json; print(json.load(sys.stdin)['otp'])")
      break
    fi
    sleep 1
  done

  if [ -z "$otp" ]; then
    echo "  User $i: OTP retrieval failed"
    continue
  fi

  # Verify email
  verify_res=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/email-otp/verify-email" \
    "${AUTH_HEADERS[@]}" -d "{\"email\":\"$email\",\"otp\":\"$otp\"}")
  verify_status=$(echo "$verify_res" | tail -1)

  if [ "$verify_status" != "200" ]; then
    echo "  User $i: verify failed ($verify_status)"
    continue
  fi

  # Sign in (capture cookies)
  cookie_jar="$RESULTS_DIR/cookies-user-${i}.txt"
  signin_res=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/sign-in/email" \
    "${AUTH_HEADERS[@]}" -c "$cookie_jar" -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  signin_status=$(echo "$signin_res" | tail -1)

  if [ "$signin_status" != "200" ]; then
    echo "  User $i: signin failed ($signin_status)"
    continue
  fi

  # Create API key
  apikey_res=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/api-keys" \
    "${AUTH_HEADERS[@]}" -b "$cookie_jar" -d "{\"name\":\"k6-test-vu${i}\"}")
  apikey_status=$(echo "$apikey_res" | tail -1)
  apikey_body=$(echo "$apikey_res" | sed '$d')
  apikey=""
  if [ "$apikey_status" = "200" ]; then
    apikey=$(echo "$apikey_body" | python3 -c "import sys,json; print(json.load(sys.stdin).get('key',''))" 2>/dev/null || echo "")
  fi

  # Save user data
  python3 -c "
import json
with open('$RESULTS_DIR/users.json') as f:
    users = json.load(f)
users.append({
    'index': $i,
    'email': '$email',
    'cookieJar': '$cookie_jar',
    'apiKey': '$apikey',
    'workflows': []
})
with open('$RESULTS_DIR/users.json', 'w') as f:
    json.dump(users, f, indent=2)
"

  echo "  User $i: $email (created)"
  sleep 2
done

active_users=$(python3 -c "import json; print(len(json.load(open('$RESULTS_DIR/users.json'))))")
echo ""
echo "Created $active_users users out of $USERS requested."
echo ""

if [ "$active_users" -eq 0 ]; then
  echo "No users created. Aborting."
  exit 1
fi

# ─── Phase 2+: Scaling rounds ────────────────────────────────────────────

echo '[]' > "$RESULTS_DIR/rounds.json"
total_wf_per_user=0

for round in $(seq 1 "$MAX_ROUNDS"); do
  echo "========================================="
  echo "Round $round: Adding $WF_PER_ROUND workflows per user"
  echo "========================================="

  # Create workflows for each user
  python3 << PYEOF
import json, subprocess, sys, time

base_url = "$BASE_URL"
results_dir = "$RESULTS_DIR"
wf_per_round = $WF_PER_ROUND
round_num = $round

with open(f"{results_dir}/users.json") as f:
    users = json.load(f)

# Build workflow payloads using the 10 patterns
patterns = [
    # pattern_index, trigger_type, node_count
    (0, "Manual", 2),
    (1, "Manual", 3),
    (2, "Schedule", 4),
    (3, "Webhook", 2),
    (4, "Schedule", 7),
    (5, "Manual", 5),
    (6, "Manual", 5),
    (7, "Schedule", 3),
    (8, "Manual", 4),
    (9, "Webhook", 3),
]

def http_action(aid, label, x, y):
    return {
        "id": aid, "type": "action",
        "position": {"x": x, "y": y},
        "data": {"type": "action", "label": label, "config": {
            "actionType": "HTTP Request",
            "endpoint": f"{base_url}/api/health",
            "httpMethod": "GET", "httpHeaders": "{}", "httpBody": "{}"
        }}
    }

def condition_action(cid, label, x, y):
    return {
        "id": cid, "type": "action",
        "position": {"x": x, "y": y},
        "data": {"type": "action", "label": label, "config": {
            "actionType": "Condition", "condition": "1 === 1"
        }}
    }

def trigger_node(ttype, extra=None):
    config = {"triggerType": ttype}
    if extra:
        config.update(extra)
    return {
        "id": "trigger-1", "type": "trigger",
        "position": {"x": 100, "y": 100},
        "data": {"type": "trigger", "label": f"{ttype} Trigger", "config": config}
    }

def build_workflow(pattern_idx, vu_id, suffix):
    p = pattern_idx % len(patterns)
    _, ttype, _ = patterns[p]

    if p == 0:  # Manual -> HTTP
        nodes = [trigger_node("Manual"), http_action("a1", "Read Data", 300, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"}]
    elif p == 1:  # Manual -> Condition -> HTTP
        nodes = [trigger_node("Manual"), condition_action("c1", "Check", 300, 100), http_action("a1", "Act", 500, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "c1", "type": "default"},
                 {"id": "e2", "source": "c1", "target": "a1", "type": "default"}]
    elif p == 2:  # Schedule -> HTTP -> Condition -> HTTP
        nodes = [trigger_node("Schedule", {"scheduleCron": "* * * * *", "scheduleTimezone": "UTC"}),
                 http_action("a1", "Read", 300, 100), condition_action("c1", "Check", 500, 100),
                 http_action("a2", "Notify", 700, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"},
                 {"id": "e2", "source": "a1", "target": "c1", "type": "default"},
                 {"id": "e3", "source": "c1", "target": "a2", "type": "default"}]
    elif p == 3:  # Webhook -> HTTP
        nodes = [trigger_node("Webhook"), http_action("a1", "Process", 300, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"}]
    elif p == 4:  # Schedule -> 2xHTTP -> 2xCondition -> 2xHTTP (7 nodes)
        nodes = [trigger_node("Schedule", {"scheduleCron": "* * * * *", "scheduleTimezone": "UTC"}),
                 http_action("a1", "Read 1", 300, 50), http_action("a2", "Read 2", 300, 200),
                 condition_action("c1", "Check 1", 500, 50), condition_action("c2", "Check 2", 500, 200),
                 http_action("a3", "Alert 1", 700, 50), http_action("a4", "Alert 2", 700, 200)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"},
                 {"id": "e2", "source": "trigger-1", "target": "a2", "type": "default"},
                 {"id": "e3", "source": "a1", "target": "c1", "type": "default"},
                 {"id": "e4", "source": "a2", "target": "c2", "type": "default"},
                 {"id": "e5", "source": "c1", "target": "a3", "type": "default"},
                 {"id": "e6", "source": "c2", "target": "a4", "type": "default"}]
    elif p == 5:  # Manual -> HTTP -> Condition -> 2xHTTP
        nodes = [trigger_node("Manual"), http_action("a1", "Read", 300, 100),
                 condition_action("c1", "Check", 500, 100),
                 http_action("a2", "If True", 700, 50), http_action("a3", "If False", 700, 200)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"},
                 {"id": "e2", "source": "a1", "target": "c1", "type": "default"},
                 {"id": "e3", "source": "c1", "target": "a2", "type": "default"},
                 {"id": "e4", "source": "c1", "target": "a3", "type": "default"}]
    elif p == 6:  # Manual -> 3xHTTP -> Condition
        nodes = [trigger_node("Manual"),
                 http_action("a1", "Src 1", 300, 50), http_action("a2", "Src 2", 300, 150),
                 http_action("a3", "Src 3", 300, 250), condition_action("c1", "Agg", 500, 150)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"},
                 {"id": "e2", "source": "trigger-1", "target": "a2", "type": "default"},
                 {"id": "e3", "source": "trigger-1", "target": "a3", "type": "default"},
                 {"id": "e4", "source": "a1", "target": "c1", "type": "default"},
                 {"id": "e5", "source": "a2", "target": "c1", "type": "default"},
                 {"id": "e6", "source": "a3", "target": "c1", "type": "default"}]
    elif p == 7:  # Schedule -> Condition -> HTTP
        nodes = [trigger_node("Schedule", {"scheduleCron": "* * * * *", "scheduleTimezone": "UTC"}),
                 condition_action("c1", "Should Run", 300, 100), http_action("a1", "Act", 500, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "c1", "type": "default"},
                 {"id": "e2", "source": "c1", "target": "a1", "type": "default"}]
    elif p == 8:  # Manual -> 3xHTTP sequential
        nodes = [trigger_node("Manual"),
                 http_action("a1", "Step 1", 300, 100), http_action("a2", "Step 2", 500, 100),
                 http_action("a3", "Step 3", 700, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "a1", "type": "default"},
                 {"id": "e2", "source": "a1", "target": "a2", "type": "default"},
                 {"id": "e3", "source": "a2", "target": "a3", "type": "default"}]
    else:  # Webhook -> Condition -> HTTP
        nodes = [trigger_node("Webhook"),
                 condition_action("c1", "Filter", 300, 100), http_action("a1", "Process", 500, 100)]
        edges = [{"id": "e1", "source": "trigger-1", "target": "c1", "type": "default"},
                 {"id": "e2", "source": "c1", "target": "a1", "type": "default"}]

    return {
        "name": f"k6-p{p}-r{round_num}-{suffix}-vu{vu_id}",
        "description": f"Load test pattern {p} round {round_num}",
        "nodes": nodes, "edges": edges
    }, ttype

for ui, user in enumerate(users):
    created = 0
    for wi in range(wf_per_round):
        pattern_idx = (len(user["workflows"]) + wi)
        payload, ttype = build_workflow(pattern_idx, user["index"], f"w{wi}")

        # Create workflow
        import subprocess as sp
        cookie_args = ["-b", user["cookieJar"]] if user.get("cookieJar") else []
        cmd = ["curl", "-s", "-w", r"\n%{http_code}", "-X", "POST",
               f"{base_url}/api/workflows/create",
               "-H", "Content-Type: application/json",
               "-H", f"Origin: {base_url}",
               "-H", f"Referer: {base_url}/"]

        test_api_key = "${TEST_API_KEY}"
        if test_api_key:
            cmd += ["-H", f"X-Test-API-Key: {test_api_key}"]
        cmd += cookie_args
        cmd += ["-d", json.dumps(payload)]

        result = sp.run(cmd, capture_output=True, text=True)
        lines = result.stdout.strip().split("\n")
        status = lines[-1] if lines else "0"
        body = "\n".join(lines[:-1])

        if status != "200":
            print(f"  User {user['index']} wf {wi}: create failed ({status})")
            continue

        wf_data = json.loads(body)
        wf_id = wf_data.get("id", "")

        # Enable workflow (go-live)
        golive_cmd = ["curl", "-s", "-w", r"\n%{http_code}", "-X", "PUT",
                      f"{base_url}/api/workflows/{wf_id}/go-live",
                      "-H", "Content-Type: application/json",
                      "-H", f"Origin: {base_url}",
                      "-H", f"Referer: {base_url}/"]
        if test_api_key:
            golive_cmd += ["-H", f"X-Test-API-Key: {test_api_key}"]
        golive_cmd += cookie_args
        golive_cmd += ["-d", json.dumps({"name": payload["name"]})]

        sp.run(golive_cmd, capture_output=True, text=True)

        user["workflows"].append({
            "id": wf_id,
            "name": payload["name"],
            "triggerType": ttype,
            "patternIndex": pattern_idx % len(patterns)
        })
        created += 1

    print(f"  User {user['index']}: {created} workflows created (total: {len(user['workflows'])})")

with open(f"{results_dir}/users.json", "w") as f:
    json.dump(users, f, indent=2)
PYEOF

  total_wf_per_user=$((total_wf_per_user + WF_PER_ROUND))
  total_workflows=$(python3 -c "
import json
users = json.load(open('$RESULTS_DIR/users.json'))
print(sum(len(u['workflows']) for u in users))
")
  echo ""
  echo "Total active workflows: $total_workflows ($active_users users x ~$total_wf_per_user each)"
  echo ""

  # ─── Observation window ─────────────────────────────────────────────

  echo "Observing for ${OBSERVE_WINDOW}s..."

  # Record the start time for this observation window
  obs_start=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Run k6 in the background to trigger manual/webhook workflows
  k6_vus=$active_users
  k6 run "$SCRIPT_DIR/scenarios/execution-load.js" \
    --vus "$k6_vus" \
    --duration "${OBSERVE_WINDOW}s" \
    -e BASE_URL="$BASE_URL" \
    -e TEST_API_KEY="${TEST_API_KEY:-}" \
    -e CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID:-}" \
    -e CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET:-}" \
    -e K6_SCENARIO=exec-load \
    -e USER_DATA_PATH="$RESULTS_DIR/users.json" \
    --summary-export "$RESULTS_DIR/round-${round}-k6.json" \
    --no-usage-report \
    2>&1 | tee "$RESULTS_DIR/round-${round}-output.txt" || true

  obs_end=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # ─── Collect execution results ──────────────────────────────────────

  echo ""
  echo "Collecting execution results for round $round..."

  # Query execution stats from the API for each user's workflows
  round_result=$(python3 << PYEOF2
import json, subprocess, sys

results_dir = "$RESULTS_DIR"
base_url = "$BASE_URL"
test_api_key = "${TEST_API_KEY:-}"

with open(f"{results_dir}/users.json") as f:
    users = json.load(f)

total_success = 0
total_error = 0
total_pending = 0
total_executions = 0
durations = []

for user in users:
    for wf in user["workflows"]:
        if not wf.get("id"):
            continue

        # Get executions for this workflow
        headers = ["-H", "Content-Type: application/json",
                   "-H", f"Origin: {base_url}",
                   "-H", f"Referer: {base_url}/"]
        if test_api_key:
            headers += ["-H", f"X-Test-API-Key: {test_api_key}"]
        if user.get("cookieJar"):
            headers += ["-b", user["cookieJar"]]

        cmd = ["curl", "-s", f"{base_url}/api/workflows/{wf['id']}/executions"] + headers
        result = subprocess.run(cmd, capture_output=True, text=True)

        try:
            executions = json.loads(result.stdout)
            if not isinstance(executions, list):
                continue
        except:
            continue

        for ex in executions:
            total_executions += 1
            status = ex.get("status", "unknown")
            if status == "success":
                total_success += 1
                if ex.get("duration"):
                    durations.append(float(ex["duration"]))
            elif status == "error":
                total_error += 1
            else:
                total_pending += 1

success_rate = round(100.0 * total_success / max(total_executions, 1), 2)
avg_dur = round(sum(durations) / max(len(durations), 1), 1) if durations else 0
p95_dur = round(sorted(durations)[int(len(durations) * 0.95)] if len(durations) > 1 else (durations[0] if durations else 0), 1)
throughput = round(total_executions / ($OBSERVE_WINDOW / 60), 1)

result = {
    "round": $round,
    "total_workflows": $total_workflows,
    "workflows_per_user": $total_wf_per_user,
    "total_executions": total_executions,
    "success": total_success,
    "errors": total_error,
    "pending": total_pending,
    "success_rate": success_rate,
    "avg_duration_ms": avg_dur,
    "p95_duration_ms": p95_dur,
    "throughput_per_min": throughput
}

print(json.dumps(result))

# Append to rounds file
with open(f"{results_dir}/rounds.json") as f:
    rounds = json.load(f)
rounds.append(result)
with open(f"{results_dir}/rounds.json", "w") as f:
    json.dump(rounds, f, indent=2)
PYEOF2
)

  echo ""
  echo "Round $round result: $round_result"

  # Check threshold
  success_rate=$(echo "$round_result" | python3 -c "import sys,json; print(json.load(sys.stdin)['success_rate'])")
  breached=$(python3 -c "print('yes' if $success_rate < $THRESHOLD else 'no')")

  echo ""
  if [ "$breached" = "yes" ]; then
    echo "========================================="
    echo "THRESHOLD BREACHED in round $round"
    echo "  Success rate: ${success_rate}% < ${THRESHOLD}%"
    echo "  Workflows:    $total_workflows ($active_users users x $total_wf_per_user each)"
    echo "========================================="
    break
  else
    echo "Round $round passed: ${success_rate}% >= ${THRESHOLD}%"
  fi
done

# ─── Report ───────────────────────────────────────────────────────────

echo ""
echo "========================================="
echo "FINAL REPORT"
echo "========================================="
python3 << REPORT
import json

with open("$RESULTS_DIR/rounds.json") as f:
    rounds = json.load(f)

if not rounds:
    print("No rounds completed.")
else:
    for r in rounds:
        status = "PASS" if r["success_rate"] >= $THRESHOLD else "FAIL"
        print(f"Round {r['round']}: {r['total_workflows']} workflows | "
              f"{r['total_executions']} execs | {r['success_rate']}% success | "
              f"avg {r['avg_duration_ms']}ms | {r['throughput_per_min']}/min | {status}")

    last_good = None
    for r in rounds:
        if r["success_rate"] >= $THRESHOLD:
            last_good = r
    if last_good:
        print(f"\nCapacity: {last_good['total_workflows']} active workflows "
              f"at {last_good['success_rate']}% success rate, "
              f"{last_good['throughput_per_min']} executions/min")
    else:
        print(f"\nFirst round already below threshold.")
REPORT
echo "========================================="

# ─── Cleanup ──────────────────────────────────────────────────────────

echo ""
echo "Cleaning up test users..."
cleanup_res=$(curl -s -X POST "$BASE_URL/api/admin/test/cleanup" \
  "${ADMIN_HEADERS[@]}" || echo '{"error":"cleanup failed"}')
echo "Cleanup: $cleanup_res"

echo ""
echo "Results saved to: $RESULTS_DIR/rounds.json"
cat "$RESULTS_DIR/rounds.json"
