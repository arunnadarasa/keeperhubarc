# k6 Execution Load Test Results

**Date:** 2026-03-25
**Target:** PR-663 environment (`app-pr-663.keeperhub.com`) via Cloudflare Access service token
**Cluster:** techops-staging EKS (us-east-1), namespace `pr-663`
**Infrastructure:** Single app pod, CNPG PostgreSQL 16, Redis, LocalStack (SQS)
**Test tool:** k6 v0.56.0 with pure JavaScript, no curl dependencies

## Test Design

Each k6 VU (virtual user):
1. **Signs up** (email + password) with retry on 429
2. **Verifies email** via admin OTP endpoint with retry
3. **Signs in** to establish session
4. **Creates 5 workflows** with realistic node patterns (2-7 nodes: conditions, HTTP chains, branching, parallel reads)
5. **Hammers workflow executions** in a tight loop using `X-Service-Key` auth (same auth path the scheduler service uses in production)

VUs ramp up gradually (one new VU every 5 seconds) to avoid rate-limit storms during user creation. Once a VU is ready, it fires executions continuously with 0.5s pause between calls.

Teardown cleans up all test users, workflows, and executions automatically.

## Results

| Concurrent VUs | Workflows | Triggers | Success | Fail | Success Rate | Throughput | p95 Latency | Median |
|---------------|-----------|----------|---------|------|-------------|------------|-------------|--------|
| **10** | 50 | 643 | 643 | 0 | **100%** | 4.8/sec (286/min) | 1.36s | 200ms |
| **12** | 55 | 816 | 675 | 141 | **82.72%** | 4.8/sec (289/min) | 1.59s | 211ms |
| **15** | 75 | 913 | 708 | 205 | **77.54%** | 3.9/sec (232/min) | 1.89s | 200ms |
| **20** | 80 | 1,038 | 734 | 304 | **70.71%** | 3.4/sec (204/min) | 3.21s | 202ms |

## Key Findings

### Capacity: 10 concurrent executing users at 100% success

The single-pod PR environment sustains **10 concurrent VUs executing workflows at 100% success rate, ~5 executions/second (286/min)**, with p95 latency of 1.36 seconds.

### Sharp degradation at 12+ VUs

Success rate drops sharply from 100% to 82.72% when going from 10 to 12 concurrent VUs. The failures are HTTP 500 or timeout responses on the execute endpoint, indicating the app process reaches its concurrency limit. Throughput doesn't increase beyond ~5/sec — additional VUs only add contention.

### Throughput ceiling: ~5 executions/second

Regardless of VU count, maximum throughput plateaus at approximately 4.8 executions/second. At 20 VUs, throughput actually decreases (3.4/sec) as the app spends more time handling contention than executing workflows.

### Latency profile

- **Median latency stays flat** at ~200ms across all VU levels — individual requests are fast when they succeed
- **p95 increases** from 1.36s (10 VUs) to 3.21s (20 VUs) — tail latency worsens under load
- **Max latency** reaches 5-7 seconds at higher concurrency

## Bottleneck Analysis

### Primary: Node.js single-thread + workflow execution concurrency

Workflow execution runs inline in the API process via the Workflow SDK `start()` function. Each execution occupies the Node.js event loop while processing nodes (HTTP requests, condition evaluation, DB writes for execution logs). At 10+ concurrent executions, the event loop saturates.

The `checkConcurrencyLimit()` function in the execute endpoint may also be rejecting requests when too many workflows are already executing.

### Secondary: Database connection pool

The app uses a connection pool of max 10 connections (`postgres({ max: 10 })`). Each workflow execution performs multiple DB operations (create execution record, create log entries per node, update status). At 10+ concurrent executions, the pool becomes the bottleneck.

### Not a bottleneck: Rate limiting

Rate limiting only affects the setup phase (user creation). Once VUs are authenticated, the execute endpoint does not have rate limiting — failures are from genuine overload, not policy.

## Recommendations

1. **Horizontal scaling**: Add more app replicas. With 2 pods, capacity should roughly double to ~20 concurrent users.
2. **Increase DB connection pool**: Raise `max` from 10 to 25-50 to match pod concurrency needs.
3. **Async execution dispatch**: Move workflow execution from inline to K8s Jobs via SQS (the infrastructure already exists via LocalStack). This would decouple trigger latency from execution latency.
4. **Production baseline**: Run this same test against staging (2 replicas, real RDS) to get production-representative numbers.

## Test Configuration

```bash
k6 run execution-load-test.js \
  -e BASE_URL=https://app-pr-663.keeperhub.com \
  -e TEST_API_KEY=placeholder \
  -e SERVICE_KEY=<scheduler-service-key> \
  -e CF_ACCESS_CLIENT_ID=<cf-id> \
  -e CF_ACCESS_CLIENT_SECRET=<cf-secret> \
  -e TARGET_VUS=10 \
  -e WF_PER_VU=5 \
  -e DURATION=60s \
  -e RAMP_INTERVAL=5
```

## Cleanup

All tests cleaned up automatically via `POST /api/admin/test/cleanup` in the k6 teardown function. Verified zero test records remaining after each run.

| Run | Users Cleaned | Orgs | Workflows |
|-----|--------------|------|-----------|
| 10 VU | 10 | 10 | 50 |
| 12 VU | 12 | 12 | 55 |
| 15 VU | 15 | 15 | 75 |
| 20 VU | 25 | 25 | 80 |
