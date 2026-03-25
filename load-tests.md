# k6 Load Test Results - PR Environment

**Date:** 2026-03-24
**Target:** PR-663 environment (`app-pr-663.keeperhub.com`) via `kubectl port-forward`
**Cluster:** techops-staging (us-east-1), namespace `pr-663`
**Infrastructure:** db.t4g.medium RDS (PostgreSQL 17), single replica app pod, Redis, LocalStack (SQS)

## Test Configuration

| Parameter       | Value                      |
|-----------------|----------------------------|
| Threshold       | 95% success rate           |
| Step size       | +5 VUs per step            |
| Step duration   | 30 seconds                 |
| Max VUs         | 500                        |
| Start VUs       | 1                          |
| Test script     | `tests/k6/ramp-until-breach.sh` |
| User journey    | Signup -> OTP verify -> Signin -> Create 5 workflows -> List/Get/Execute/Webhook workflows |

## Results Summary

**Threshold breached at 16 VUs (Step 4)** - success rate dropped to 63.53%, well below the 95% threshold.

| Step | VUs | Success Rate | Requests | RPS   | p95 (ms) | Avg (ms) | Checks        | Status |
|------|-----|-------------|----------|-------|----------|----------|---------------|--------|
| 1    | 1   | 97.25%      | 218      | 7.2   | 142.6    | 137.6    | 211/217       | PASS   |
| 2    | 6   | 97.15%      | 738      | 24.6  | 128.3    | 243.8    | 711/732       | PASS   |
| 3    | 11  | 98.94%      | 1,042    | 34.6  | 129.1    | 317.0    | 1,020/1,031   | PASS   |
| 4    | 16  | 63.53%      | 85       | 2.5   | 27,731.7 | 6,278.8  | 38/69         | FAIL   |

## Detailed Step Analysis

### Step 1: 1 VU (97.25% success)

- **Duration:** 30s
- **Requests:** 218 total, 7.2 RPS
- **Latency:** avg 137.6ms, median 114.6ms, p95 142.6ms
- **Failed checks:** 6 out of 217

**Issues:**
- `api-key create: status 200` - 0/1 passed (401 Unauthorized)
- `workflow create: status 200` - 0/5 passed (401 Unauthorized)

**Root cause:** After successful signup/OTP/signin, the session cookie is set but API key creation returns 401. This appears to be a session handling issue where the authenticated session is not properly propagated to subsequent API calls within the same k6 iteration. The user journey still works for list/get operations that use the session cookie, but API key creation fails.

Despite the 401s on API key creation, the overall success rate stays at 97.25% because the majority of HTTP requests (health checks, list workflows, etc.) succeed.

### Step 2: 6 VUs (97.15% success)

- **Duration:** 30s
- **Requests:** 738 total, 24.6 RPS
- **Latency:** avg 243.8ms, median 114.5ms, p95 128.3ms, max 10.89s
- **Failed checks:** 21 out of 732

**Issues:**
- `verify: status 200` - 3/6 passed (50%) - rate limiting on OTP verification endpoint (HTTP 429)
- `api-key create: status 200` - 0/3 passed (401 Unauthorized on remaining authenticated users)
- `workflow create: status 200` - 0/15 passed (401 Unauthorized)

**Root cause:** Rate limiter begins rejecting concurrent OTP verification requests at 6 VUs. The `better-auth` rate limiter applies per-endpoint throttling. Users who fail OTP verification cannot proceed to workflow creation, cascading to zero workflow operations for those users.

### Step 3: 11 VUs (98.94% success)

- **Duration:** 30s
- **Requests:** 1,042 total, 34.6 RPS
- **Latency:** avg 317.0ms, median 114.3ms, p95 129.1ms, max 19.2s
- **Failed checks:** 11 out of 1,031

**Issues:**
- `verify: status 200` - 0/11 passed (0%) - all OTP verifications rate-limited (HTTP 429)
- All 11 VUs failed auth, so no workflow operations were attempted

**Observation:** Paradoxically, the success rate is *higher* (98.94%) because users who fail auth still generate successful HTTP requests during the steady-state loop (list workflows returns 200 even with an empty list). The 11 failures are exclusively the OTP verification checks.

### Step 4: 16 VUs (63.53% success - THRESHOLD BREACHED)

- **Duration:** 30s (mostly spent on timeouts)
- **Requests:** 85 total, 2.5 RPS (severe degradation)
- **Latency:** avg 6,278.8ms, median 138.4ms, p95 27,731.7ms (27.7 seconds)
- **Failed checks:** 31 out of 69

**Issues:**
- `verify: status 200` - 3/16 passed (18%) - most OTP verifications rate-limited
- `api-key create: status 200` - 0/3 passed (401 Unauthorized)
- `workflow create: status 200` - 0/15 passed (401 Unauthorized)
- HTTP request failure rate: 36.47%
- p95 latency: 27.7 seconds (requests timing out)

**Root cause:** At 16 concurrent VUs, the application becomes overwhelmed. The combination of:
1. Rate limiter rejecting most auth requests (429)
2. Requests backing up and timing out (27+ second p95)
3. Only 85 total requests completed in 30s (vs 1,042 at 11 VUs)

This indicates the single-pod deployment hits a wall between 11-16 concurrent users.

## Bottleneck Analysis

### Primary bottleneck: Rate limiting on auth endpoints

The `better-auth` middleware applies per-endpoint rate limiting that begins to reject requests at 6+ concurrent signups/verifications. This is by design for production security but limits load test throughput.

**Affected endpoints:**
- `POST /api/auth/email-otp/verify-email` - most impacted, 429 errors start at 6 VUs
- `POST /api/auth/sign-in/email` - impacted at higher VU counts

### Secondary bottleneck: Session/cookie handling in k6

API key creation (`POST /api/api-keys`) consistently returns 401 even after successful signin. This suggests the k6 HTTP client is not properly maintaining session cookies across requests, or the session is not fully established by the time the API key request is made.

### Tertiary bottleneck: Single pod resource limits

At 16 VUs, the application pod becomes unresponsive (27s p95 latency, 2.5 RPS). The PR environment runs a single pod with limited resources. Horizontal pod autoscaling or increased resource limits would improve this.

## Cleanup

After the test, all k6 test users were cleaned up via the `POST /api/admin/test/cleanup` endpoint:

| Resource       | Deleted |
|----------------|---------|
| Users          | 413     |
| Organizations  | 413     |
| Workflows      | 345     |

The 413 users include leftovers from previous test runs (earlier iterations of this PR). All related data (sessions, accounts, API keys, workflow executions, verifications) was deleted in a single transaction.

**Post-cleanup verification:** Zero k6 test records remain in the database.

## Recommendations

1. **Rate limiter tuning for test mode:** Consider relaxing rate limits when `TEST_API_KEY` is present in the request headers, or adding a configurable rate limit bypass for load testing.

2. **Session cookie handling:** Investigate why API key creation returns 401 after successful signin. May need to explicitly extract and forward the `set-cookie` response from signin in the k6 auth helper.

3. **Horizontal scaling:** Test with multiple app replicas to find the actual per-pod capacity ceiling vs the rate limiter ceiling.

4. **Separate auth from steady-state:** Consider a test mode that pre-creates users via admin API, so the load test can focus on workflow CRUD/execution throughput without being bottlenecked by auth rate limiting.

## Environment Details

| Component          | Configuration                                    |
|--------------------|--------------------------------------------------|
| App                | 1 pod, KeeperHub Next.js (Node.js 22)            |
| Database           | CNPG PostgreSQL 16 (PR-isolated instance)        |
| Redis              | 1 pod (PR-isolated)                              |
| LocalStack         | 1 pod (SQS emulation)                            |
| k6                 | v0.56.0, run from local machine via port-forward |
| Network            | kubectl port-forward (localhost:8663 -> pod:3000) |
| Scheduler          | Dispatcher + Executor (staging images)            |
| Events             | Tracker + Worker (staging images)                 |
