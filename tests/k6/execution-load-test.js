// Production-realistic load test.
//
// Simulates the scheduler service: each VU creates N scheduled-type workflows,
// then triggers them every 60 seconds using X-Service-Key (exactly how the
// production scheduler-executor works). After each observation window,
// collects execution results and adds more workflows.
//
// Workflow patterns: 90% Schedule + 10% Event (matching production distribution)
// All actions use HTTP Request to /api/health (mocking web3/discord calls)
//
// k6 run execution-load-test.js \
//   -e BASE_URL=https://app-pr-663.keeperhub.com \
//   -e TEST_API_KEY=placeholder \
//   -e SERVICE_KEY=<scheduler-service-key> \
//   -e CF_ACCESS_CLIENT_ID=... -e CF_ACCESS_CLIENT_SECRET=... \
//   -e TARGET_VUS=20 -e WF_PER_VU=10 \
//   -e ROUNDS=5 -e OBSERVE_SECONDS=120

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TEST_API_KEY = __ENV.TEST_API_KEY || "";
const CF_ID = __ENV.CF_ACCESS_CLIENT_ID || "";
const CF_SECRET = __ENV.CF_ACCESS_CLIENT_SECRET || "";
const SERVICE_KEY = __ENV.SERVICE_KEY || "";
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || "20", 10);
const WF_PER_VU = parseInt(__ENV.WF_PER_VU || "10", 10);
const ROUNDS = parseInt(__ENV.ROUNDS || "5", 10);
const OBSERVE_SECONDS = parseInt(__ENV.OBSERVE_SECONDS || "120", 10);
const TRIGGER_INTERVAL = parseInt(__ENV.TRIGGER_INTERVAL || "60", 10);
const PASSWORD = "K6LoadTest!2024";

// Metrics
const triggerOk = new Counter("trigger_ok");
const triggerFail = new Counter("trigger_fail");
const execSuccess = new Counter("exec_success");
const execError = new Counter("exec_error");
const execRate = new Rate("exec_success_rate");
const execDur = new Trend("exec_duration_ms", true);
const wfCreated = new Counter("workflows_created");

// Scenario
const rampSec = TARGET_VUS * 5;
const holdSec = ROUNDS * (OBSERVE_SECONDS + 30) + 120;

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
function adminH() { const hd = h(); if (TEST_API_KEY) hd["Authorization"] = `Bearer ${TEST_API_KEY}`; return hd; }
function serviceH() { const hd = h(); if (SERVICE_KEY) hd["X-Service-Key"] = SERVICE_KEY; return hd; }

// Workflow patterns — 9 Schedule + 1 Event (production distribution)
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

function createBatch(round) {
  const v = exec.vu.idInTest;
  let created = 0;
  for (let w = 0; w < WF_PER_VU; w++) {
    const p = PATTERNS[(myWfIds.length + w) % PATTERNS.length];
    const nm = `k6-vu${v}-r${round}-w${w}`;
    const cr = http.post(`${BASE_URL}/api/workflows/create`,
      JSON.stringify({ name: nm, description: "load test", nodes: p.n, edges: p.e }), { headers: h() });
    if (cr.status === 200) {
      myWfIds.push(JSON.parse(cr.body).id);
      wfCreated.add(1);
      created++;
    }
  }
  console.log(`VU${v}: round ${round} — ${created} workflows (total: ${myWfIds.length})`);
}

function triggerAllWorkflows() {
  // Trigger each workflow using service key — same as scheduler-executor
  for (const wfId of myWfIds) {
    const r = http.post(`${BASE_URL}/api/workflow/${wfId}/execute`,
      JSON.stringify({}), { headers: serviceH() });
    if (r.status === 200 || r.status === 201) {
      triggerOk.add(1);
    } else {
      triggerFail.add(1);
    }
  }
}

function collectResults(round) {
  const v = exec.vu.idInTest;
  let s = 0, er = 0, tot = 0;
  for (const wfId of myWfIds) {
    const r = http.get(`${BASE_URL}/api/workflows/${wfId}/executions`, { headers: serviceH() });
    if (r.status !== 200) continue;
    let execs;
    try { execs = JSON.parse(r.body); } catch { continue; }
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
  console.log(`VU${v}: round ${round} — ${tot} executions, ${s} success, ${er} error (${pct}%), ${myWfIds.length} workflows`);
}

// Main — setup, then rounds of: create -> trigger on interval -> collect
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

  // Create new batch of workflows
  createBatch(round);

  // Simulate scheduler: trigger all workflows every TRIGGER_INTERVAL seconds
  // for the duration of the observation window
  const startTime = Date.now();
  let triggers = 0;

  while ((Date.now() - startTime) / 1000 < OBSERVE_SECONDS) {
    triggerAllWorkflows();
    triggers++;
    console.log(`VU${exec.vu.idInTest}: trigger cycle ${triggers} (${myWfIds.length} workflows, ${Math.round((Date.now() - startTime) / 1000)}s/${OBSERVE_SECONDS}s)`);

    // Wait for next trigger interval
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = TRIGGER_INTERVAL - ((Date.now() - startTime) / 1000 % TRIGGER_INTERVAL);
    if (elapsed + remaining < OBSERVE_SECONDS) {
      sleep(remaining > 0 ? remaining : TRIGGER_INTERVAL);
    } else {
      break;
    }
  }

  // Wait for last executions to complete
  sleep(10);

  // Collect results
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
