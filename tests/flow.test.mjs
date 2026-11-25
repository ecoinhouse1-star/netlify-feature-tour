// 전체 흐름 테스트: 쿠폰 발급 → 매장 사용 → 골든타임/크로스 쿠폰 → 예약 발송
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

process.env.LOCAL_DB_DIR = mkdtempSync(path.join(os.tmpdir(), "ct-"));
const { handle } = await import("../netlify/lib/api.mjs");
const { processQueue } = await import("../netlify/lib/logic.mjs");

let jar = {};
async function call(method, p, body) {
  const cookieHdr = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const r = await handle(new Request("http://x" + p, { method, headers: { "content-type": "application/json", cookie: cookieHdr }, body: body ? JSON.stringify(body) : undefined }));
  const sc = r.headers.get("set-cookie");
  if (sc) { const [kv] = sc.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, data: ct.includes("json") ? await r.json() : await r.text() };
}

test("손님 흐름 전체", async () => {
  const list = await call("GET", "/api/stores");
  assert.equal(list.data.stores.length, 10);
  // 로그인 없이 쿠폰 받기 → 401
  assert.equal((await call("POST", "/api/stores/hanuri/coupon")).status, 401);
  const otp = await call("POST", "/api/auth/otp", { phone: "010-1234-5678" });
  assert.ok(otp.data.testCode);
  assert.equal((await call("POST", "/api/auth/verify", { phone: "01012345678", code: "000000x", privacy: true })).status, 400);
  const v = await call("POST", "/api/auth/verify", { phone: "01012345678", code: otp.data.testCode, name: "김손님", privacy: true, marketing: true });
  assert.equal(v.status, 200);
  const issued = await call("POST", "/api/stores/hanuri/coupon");
  assert.equal(issued.status, 200);
  const cid = issued.data.coupon.id;
  // 중복 발급 방지
  assert.equal((await call("POST", "/api/stores/hanuri/coupon")).data.already, true);
  // 틀린 PIN
  assert.equal((await call("POST", `/api/coupons/${cid}/redeem`, { pin: "9999" })).status, 403);
  const red = await call("POST", `/api/coupons/${cid}/redeem`, { pin: "0000" });
  assert.equal(red.status, 200, JSON.stringify(red.data));
  assert.ok(red.data.golden, "골든타임 쿠폰 발급");
  assert.ok(red.data.cross, "크로스 쿠폰 발급");
  assert.ok(red.data.review);
  assert.equal((await call("POST", `/api/coupons/${cid}/redeem`, { pin: "0000" })).status, 409);
  const me = await call("GET", "/api/me");
  assert.equal(me.data.coupons.length, 3);
  // 2시간 뒤 → 골든타임 1차 발송
  const r1 = await processQueue(Date.now() + 26 * 3600000);
  assert.ok(r1.results.some((x) => x.job === "GOLDEN" && x.sent), JSON.stringify(r1));
  // 31일 뒤 → 이벤트 D-2(이미 사용, skip), 골든 리마인드, 30일 안부
  const r2 = await processQueue(Date.now() + 32 * 86400000);
  assert.ok(r2.results.some((x) => x.job === "CHURN" && x.sent), JSON.stringify(r2));
});

test("사장님 흐름", async () => {
  jar = {};
  assert.equal((await call("POST", "/api/owner/login", { slug: "hanuri", password: "nope" })).status, 401);
  assert.equal((await call("POST", "/api/owner/login", { slug: "hanuri", password: "demo1234" })).status, 200);
  const st = await call("GET", "/api/owner/stats");
  assert.equal(st.data.stats.event.used, 1);
  const msgs = await call("GET", "/api/owner/messages");
  assert.ok(msgs.data.messages.length >= 2);
  const csv = await call("GET", "/api/owner/customers.csv");
  assert.match(csv.data, /01012345678/);
  const up = await call("PUT", "/api/owner/store", { headline: "40% 할인", staffPin: "1234" });
  assert.equal(up.data.store.headline, "40% 할인");
  const reg = await call("POST", "/api/owner/register", { slug: "new-shop", name: "새가게", password: "abcdef" });
  assert.equal(reg.status, 200);
});
