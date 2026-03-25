// Pure k6 execution load test.
//
// Each VU: signs up, verifies, signs in, creates N workflows,
// then fire-and-forget triggers executions as fast as possible.
// No polling — raw trigger throughput is the metric.
//
// k6 run execution-load-test.js \
//   -e BASE_URL=https://app-pr-663.keeperhub.com \
//   -e TEST_API_KEY=placeholder \
//   -e CF_ACCESS_CLIENT_ID=... -e CF_ACCESS_CLIENT_SECRET=... \
//   -e TARGET_VUS=20 -e WF_PER_VU=5 -e DURATION=60s

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TEST_API_KEY = __ENV.TEST_API_KEY || "";
const CF_ID = __ENV.CF_ACCESS_CLIENT_ID || "";
const CF_SECRET = __ENV.CF_ACCESS_CLIENT_SECRET || "";
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || "20", 10);
const WF_PER_VU = parseInt(__ENV.WF_PER_VU || "5", 10);
const DURATION = __ENV.DURATION || "60s";
const RAMP_INTERVAL = parseInt(__ENV.RAMP_INTERVAL || "5", 10);
const PASSWORD = "K6LoadTest!2024";
const SERVICE_KEY = __ENV.SERVICE_KEY || "";

// ─── Metrics ─────────────────────────────────────────────────────────

const triggerOk = new Counter("trigger_ok");
const triggerFail = new Counter("trigger_fail");
const triggerRate = new Rate("trigger_success_rate");
const triggerDuration = new Trend("trigger_duration_ms", true);

// ─── Scenario: ramp VUs gradually, then sustain ──────────────────────

const rampTime = `${TARGET_VUS * RAMP_INTERVAL}s`;

export const options = {
  scenarios: {
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: rampTime, target: TARGET_VUS },
        { duration: DURATION, target: TARGET_VUS },
      ],
      gracefulRampDown: "30s",
      gracefulStop: "60s",
    },
  },
  thresholds: {
    trigger_success_rate: [{ threshold: "rate>0.95", abortOnFail: false }],
    trigger_duration_ms: ["p(95)<2000"],
  },
};

// ─── Headers ─────────────────────────────────────────────────────────

function h() {
  const headers = {
    "Content-Type": "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
  };
  if (TEST_API_KEY) headers["X-Test-API-Key"] = TEST_API_KEY;
  if (CF_ID) headers["CF-Access-Client-Id"] = CF_ID;
  if (CF_SECRET) headers["CF-Access-Client-Secret"] = CF_SECRET;
  return headers;
}

function adminH() {
  const headers = h();
  if (TEST_API_KEY) headers["Authorization"] = `Bearer ${TEST_API_KEY}`;
  return headers;
}

// ─── Workflow templates (7 patterns) ─────────────────────────────────

function act(id, x, y) {
  return { id, type: "action", position: { x, y },
    data: { type: "action", label: id, config: {
      actionType: "HTTP Request", endpoint: `${BASE_URL}/api/health`,
      httpMethod: "GET", httpHeaders: "{}", httpBody: "{}" }}};
}
function cnd(id, x, y) {
  return { id, type: "action", position: { x, y },
    data: { type: "action", label: id, config: {
      actionType: "Condition", condition: "1 === 1" }}};
}
function trg() {
  return { id: "t", type: "trigger", position: { x: 0, y: 0 },
    data: { type: "trigger", label: "Manual", config: { triggerType: "Manual" }}};
}
function edg(id, s, t) { return { id, source: s, target: t, type: "default" }; }

const PATTERNS = [
  { n: [trg(), act("a1",200,0)], e: [edg("e1","t","a1")] },
  { n: [trg(), cnd("c1",200,0), act("a1",400,0)], e: [edg("e1","t","c1"), edg("e2","c1","a1")] },
  { n: [trg(), act("a1",200,0), cnd("c1",400,0), act("a2",600,0)],
    e: [edg("e1","t","a1"), edg("e2","a1","c1"), edg("e3","c1","a2")] },
  { n: [trg(), act("a1",200,0), act("a2",400,0), act("a3",600,0)],
    e: [edg("e1","t","a1"), edg("e2","a1","a2"), edg("e3","a2","a3")] },
  { n: [trg(), act("a1",200,-50), act("a2",200,50), act("a3",200,150), cnd("c1",400,50)],
    e: [edg("e1","t","a1"), edg("e2","t","a2"), edg("e3","t","a3"),
        edg("e4","a1","c1"), edg("e5","a2","c1"), edg("e6","a3","c1")] },
  { n: [trg(), act("a1",200,0), cnd("c1",400,0), act("a2",600,-50), act("a3",600,50)],
    e: [edg("e1","t","a1"), edg("e2","a1","c1"), edg("e3","c1","a2"), edg("e4","c1","a3")] },
  { n: [trg(), act("a1",200,-50), act("a2",200,50), cnd("c1",400,-50), cnd("c2",400,50),
        act("a3",600,-50), act("a4",600,50)],
    e: [edg("e1","t","a1"), edg("e2","t","a2"), edg("e3","a1","c1"), edg("e4","a2","c2"),
        edg("e5","c1","a3"), edg("e6","c2","a4")] },
];

// ─── Per-VU state ────────────────────────────────────────────────────

let ready = false;
let wfIds = [];
let myApiKey = "";

function retryPost(url, body, maxRetries) {
  for (let a = 1; a <= maxRetries; a++) {
    const r = http.post(url, body, { headers: h() });
    if (r.status === 200) return r;
    if (r.status === 429) { sleep(a * 5); continue; }
    return r;
  }
  return { status: 0, body: "max retries" };
}

function setupVU() {
  const vuId = exec.vu.idInTest;
  const ts = Date.now();
  const email = `k6-vu${vuId}-${ts}@techops.services`;

  // Signup
  const su = retryPost(`${BASE_URL}/api/auth/sign-up/email`,
    JSON.stringify({ email, password: PASSWORD, name: `k6-${vuId}` }), 5);
  if (su.status !== 200) { console.error(`VU${vuId}: signup ${su.status}`); return false; }

  // OTP
  sleep(1);
  let otp = null;
  for (let i = 0; i < 10; i++) {
    const r = http.get(
      `${BASE_URL}/api/admin/test/otp?email=${encodeURIComponent(email)}`,
      { headers: adminH() });
    if (r.status === 200) { otp = JSON.parse(r.body).otp; break; }
    sleep(1);
  }
  if (!otp) { console.error(`VU${vuId}: no OTP`); return false; }

  // Verify
  const vr = retryPost(`${BASE_URL}/api/auth/email-otp/verify-email`,
    JSON.stringify({ email, otp }), 5);
  if (vr.status !== 200) { console.error(`VU${vuId}: verify ${vr.status}`); return false; }

  // Signin
  const sr = retryPost(`${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: PASSWORD }), 5);
  if (sr.status !== 200) { console.error(`VU${vuId}: signin ${sr.status}`); return false; }

  // Create API key for execute calls (avoids session cookie issues)
  const akRes = http.post(`${BASE_URL}/api/api-keys`,
    JSON.stringify({ name: `k6-vu${vuId}` }), { headers: h() });
  if (akRes.status === 200) {
    myApiKey = JSON.parse(akRes.body).key || "";
  }

  // Create workflows
  for (let w = 0; w < WF_PER_VU; w++) {
    const p = PATTERNS[w % PATTERNS.length];
    const cr = http.post(`${BASE_URL}/api/workflows/create`,
      JSON.stringify({ name: `k6-vu${vuId}-w${w}`, description: "load", nodes: p.n, edges: p.e }),
      { headers: h() });
    if (cr.status === 200) {
      const wf = JSON.parse(cr.body);
      http.put(`${BASE_URL}/api/workflows/${wf.id}/go-live`,
        JSON.stringify({ name: `k6-vu${vuId}-w${w}` }), { headers: h() });
      wfIds.push(wf.id);
    }
  }

  console.log(`VU${vuId}: ready (${wfIds.length} workflows)`);
  return true;
}

// ─── Main: fire triggers ─────────────────────────────────────────────

export default function () {
  if (!ready) {
    ready = setupVU();
    if (!ready) { sleep(10); return; }
  }

  if (wfIds.length === 0) { sleep(1); return; }

  // Pick random workflow, fire execution using internal service key
  const wfId = wfIds[Math.floor(Math.random() * wfIds.length)];

  const execHeaders = h();
  if (SERVICE_KEY) {
    execHeaders["X-Service-Key"] = SERVICE_KEY;
  }

  const t0 = Date.now();
  const tr = http.post(`${BASE_URL}/api/workflow/${wfId}/execute`,
    JSON.stringify({}), { headers: execHeaders });
  const dur = Date.now() - t0;

  const ok = check(tr, {
    "trigger 200": (r) => r.status === 200 || r.status === 201,
  });

  if (ok) {
    triggerOk.add(1);
    triggerRate.add(true);
    triggerDuration.add(dur);
  } else {
    triggerFail.add(1);
    triggerRate.add(false);
  }

  // Small pause to avoid hammering the same workflow before execution completes
  sleep(0.5);
}

// ─── Teardown ────────────────────────────────────────────────────────

export function teardown() {
  console.log("Cleaning up...");
  const r = http.post(`${BASE_URL}/api/admin/test/cleanup`,
    JSON.stringify({}), { headers: adminH() });
  if (r.status === 200) {
    const d = JSON.parse(r.body).deleted;
    console.log(`Cleaned: ${d.users} users, ${d.organizations} orgs, ${d.workflows} workflows`);
  } else {
    console.error(`Cleanup failed: ${r.status}`);
  }
}
