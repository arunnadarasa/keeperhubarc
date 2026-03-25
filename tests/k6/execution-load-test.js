// Production-realistic load test.
//
// Creates users and scheduled workflows, enables them via admin endpoint
// (which creates workflow_schedules records), then WAITS for the real
// scheduler-dispatcher to pick them up and trigger executions via SQS.
//
// This is the real production path:
//   scheduler-dispatcher polls /api/internal/schedules every 60s
//   -> evaluates cron -> enqueues to SQS
//   -> scheduler-executor polls SQS -> calls /api/workflow/{id}/execute
//
// k6 run execution-load-test.js \
//   -e BASE_URL=https://app-pr-663.keeperhub.com \
//   -e TEST_API_KEY=placeholder \
//   -e CF_ACCESS_CLIENT_ID=... -e CF_ACCESS_CLIENT_SECRET=... \
//   -e TARGET_VUS=20 -e WF_PER_VU=10 \
//   -e ROUNDS=3 -e OBSERVE_SECONDS=180

import http from "k6/http";
import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TEST_API_KEY = __ENV.TEST_API_KEY || "";
const CF_ID = __ENV.CF_ACCESS_CLIENT_ID || "";
const CF_SECRET = __ENV.CF_ACCESS_CLIENT_SECRET || "";
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || "20", 10);
const WF_PER_VU = parseInt(__ENV.WF_PER_VU || "10", 10);
const ROUNDS = parseInt(__ENV.ROUNDS || "3", 10);
const OBSERVE_SECONDS = parseInt(__ENV.OBSERVE_SECONDS || "180", 10);
const PASSWORD = "K6LoadTest!2024";

// Metrics
const execSuccess = new Counter("exec_success");
const execError = new Counter("exec_error");
const execRate = new Rate("exec_success_rate");
const execDur = new Trend("exec_duration_ms", true);
const wfCreated = new Counter("workflows_created");
const wfEnabled = new Counter("workflows_enabled");

// Scenario — ramp up VUs, hold for all rounds + observation
const rampSec = TARGET_VUS * 5;
const holdSec = ROUNDS * (OBSERVE_SECONDS + 60) + 300;

export const options = {
  scenarios: {
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: `${rampSec}s`, target: TARGET_VUS },
        { duration: `${holdSec}s`, target: TARGET_VUS },
      ],
      gracefulStop: "120s",
    },
  },
  thresholds: {
    exec_success_rate: [{ threshold: "rate>0.90", abortOnFail: false }],
  },
};

// Headers
function h() {
  const hd = { "Content-Type": "application/json", Origin: BASE_URL, Referer: `${BASE_URL}/` };
  if (TEST_API_KEY) hd["X-Test-API-Key"] = TEST_API_KEY;
  if (CF_ID) hd["CF-Access-Client-Id"] = CF_ID;
  if (CF_SECRET) hd["CF-Access-Client-Secret"] = CF_SECRET;
  return hd;
}
function adminH() {
  const hd = h();
  if (TEST_API_KEY) hd["Authorization"] = `Bearer ${TEST_API_KEY}`;
  return hd;
}

// Workflow patterns — all Schedule trigger (production reality: 99.5% Schedule)
function act(id, x, y) {
  return { id, type: "action", position: { x, y }, data: { type: "action", label: id, config: {
    actionType: "HTTP Request", endpoint: `${BASE_URL}/api/health`,
    httpMethod: "GET", httpHeaders: "{}", httpBody: "{}" } } };
}
function cnd(id, x, y) {
  return { id, type: "action", position: { x, y }, data: { type: "action", label: id, config: {
    actionType: "Condition", condition: "1 === 1" } } };
}
function sched() {
  return { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { type: "trigger", label: "Schedule",
    config: { triggerType: "Schedule", scheduleCron: "* * * * *", scheduleTimezone: "UTC" } } };
}
function e(id, s, t) { return { id, source: s, target: t, type: "default" }; }

const PATTERNS = [
  { n: [sched(), act("a1",200,0)], e: [e("e1","t","a1")] },
  { n: [sched(), act("a1",200,0), cnd("c1",400,0), act("a2",600,0)],
    e: [e("e1","t","a1"), e("e2","a1","c1"), e("e3","c1","a2")] },
  { n: [sched(), cnd("c1",200,0), act("a1",400,0)],
    e: [e("e1","t","c1"), e("e2","c1","a1")] },
  { n: [sched(), act("a1",200,-50), act("a2",200,50), cnd("c1",400,-50), cnd("c2",400,50), act("a3",600,-50), act("a4",600,50)],
    e: [e("e1","t","a1"), e("e2","t","a2"), e("e3","a1","c1"), e("e4","a2","c2"), e("e5","c1","a3"), e("e6","c2","a4")] },
  { n: [sched(), act("a1",200,0), act("a2",400,0), act("a3",600,0)],
    e: [e("e1","t","a1"), e("e2","a1","a2"), e("e3","a2","a3")] },
  { n: [sched(), act("a1",200,-50), act("a2",200,50), act("a3",200,150), cnd("c1",400,50)],
    e: [e("e1","t","a1"), e("e2","t","a2"), e("e3","t","a3"), e("e4","a1","c1"), e("e5","a2","c1"), e("e6","a3","c1")] },
  { n: [sched(), act("a1",200,0), cnd("c1",400,0), act("a2",600,-50), act("a3",600,50)],
    e: [e("e1","t","a1"), e("e2","a1","c1"), e("e3","c1","a2"), e("e4","c1","a3")] },
  { n: [sched(), act("a1",200,0)], e: [e("e1","t","a1")] },
  { n: [sched(), cnd("c1",200,0), act("a1",400,0), act("a2",600,0)],
    e: [e("e1","t","c1"), e("e2","c1","a1"), e("e3","a1","a2")] },
  { n: [sched(), act("a1",200,0)], e: [e("e1","t","a1")] },
];

// Per-VU state
let setupDone = false;
let myWfIds = [];
let completedRounds = 0;

function retryPost(url, body, max) {
  for (let a = 1; a <= max; a++) {
    const r = http.post(url, body, { headers: h() });
    if (r.status === 200) return r;
    if (r.status === 429) { sleep(a * 5); continue; }
    return r;
  }
  return { status: 0, body: "retries exhausted" };
}

function doSetup() {
  const v = exec.vu.idInTest;
  const em = `k6-vu${v}-${Date.now()}@techops.services`;

  const su = retryPost(`${BASE_URL}/api/auth/sign-up/email`, JSON.stringify({ email: em, password: PASSWORD, name: `k6-${v}` }), 5);
  if (su.status !== 200) { console.error(`VU${v}: signup ${su.status}`); return false; }
  sleep(1);

  let otp = null;
  for (let i = 0; i < 10; i++) {
    const r = http.get(`${BASE_URL}/api/admin/test/otp?email=${encodeURIComponent(em)}`, { headers: adminH() });
    if (r.status === 200) { otp = JSON.parse(r.body).otp; break; }
    sleep(1);
  }
  if (!otp) { console.error(`VU${v}: no OTP`); return false; }

  const vr = retryPost(`${BASE_URL}/api/auth/email-otp/verify-email`, JSON.stringify({ email: em, otp }), 5);
  if (vr.status !== 200) { console.error(`VU${v}: verify ${vr.status}`); return false; }

  const sr = retryPost(`${BASE_URL}/api/auth/sign-in/email`, JSON.stringify({ email: em, password: PASSWORD }), 5);
  if (sr.status !== 200) { console.error(`VU${v}: signin ${sr.status}`); return false; }

  console.log(`VU${v}: user ${em} ready`);
  return true;
}

function createAndEnableBatch(round) {
  const v = exec.vu.idInTest;
  let created = 0;

  for (let w = 0; w < WF_PER_VU; w++) {
    const p = PATTERNS[(myWfIds.length + w) % PATTERNS.length];
    const nm = `k6-vu${v}-r${round}-w${w}`;

    // Create workflow (uses session cookie from signin)
    const cr = http.post(`${BASE_URL}/api/workflows/create`,
      JSON.stringify({ name: nm, description: "load test", nodes: p.n, edges: p.e }), { headers: h() });
    if (cr.status !== 200) {
      console.error(`VU${v}: wf create failed ${cr.status}`);
      continue;
    }

    const wfId = JSON.parse(cr.body).id;

    // Enable via admin endpoint (bypasses session, creates schedule record)
    const en = http.post(`${BASE_URL}/api/admin/test/enable-workflow`,
      JSON.stringify({ workflowId: wfId }), { headers: adminH() });
    if (en.status === 200) {
      myWfIds.push(wfId);
      wfCreated.add(1);
      wfEnabled.add(1);
      created++;
    } else {
      console.error(`VU${v}: enable failed ${en.status} ${en.body}`);
    }
  }

  console.log(`VU${v}: round ${round} — ${created} workflows enabled (total: ${myWfIds.length})`);
}

function collectResults(round) {
  const v = exec.vu.idInTest;
  let s = 0, er = 0, tot = 0;

  for (const wfId of myWfIds) {
    // Use admin auth to read executions (session might be dead)
    const r = http.get(`${BASE_URL}/api/workflows/${wfId}/executions`, { headers: adminH() });
    if (r.status !== 200) {
      // Try with session cookie (might still work for own workflows)
      const r2 = http.get(`${BASE_URL}/api/workflows/${wfId}/executions`, { headers: h() });
      if (r2.status !== 200) continue;
    }

    let execs;
    try {
      const body = r.status === 200 ? r.body : "";
      execs = JSON.parse(body);
    } catch { continue; }
    if (!Array.isArray(execs)) continue;

    for (const ex of execs) {
      if (ex.status === "success") {
        s++; tot++; execSuccess.add(1); execRate.add(true);
        if (ex.duration) execDur.add(parseFloat(ex.duration));
      } else if (ex.status === "error") {
        er++; tot++; execError.add(1); execRate.add(false);
      }
    }
  }

  const pct = tot > 0 ? Math.round(100 * s / tot) : 0;
  console.log(`VU${v}: round ${round} — ${tot} executions, ${s} success, ${er} error (${pct}%), ${myWfIds.length} active workflows`);
}

// Main loop
export default function () {
  if (!setupDone) {
    setupDone = doSetup();
    if (!setupDone) { sleep(30); return; }
  }

  if (completedRounds >= ROUNDS) {
    sleep(30);
    return;
  }

  const round = completedRounds + 1;

  // Create and enable workflows (scheduler will pick them up)
  createAndEnableBatch(round);

  // Wait for scheduler to trigger them
  console.log(`VU${exec.vu.idInTest}: waiting ${OBSERVE_SECONDS}s for scheduler to trigger ${myWfIds.length} workflows...`);
  sleep(OBSERVE_SECONDS);

  // Collect execution results
  collectResults(round);
  completedRounds = round;
}

// Teardown
export function teardown() {
  console.log("Cleaning up...");
  const r = http.post(`${BASE_URL}/api/admin/test/cleanup`, JSON.stringify({}), { headers: adminH() });
  if (r.status === 200) {
    const d = JSON.parse(r.body).deleted;
    console.log(`Cleaned: ${d.users} users, ${d.organizations} orgs, ${d.workflows} workflows`);
  } else {
    console.error(`Cleanup failed: ${r.status}`);
  }
}
