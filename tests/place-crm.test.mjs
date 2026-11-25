// 플레이스 링크 자동 입력 + 신규·단골 고객관리 테스트
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

process.env.LOCAL_DB_DIR = mkdtempSync(path.join(os.tmpdir(), "ct-"));
const { parseShareText, placeIdFrom, mapCategory, splitRegion, slugify, lookupPlace } = await import("../netlify/lib/place.mjs");
const { handle } = await import("../netlify/lib/api.mjs");

test("공유 문구·링크 읽기", () => {
  const t = parseShareText("[네이버 지도]\n핵밥 수원행궁점\n경기 수원시 팔달구 정조로 800\nhttps://naver.me/5abcDEF");
  assert.equal(t.name, "핵밥 수원행궁점");
  assert.equal(t.address, "경기 수원시 팔달구 정조로 800");
  assert.equal(t.url, "https://naver.me/5abcDEF");
  assert.equal(placeIdFrom("https://map.naver.com/p/entry/place/1234567890?c=15"), "1234567890");
  assert.equal(placeIdFrom("https://m.place.naver.com/restaurant/37683921/home"), "37683921");
  assert.deepEqual(mapCategory("음식점>육류,고기요리"), { category: "food", sub: "고기·구이" });
  assert.deepEqual(mapCategory("카페,디저트>베이커리"), { category: "cafe", sub: "디저트·베이커리" });
  assert.deepEqual(splitRegion("경기도 성남시 분당구 정자일로 1"), { sido: "경기", sigungu: "성남시" });
  assert.equal(slugify("한우리 고깃집"), "hanuri-gogitjip");
});

test("네이버 검색 API로 정보 채우기 (가짜 응답)", async () => {
  process.env.NAVER_SEARCH_ID = "x"; process.env.NAVER_SEARCH_SECRET = "y";
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /openapi\.naver\.com\/v1\/search\/local/);
    return new Response(JSON.stringify({ items: [
      { title: "<b>핵밥</b> 수원행궁점", category: "음식점>일식>덮밥", telephone: "031-111-2222", address: "경기도 수원시 팔달구 남창동 1", roadAddress: "경기도 수원시 팔달구 정조로 800", mapx: "1270139000", mapy: "372829000" },
    ] }), { status: 200 });
  };
  try {
    const p = await lookupPlace("[네이버 지도]\n핵밥 수원행궁점\n경기 수원시 팔달구 정조로 800\nhttps://m.place.naver.com/restaurant/37683921/home");
    assert.equal(p.name, "핵밥 수원행궁점");
    assert.equal(p.phone, "031-111-2222");
    assert.equal(p.sigungu, "수원시");
    assert.equal(p.category, "food");
    assert.equal(p.sub, "일식");
    assert.ok(Math.abs(p.lat - 37.2829) < 0.001 && Math.abs(p.lng - 127.0139) < 0.001);
    assert.equal(p.reviewUrl, "https://m.place.naver.com/place/37683921/review/visitor");
  } finally { globalThis.fetch = real; }
});

let jar = {};
async function call(method, p, body) {
  const r = await handle(new Request("http://x" + p, { method, headers: { "content-type": "application/json", cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") }, body: body ? JSON.stringify(body) : undefined }));
  const sc = r.headers.get("set-cookie");
  if (sc) { const [kv] = sc.split(";"); const i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

test("링크로 가입 → 바로 쿠폰 시작 → 손님 분류 → 쿠폰 보내기", async () => {
  const reg = await call("POST", "/api/owner/register", { name: "핵밥 수원행궁점", slug: "haekbap", password: "abcdef", category: "food", sigungu: "수원시", lat: 37.28, lng: 127.01 });
  assert.equal(reg.status, 200);
  const owner = { ...jar };
  // 같은 주소면 자동으로 -2
  jar = {};
  const reg2 = await call("POST", "/api/owner/register", { name: "핵밥 2호점", slug: "haekbap", password: "abcdef" });
  assert.equal(reg2.data.slug, "haekbap-2");
  // 손님 2명: A는 방문, B는 쿠폰만
  const pins = {};
  for (const [phone, visit] of [["01011112222", true], ["01033334444", false]]) {
    jar = {};
    const o = await call("POST", "/api/auth/otp", { phone });
    await call("POST", "/api/auth/verify", { phone, code: o.data.testCode, privacy: true, marketing: true, name: phone.slice(-4) });
    const c = await call("POST", "/api/stores/haekbap/coupon");
    assert.equal(c.status, 200, JSON.stringify(c.data));
    if (visit) pins.id = c.data.coupon.id;
  }
  jar = owner;
  const me = await call("GET", "/api/owner/me");
  assert.ok(me.data.store.event.benefit, "기본 쿠폰 자동 설정");
  await call("POST", `/api/coupons/${pins.id}/redeem`, {});
  const crm = await call("GET", "/api/owner/crm");
  assert.equal(crm.data.summary.total, 2);
  assert.equal(crm.data.summary.segments.new, 1);
  assert.equal(crm.data.summary.segments.waiting, 1);
  const ids = crm.data.customers.map((c) => c.customerId);
  const sent = await call("POST", "/api/owner/send-coupons", { customerIds: ids, benefit: "음료 무료", days: 7 });
  assert.equal(sent.data.sent, 2);
  const again = await call("POST", "/api/owner/send-coupons", { customerIds: ids, benefit: "음료 무료" });
  assert.equal(again.data.sent, 0);
  assert.equal(again.data.reasons["7일 안에 이미 보냄"], 2);
});
