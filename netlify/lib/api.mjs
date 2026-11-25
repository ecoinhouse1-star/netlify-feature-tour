// /api/* 요청 처리 (Netlify Function과 내 컴퓨터 개발 서버가 같이 사용)
import crypto from "node:crypto";
import { db } from "./db.mjs";
import {
  json, fail, HttpError, cookie, setCookie, sign, verify, normPhone, maskPhone, code6,
  hashPassword, checkPassword, distanceKm, id, endOfKstDay,
} from "./util.mjs";
import { sendMessage, messagingMode } from "./messaging.mjs";
import {
  getStore, saveStore, listStores, publicStore, eventStatus, getCustomer, saveCustomer, findOrCreateCustomer,
  getCoupon, customerCoupons, storeCoupons, issueEventCoupon, redeemCoupon, claimHidden, gradeOf, GRADES,
  GOLDEN_TYPES, processQueue, storeStats, storeCustomers, crmSummary, sendCouponsTo, SEGMENTS,
  getRules, checkinCustomer, customerDetail, updateCustomerNote, monthlyReport,
  trackView, channelStats, storeChannels, normChannel, storeMessages, storeQueue, BASE_URL,
} from "./logic.mjs";
import { seedIfEmpty } from "./seed.mjs";
import { lookupPlace, defaultOffers } from "./place.mjs";

const DAY = 86400000;
const C_COOKIE = "ct_c";
const O_COOKIE = "ct_o";

async function body(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
async function currentCustomer(req) {
  const p = await verify(cookie(req, C_COOKIE));
  return p?.cid ? getCustomer(p.cid) : null;
}
async function needCustomer(req) {
  const c = await currentCustomer(req);
  if (!c) fail(401, "로그인이 필요해요.");
  return c;
}
async function currentOwner(req) {
  const p = await verify(cookie(req, O_COOKIE));
  return p?.slug ? getStore(p.slug) : null;
}
async function needOwner(req) {
  const s = await currentOwner(req);
  if (!s) fail(401, "사장님 로그인이 필요해요.");
  return s;
}
async function customerSession(c) {
  return setCookie(C_COOKIE, await sign({ cid: c.id }));
}
function redirect(to, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: to, ...headers } });
}
const safeReturn = (r) => (typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/");

const CATEGORIES = [
  { key: "food", name: "음식점", emoji: "🍽️", subs: ["고기·구이", "한식·분식", "양식·피자·버거", "일식", "회·해물", "중식·아시아"] },
  { key: "cafe", name: "카페", emoji: "☕", subs: ["커피", "디저트·베이커리"] },
  { key: "beauty", name: "뷰티", emoji: "✂️", subs: ["헤어", "네일", "피부·왁싱"] },
  { key: "fitness", name: "운동", emoji: "🏋️", subs: ["헬스·PT", "필라테스·요가", "골프"] },
  { key: "activity", name: "액티비티", emoji: "🎟️", subs: ["공간·스튜디오", "오락·게임", "체험·야외"] },
  { key: "stay", name: "숙박", emoji: "🛏️", subs: ["호텔·모텔", "펜션·캠핑"] },
  { key: "pet", name: "반려동물", emoji: "🐶", subs: ["미용·호텔", "용품·간식"] },
  { key: "life", name: "생활", emoji: "👕", subs: ["세탁·수선", "꽃·선물", "기타"] },
];

function cardOf(store, here, issuedCount = 0) {
  const st = eventStatus(store);
  return {
    slug: store.slug, name: store.name, category: store.category, sub: store.sub, region: store.region, sido: store.sido, sigungu: store.sigungu,
    photo: store.photos?.[0] || store.menu?.find((m) => m.photo)?.photo || null, headline: store.headline || store.event?.benefit || "", headlineSub: store.headlineSub || "",
    tags: store.tags || [], demo: !!store.demo, eventStatus: st, endAt: store.event?.endAt || null,
    golden: !!store.golden?.enabled, distance: distanceKm(here, store), popular: issuedCount,
  };
}

// ---------------- 라우터 ----------------
const routes = [];
const on = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, re, keys, fn });
};

on("GET", "/api/config", async () =>
  json({
    kakao: !!process.env.KAKAO_REST_KEY,
    naver: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
    messaging: messagingMode(),
    categories: CATEGORIES,
    grades: GRADES,
    goldenTypes: GOLDEN_TYPES,
    joinCodeRequired: !!process.env.JOIN_CODE,
  }),
);

// ---- 포털 피드 ----
on("GET", "/api/stores", async (req, url) => {
  await seedIfEmpty();
  const lat = parseFloat(url.searchParams.get("lat"));
  const lng = parseFloat(url.searchParams.get("lng"));
  const here = isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
  const s = await db();
  const stores = (await listStores()).filter((x) => !x.disabled);
  const cards = await Promise.all(
    stores.map(async (st) => cardOf(st, here, (await s.list(`sc/${st.slug}/`)).length)),
  );
  return json({ stores: cards });
});

on("GET", "/api/stores/:slug", async (req, url, { slug }) => {
  const store = await getStore(slug);
  if (!store || store.disabled) fail(404, "가게를 찾을 수 없어요.");
  const me = await currentCustomer(req);
  let mine = null;
  if (me) {
    const list = (await customerCoupons(me.id)).filter((c) => c.storeSlug === slug);
    const g = gradeOf(me.visits);
    mine = {
      grade: g,
      active: list.filter((c) => c.status === "active"),
      eventCoupon: list.find((c) => c.kind === "event" && c.eventId === store.event?.id) || null,
      hiddenOpen: (!!store.hidden?.regular && g.min >= 2) || (!!store.hidden?.vip && g.min >= 5),
    };
  }
  const others = (await listStores())
    .filter((x) => x.slug !== slug && !x.disabled)
    .map((x) => ({ x, d: distanceKm(store, x) }))
    .sort((a, b) => (a.d ?? 99) - (b.d ?? 99))
    .slice(0, 4)
    .map(({ x }) => cardOf(x, store));
  const hiddenInfo = { regular: !!store.hidden?.regular, vip: !!store.hidden?.vip };
  let eventRemaining = null;
  if (store.event?.limit) {
    const n = (await storeCoupons(slug)).filter((c) => c.kind === "event" && c.eventId === store.event.id).length;
    eventRemaining = Math.max(0, store.event.limit - n);
  }
  const { hidden, ...pub } = publicStore(store);
  return json({ store: { ...pub, hiddenInfo, eventRemaining }, mine, similar: others, loggedIn: !!me });
});

on("POST", "/api/stores/:slug/coupon", async (req, url, { slug }) => {
  const c = await needCustomer(req);
  const store = await getStore(slug);
  if (!store) fail(404, "가게를 찾을 수 없어요.");
  const b = await body(req);
  return json(await issueEventCoupon(store, c, normChannel(b.ch)));
});

on("POST", "/api/stores/:slug/hidden", async (req, url, { slug }) => {
  const c = await needCustomer(req);
  const store = await getStore(slug);
  if (!store) fail(404, "가게를 찾을 수 없어요.");
  return json(await claimHidden(store, c));
});

// ---- 쿠폰 ----
on("GET", "/api/coupons/:cid", async (req, url, { cid }) => {
  const c = await getCoupon(cid);
  if (!c) fail(404, "쿠폰을 찾을 수 없어요.");
  const store = await getStore(c.storeSlug);
  const me = await currentCustomer(req);
  return json({ coupon: c, store: store && publicStore(store), mine: me?.id === c.customerId });
});

on("POST", "/api/coupons/:cid/redeem", async (req, url, { cid }) => {
  const { pin } = await body(req);
  const c = await getCoupon(cid);
  if (!c) fail(404, "쿠폰을 찾을 수 없어요.");
  const store = await getStore(c.storeSlug);
  const owner = await currentOwner(req);
  const okOwner = owner && owner.slug === store.slug;
  if (!okOwner) {
    const s = await db();
    const lockKey = `pinlock/${store.slug}`;
    const lock = (await s.get(lockKey)) || { fails: 0, until: 0 };
    if (lock.until > Date.now()) fail(429, "비밀번호를 여러 번 틀렸어요. 10분 뒤 다시 시도해 주세요.");
    if (String(pin || "") !== String(store.staffPin)) {
      lock.fails += 1;
      if (lock.fails >= 5) Object.assign(lock, { fails: 0, until: Date.now() + 10 * 60000 });
      await s.set(lockKey, lock);
      fail(403, "직원 확인 번호가 맞지 않아요.");
    }
  }
  return json(await redeemCoupon(c, store));
});

// ---- 손님 로그인: 휴대폰 인증 ----
on("POST", "/api/auth/otp", async (req) => {
  const { phone } = await body(req);
  const p = normPhone(phone);
  if (!p) fail(400, "휴대폰 번호를 확인해 주세요.");
  const s = await db();
  const prev = await s.get(`otp/${p}`);
  if (prev && prev.sentAt > Date.now() - 30000) fail(429, "30초 후에 다시 요청해 주세요.");
  const code = code6();
  await s.set(`otp/${p}`, { hash: crypto.createHash("sha256").update(code).digest("hex"), exp: Date.now() + 5 * 60000, tries: 0, sentAt: Date.now() });
  const mode = messagingMode();
  if (mode !== "test") {
    const log = await sendMessage({ to: p, type: "OTP", text: `[우리동네 쿠폰마을] 인증번호 [${code}]` });
    if (!log.ok) fail(502, "인증번호 발송에 실패했어요. 잠시 후 다시 시도해 주세요.");
    return json({ sent: true });
  }
  // 문자 연동 전(테스트 모드)에는 화면에 인증번호를 보여줌
  return json({ sent: true, testCode: code });
});

on("POST", "/api/auth/verify", async (req) => {
  const { phone, code, name, marketing, privacy } = await body(req);
  const p = normPhone(phone);
  if (!p) fail(400, "휴대폰 번호를 확인해 주세요.");
  if (!privacy) fail(400, "개인정보 수집·이용에 동의해 주세요.");
  const s = await db();
  const o = await s.get(`otp/${p}`);
  if (!o || o.exp < Date.now()) fail(400, "인증번호가 만료됐어요. 다시 받아 주세요.");
  if (o.tries >= 5) fail(429, "인증 시도가 너무 많아요. 새 인증번호를 받아 주세요.");
  if (crypto.createHash("sha256").update(String(code || "")).digest("hex") !== o.hash) {
    o.tries += 1;
    await s.set(`otp/${p}`, o);
    fail(400, "인증번호가 맞지 않아요.");
  }
  await s.del(`otp/${p}`);
  // 이미 소셜로그인 상태라면 그 계정에 번호를 연결
  const cur = await currentCustomer(req);
  let c;
  if (cur && !cur.phone) {
    const owner = await s.get(`ph/${p}`);
    if (owner && owner.id !== cur.id) {
      c = await getCustomer(owner.id);
      if (cur.kakaoId) c.kakaoId = cur.kakaoId;
      if (cur.naverId) c.naverId = cur.naverId;
      await findOrCreateCustomer({ ...c, marketing: !!marketing });
    } else {
      cur.phone = p;
      c = await findOrCreateCustomer({ ...cur, phone: p, name: name || cur.name, marketing: !!marketing });
    }
  } else {
    c = await findOrCreateCustomer({ phone: p, name: (name || "").slice(0, 20), marketing: !!marketing });
  }
  c.privacyAt = c.privacyAt || Date.now();
  if (typeof marketing === "boolean") c.marketing = marketing;
  await saveCustomer(c);
  return json({ ok: true, customer: meView(c) }, 200, { "set-cookie": await customerSession(c) });
});

on("POST", "/api/auth/logout", async () =>
  json({ ok: true }, 200, { "set-cookie": setCookie(C_COOKIE, "", 0) }),
);

// ---- 카카오 / 네이버 간편 로그인 ----
on("GET", "/api/auth/kakao", async (req, url) => {
  if (!process.env.KAKAO_REST_KEY) fail(400, "카카오 로그인이 아직 설정되지 않았어요.");
  const state = await sign({ r: safeReturn(url.searchParams.get("return")) }, 600);
  const q = new URLSearchParams({
    client_id: process.env.KAKAO_REST_KEY,
    redirect_uri: `${BASE_URL()}/api/auth/kakao/callback`,
    response_type: "code",
    state,
  });
  return redirect(`https://kauth.kakao.com/oauth/authorize?${q}`);
});
on("GET", "/api/auth/kakao/callback", async (req, url) => {
  const st = await verify(url.searchParams.get("state"));
  if (!st) fail(400, "로그인 요청이 만료됐어요.");
  const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.KAKAO_REST_KEY,
      ...(process.env.KAKAO_CLIENT_SECRET ? { client_secret: process.env.KAKAO_CLIENT_SECRET } : {}),
      redirect_uri: `${BASE_URL()}/api/auth/kakao/callback`,
      code: url.searchParams.get("code") || "",
    }),
  });
  const tok = await tokenRes.json();
  if (!tok.access_token) fail(400, "카카오 로그인에 실패했어요.");
  const me = await (await fetch("https://kapi.kakao.com/v2/user/me", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  const acc = me.kakao_account || {};
  const phone = acc.phone_number ? normPhone(acc.phone_number.replace(/^\+82\s?/, "0")) : null;
  const c = await findOrCreateCustomer({ kakaoId: String(me.id), phone, name: acc.name || acc.profile?.nickname });
  return redirect(st.r + (st.r.includes("?") ? "&" : "?") + "login=1", { "set-cookie": await customerSession(c) });
});

on("GET", "/api/auth/naver", async (req, url) => {
  if (!process.env.NAVER_CLIENT_ID) fail(400, "네이버 로그인이 아직 설정되지 않았어요.");
  const state = await sign({ r: safeReturn(url.searchParams.get("return")) }, 600);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: process.env.NAVER_CLIENT_ID,
    redirect_uri: `${BASE_URL()}/api/auth/naver/callback`,
    state,
  });
  return redirect(`https://nid.naver.com/oauth2.0/authorize?${q}`);
});
on("GET", "/api/auth/naver/callback", async (req, url) => {
  const stRaw = url.searchParams.get("state");
  const st = await verify(stRaw);
  if (!st) fail(400, "로그인 요청이 만료됐어요.");
  const q = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.NAVER_CLIENT_ID,
    client_secret: process.env.NAVER_CLIENT_SECRET,
    code: url.searchParams.get("code") || "",
    state: stRaw,
  });
  const tok = await (await fetch(`https://nid.naver.com/oauth2.0/token?${q}`)).json();
  if (!tok.access_token) fail(400, "네이버 로그인에 실패했어요.");
  const me = await (await fetch("https://openapi.naver.com/v1/nid/me", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  const r = me.response || {};
  const phone = r.mobile ? normPhone(r.mobile) : null;
  const c = await findOrCreateCustomer({ naverId: String(r.id), phone, name: r.name || r.nickname });
  return redirect(st.r + (st.r.includes("?") ? "&" : "?") + "login=1", { "set-cookie": await customerSession(c) });
});

// ---- 마이페이지 ----
function meView(c) {
  return { id: c.id, name: c.name || "", birthday: c.birthday || "", phone: maskPhone(c.phone), hasPhone: !!c.phone, marketing: !!c.marketing, grade: gradeOf(c.visits), kakao: !!c.kakaoId, naver: !!c.naverId };
}
on("GET", "/api/me", async (req) => {
  const c = await currentCustomer(req);
  if (!c) return json({ customer: null });
  return json({ customer: meView(c), coupons: await customerCoupons(c.id) });
});
on("PATCH", "/api/me", async (req) => {
  const c = await needCustomer(req);
  const b = await body(req);
  if (typeof b.marketing === "boolean") c.marketing = b.marketing;
  if (typeof b.name === "string") c.name = b.name.slice(0, 20);
  if (typeof b.birthday === "string") {
    if (b.birthday && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(b.birthday)) fail(400, "생일은 월-일(예: 03-15)로 입력해 주세요.");
    c.birthday = b.birthday;
  }
  await saveCustomer(c);
  return json({ customer: meView(c) });
});

// ---- 사장님 ----
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
// ---- 네이버 플레이스 링크 → 가게 정보 ----
async function rateLimit(req, key, max, windowMs) {
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const s = await db();
  const k = `rl/${key}/${ip}`;
  const r = (await s.get(k)) || { n: 0, t: Date.now() };
  if (Date.now() - r.t > windowMs) Object.assign(r, { n: 0, t: Date.now() });
  r.n += 1;
  await s.set(k, r);
  if (r.n > max) fail(429, "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.");
}
on("POST", "/api/place/lookup", async (req) => {
  await rateLimit(req, "place", 20, 60000);
  const b = await body(req);
  const info = await lookupPlace(b.input || "", { name: b.name, address: b.address });
  return json({ place: info, offers: defaultOffers(info.category) });
});

on("POST", "/api/owner/register", async (req) => {
  const b = await body(req);
  if (process.env.JOIN_CODE && b.joinCode !== process.env.JOIN_CODE) fail(403, "가입 코드가 맞지 않아요. 담당 영업사원에게 문의해 주세요.");
  let slug = String(b.slug || "").toLowerCase().trim();
  if (!SLUG_RE.test(slug)) fail(400, "가게 주소(영문 소문자·숫자·-, 3~30자)를 확인해 주세요.");
  if (await getStore(slug)) {
    // 이름이 겹치면 자동으로 뒤에 숫자를 붙임
    let alt = null;
    for (let i = 2; i < 30 && !alt; i++) if (!(await getStore(`${slug.slice(0, 26)}-${i}`))) alt = `${slug.slice(0, 26)}-${i}`;
    if (!alt) fail(409, "이미 사용 중인 가게 주소예요.");
    slug = alt;
  }
  if (!b.name || String(b.name).length < 2) fail(400, "가게 이름을 입력해 주세요.");
  if (!b.password || String(b.password).length < 6) fail(400, "비밀번호는 6자 이상으로 해 주세요.");
  const now = Date.now();
  const category = b.category || "food";
  const o = defaultOffers(category);
  const lat = Number(b.lat), lng = Number(b.lng);
  const sido = b.sido || "경기";
  const store = {
    slug, name: String(b.name).slice(0, 40), category, sub: b.sub || "",
    sido, sigungu: b.sigungu || "", region: [sido, b.sigungu].filter(Boolean).join(" "),
    address: b.address || "", phone: b.phone || "", lat: isFinite(lat) && lat ? lat : null, lng: isFinite(lng) && lng ? lng : null,
    photos: [], tags: ["예약불필요", "골든타임"], intro: "", menu: [],
    headline: o.event.replace(/^첫 방문 감사:\s*/, ""), headlineSub: "첫 방문 쿠폰", note: "", reservation: "예약 불필요",
    ownerPwHash: hashPassword(String(b.password)), staffPin: String(Math.floor(1000 + Math.random() * 9000)),
    event: { id: id(6), title: "첫 방문 감사 쿠폰", benefit: o.event, startAt: now, endAt: endOfKstDay(now, 29), couponDays: 14 },
    golden: { enabled: true, type: o.golden_type, benefit: o.golden },
    crossOffer: o.cross, churnOffer: o.churn, hidden: {}, keywords: [b.sigungu && `${b.sigungu.replace(/시$|군$/, "")} 맛집`].filter(Boolean), partners: [],
    placeId: b.placeId || null, placeUrl: b.placeUrl || "", naverPlaceUrl: b.reviewUrl || b.placeUrl || "", reviewReward: "사이드 메뉴 증정",
    createdAt: now,
  };
  await saveStore(store);
  return json({ ok: true, slug }, 200, { "set-cookie": setCookie(O_COOKIE, await sign({ slug }, 60 * 60 * 24 * 30)) });
});
on("POST", "/api/owner/login", async (req) => {
  const { slug, password } = await body(req);
  const store = await getStore(String(slug || "").toLowerCase().trim());
  if (!store || !checkPassword(String(password || ""), store.ownerPwHash)) fail(401, "가게 주소 또는 비밀번호가 맞지 않아요.");
  return json({ ok: true }, 200, { "set-cookie": setCookie(O_COOKIE, await sign({ slug: store.slug }, 60 * 60 * 24 * 30)) });
});
on("POST", "/api/owner/logout", async () => json({ ok: true }, 200, { "set-cookie": setCookie(O_COOKIE, "", 0) }));

on("GET", "/api/owner/me", async (req) => {
  const s = await needOwner(req);
  const { ownerPwHash, ...rest } = s;
  return json({ store: rest, link: `${BASE_URL()}/s/${s.slug}`, messaging: messagingMode() });
});

const EDITABLE = ["name", "category", "sub", "sido", "sigungu", "region", "address", "phone", "lat", "lng", "intro", "menu", "headline", "headlineSub", "note",
  "tags", "reservation", "placeId", "placeUrl", "crossOffer", "churnOffer", "hidden", "keywords", "partners", "naverPlaceUrl", "reviewReward", "photos", "notices"];
on("PUT", "/api/owner/store", async (req) => {
  const s = await needOwner(req);
  const b = await body(req);
  for (const k of EDITABLE) if (k in b) s[k] = b[k];
  if ("sido" in b || "sigungu" in b) s.region = [s.sido, s.sigungu].filter(Boolean).join(" ");
  if (b.staffPin) {
    if (!/^\d{4}$/.test(String(b.staffPin))) fail(400, "직원 확인 번호는 숫자 4자리예요.");
    s.staffPin = String(b.staffPin);
  }
  if (b.golden) s.golden = { ...s.golden, ...b.golden, limit: b.golden.limit ? Number(b.golden.limit) : null };
  if (b.event) {
    const e = b.event;
    const changed = e.title !== s.event?.title || e.benefit !== s.event?.benefit;
    s.event = {
      ...s.event, ...e,
      id: changed || !s.event?.id ? id(6) : s.event.id,
      startAt: e.startAt ? Number(e.startAt) : s.event?.startAt,
      endAt: e.endAt ? Number(e.endAt) : s.event?.endAt,
      couponDays: Number(e.couponDays) || 14,
      limit: e.limit ? Number(e.limit) : null,
    };
  }
  if (b.newPassword) {
    if (String(b.newPassword).length < 6) fail(400, "비밀번호는 6자 이상으로 해 주세요.");
    s.ownerPwHash = hashPassword(String(b.newPassword));
  }
  await saveStore(s);
  const { ownerPwHash, ...rest } = s;
  return json({ store: rest });
});

on("POST", "/api/owner/photo", async (req) => {
  const s = await needOwner(req);
  const { dataUrl } = await body(req);
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(dataUrl || "");
  if (!m) fail(400, "사진 형식을 확인해 주세요.");
  if (m[3].length > 1_400_000) fail(413, "사진이 너무 커요.");
  const pid = id(8);
  await (await db()).set(`img/${s.slug}/${pid}`, { type: m[1], data: m[3] });
  return json({ url: `/api/img/${s.slug}/${pid}` });
});
on("GET", "/api/img/:slug/:pid", async (req, url, { slug, pid }) => {
  const img = await (await db()).get(`img/${slug}/${pid}`);
  if (!img) return new Response("not found", { status: 404 });
  return new Response(Buffer.from(img.data, "base64"), {
    headers: { "content-type": img.type, "cache-control": "public, max-age=31536000, immutable" },
  });
});

on("GET", "/api/owner/stats", async (req) => {
  const s = await needOwner(req);
  return json({ stats: await storeStats(s.slug), queue: (await storeQueue(s.slug)).length });
});
on("GET", "/api/owner/customers", async (req) => {
  const s = await needOwner(req);
  const list = await storeCustomers(s.slug);
  return json({ customers: list.map((c) => ({ ...c, phone: maskPhone(c.phone) })) });
});
on("GET", "/api/owner/crm", async (req) => {
  const s = await needOwner(req);
  const list = await storeCustomers(s.slug);
  return json({ summary: await crmSummary(s.slug), segments: SEGMENTS, customers: list.map((c) => ({ ...c, phone: maskPhone(c.phone) })) });
});
on("POST", "/api/owner/send-coupons", async (req) => {
  const s = await needOwner(req);
  const b = await body(req);
  if (!Array.isArray(b.customerIds) || !b.customerIds.length) fail(400, "쿠폰을 보낼 손님을 골라주세요.");
  return json(await sendCouponsTo(s, b.customerIds, b));
});
// ---- 고객관리: 매장 적립 / 손님 상세 / 자동 규칙 / 월간 리포트 ----
on("POST", "/api/owner/checkin", async (req) => {
  const s = await needOwner(req);
  return json(await checkinCustomer(s, await body(req)));
});
on("GET", "/api/owner/customers/:cid", async (req, url, { cid }) => {
  const s = await needOwner(req);
  return json({ customer: await customerDetail(s, cid) });
});
on("PATCH", "/api/owner/customers/:cid", async (req, url, { cid }) => {
  const s = await needOwner(req);
  await updateCustomerNote(s, cid, await body(req));
  return json({ customer: await customerDetail(s, cid) });
});
on("GET", "/api/owner/rules", async (req) => {
  const s = await needOwner(req);
  return json({ rules: getRules(s) });
});
on("PUT", "/api/owner/rules", async (req) => {
  const s = await needOwner(req);
  const b = await body(req);
  const cur = getRules(s);
  const clean = (x, d) => ({
    enabled: typeof x?.enabled === "boolean" ? x.enabled : d.enabled,
    benefit: typeof x?.benefit === "string" ? x.benefit.slice(0, 60) : d.benefit,
    ...(d.every != null ? { every: Math.min(50, Math.max(2, Number(x?.every) || d.every)) } : {}),
    ...(d.daysBefore != null ? { daysBefore: Math.min(14, Math.max(0, Number(x?.daysBefore ?? d.daysBefore))) } : {}),
    ...(d.days != null ? { days: Math.min(180, Math.max(7, Number(x?.days) || d.days)) } : {}),
  });
  s.rules = { milestone: clean(b.milestone, cur.milestone), birthday: clean(b.birthday, cur.birthday), winback: clean(b.winback, cur.winback) };
  await saveStore(s);
  return json({ rules: getRules(s) });
});
on("GET", "/api/owner/report", async (req, url) => {
  const s = await needOwner(req);
  const now = new Date(Date.now() + 9 * 3600000);
  const ym = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : now.toISOString().slice(0, 7);
  return json({ report: await monthlyReport(s.slug, ym), store: { name: s.name, region: s.region } });
});
// ---- 광고 랜딩 유입 경로 ----
on("POST", "/api/track", async (req) => {
  await rateLimit(req, "track", 60, 60000);
  const b = await body(req);
  const store = await getStore(String(b.slug || ""));
  if (store) await trackView(store.slug, b.ch);
  return json({ ok: true });
});
on("GET", "/api/owner/channels", async (req, url) => {
  const s = await needOwner(req);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
  return json({ channels: storeChannels(s), stats: await channelStats(s, days), base: `${BASE_URL()}/e/${s.slug}` });
});
on("POST", "/api/owner/channels", async (req) => {
  const s = await needOwner(req);
  const b = await body(req);
  const key = normChannel(b.key);
  if (!key) fail(400, "경로 이름은 영문·숫자·한글 20자 이내로 해 주세요.");
  if (storeChannels(s).some((c) => c.key === key)) fail(409, "이미 있는 경로예요.");
  s.channels = [...(s.channels || []), { key, name: String(b.name || key).slice(0, 20) }].slice(0, 20);
  await saveStore(s);
  return json({ channels: storeChannels(s) });
});
on("GET", "/api/owner/customers.csv", async (req) => {
  const s = await needOwner(req);
  const list = (await storeCustomers(s.slug)).filter((c) => c.marketing);
  const fmt = (ms) => (ms ? new Date(ms + 9 * 3600000).toISOString().slice(0, 10) : "");
  const rows = [["이름", "휴대폰", "등급", "분류", "방문수", "유입경로", "첫방문", "최근방문"]].concat(
    list.map((c) => [c.name, c.phone, c.grade, c.segmentName, c.visits, c.source || "", fmt(c.firstAt), fmt(c.lastVisitAt)]),
  );
  const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="customers-${s.slug}.csv"` },
  });
});
on("GET", "/api/owner/messages", async (req) => {
  const s = await needOwner(req);
  return json({ messages: await storeMessages(s.slug), queue: await storeQueue(s.slug) });
});
on("GET", "/api/owner/coupons", async (req) => {
  const s = await needOwner(req);
  const list = (await storeCoupons(s.slug)).sort((a, b) => b.issuedAt - a.issuedAt).slice(0, 200);
  return json({ coupons: list });
});

// 예약발송 수동 실행 (자동은 scheduler 함수가 10분마다 실행)
on("POST", "/api/cron", async (req) => {
  const key = req.headers.get("x-cron-key");
  if (!process.env.CRON_KEY || key !== process.env.CRON_KEY) fail(403, "forbidden");
  return json(await processQueue());
});

export async function handle(req) {
  const url = new URL(req.url);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      return await r.fn(req, url, params);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요." }, 500);
    }
  }
  return json({ error: "not found" }, 404);
}
