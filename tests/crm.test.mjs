// 고객관리 프로그램: 매장 적립 → 방문 선물 → 손님 상세 → 생일 쿠폰 → 월간 리포트
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

process.env.LOCAL_DB_DIR = mkdtempSync(path.join(os.tmpdir(), "ct-"));
const { handle } = await import("../netlify/lib/api.mjs");
const { runDailyRules } = await import("../netlify/lib/logic.mjs");
const { kstParts, kstTime } = await import("../netlify/lib/util.mjs");

let jar = {};
async function call(method, p, body) {
  const r = await handle(new Request("http://x" + p, { method, headers: { "content-type": "application/json", cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined }));
  const sc = r.headers.get("set-cookie");
  if (sc) { const [kv] = sc.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

test("고객관리 전체 흐름", async () => {
  await call("GET", "/api/stores"); // 체험 가게 생성
  assert.equal((await call("POST", "/api/owner/login", { slug: "danbi", password: "demo1234" })).status, 200);
  // 자동 규칙: 2번째 방문마다 선물, 생일 3일 전
  const rules = await call("PUT", "/api/owner/rules", { milestone: { enabled: true, every: 2, benefit: "케이크 1조각" }, birthday: { enabled: true, daysBefore: 3, benefit: "생일 라떼" } });
  assert.equal(rules.data.rules.milestone.every, 2);

  // 매장에서 전화번호로 바로 적립 (쿠폰 없이 온 손님)
  const c1 = await call("POST", "/api/owner/checkin", { phone: "010-5555-6666", name: "박단골", marketing: true, memo: "시럽 빼고" });
  assert.equal(c1.status, 200, JSON.stringify(c1.data));
  assert.equal(c1.data.visitNo, 1);
  assert.ok(c1.data.golden, "골든타임 쿠폰도 자동 발급");
  // 2시간 안 중복 적립 막기
  assert.equal((await call("POST", "/api/owner/checkin", { phone: "01055556666" })).status, 409);
  // 골든타임 쿠폰으로 재방문 → 2번째 방문 선물
  const red = await call("POST", `/api/coupons/${c1.data.golden.id}/redeem`, {});
  assert.equal(red.data.visitNo, 2);
  assert.equal(red.data.milestone.benefit, "케이크 1조각");

  // 손님 상세 카드 + 메모·생일
  const cid = c1.data.customer.id;
  const det = await call("GET", `/api/owner/customers/${cid}`);
  assert.equal(det.data.customer.visitsHere, 2);
  assert.equal(det.data.customer.memo, "시럽 빼고");
  assert.equal(det.data.customer.visits.length, 2);
  assert.equal((await call("PATCH", `/api/owner/customers/${cid}`, { birthday: "13-40" })).status, 400);
  const t = kstParts(Date.now() + 3 * 86400000);
  const bday = `${String(t.m + 1).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
  const up = await call("PATCH", `/api/owner/customers/${cid}`, { birthday: bday, tags: ["라떼파"] });
  assert.equal(up.data.customer.birthday, bday);

  // 생일 3일 전 오전 11시 → 생일 쿠폰 자동 발송 (하루 1번만)
  const n = kstParts(Date.now());
  const at11 = kstTime(n.y, n.m, n.d, 11, 0);
  const d1 = await runDailyRules(at11);
  assert.equal(d1.birthday, 1);
  assert.equal((await runDailyRules(at11)).skipped, "done");
  const after = await call("GET", `/api/owner/customers/${cid}`);
  assert.ok(after.data.customer.coupons.some((c) => c.kind === "birthday"));

  // 월간 리포트
  const rep = await call("GET", "/api/owner/report");
  const cur = rep.data.report.cur;
  assert.equal(cur.visits, 2);
  assert.equal(cur.visitors, 1);
  assert.equal(cur.revisitors, 1);
  assert.equal(cur.storeCheckins, 1);
  assert.equal(cur.newCustomers, 1);
  assert.equal(cur.top[0].name, "박단골");
});

test("광고 랜딩 → 유입 경로 기록 → 경로별 성과", async () => {
  jar = {};
  for (let i = 0; i < 3; i++) await call("POST", "/api/track", { slug: "bunsik", ch: "insta" });
  await call("POST", "/api/track", { slug: "bunsik", ch: "daangn" });
  const o = await call("POST", "/api/auth/otp", { phone: "01090901010" });
  await call("POST", "/api/auth/verify", { phone: "01090901010", code: o.data.testCode, privacy: true, marketing: true, name: "인스타손님" });
  const cp = await call("POST", "/api/stores/bunsik/coupon", { ch: "insta" });
  assert.equal(cp.data.coupon.channel, "insta");
  await call("POST", `/api/coupons/${cp.data.coupon.id}/redeem`, { pin: "0000" });
  jar = {};
  await call("POST", "/api/owner/login", { slug: "bunsik", password: "demo1234" });
  const st = await call("GET", "/api/owner/channels");
  const insta = st.data.stats.find((r) => r.key === "insta");
  assert.deepEqual([insta.views, insta.signups, insta.visits], [3, 1, 1]);
  assert.equal(st.data.stats.find((r) => r.key === "daangn").views, 1);
  const crm = await call("GET", "/api/owner/crm");
  assert.equal(crm.data.customers[0].source, "insta");
  assert.equal((await call("POST", "/api/owner/channels", { key: "banner", name: "현수막" })).status, 200);
  assert.equal((await call("POST", "/api/owner/channels", { key: "banner" })).status, 409);
});
