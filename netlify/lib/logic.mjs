// 쿠폰마을 핵심 업무 규칙: 가게 / 손님 / 쿠폰 / 예약발송 / 등급
import { db } from "./db.mjs";
import { sendMessage } from "./messaging.mjs";
import { id, fail, endOfKstDay, atKstHour, clampSendTime, distanceKm, kstParts } from "./util.mjs";

const DAY = 86400000;
export const BASE_URL = () => (process.env.URL || process.env.PUBLIC_URL || "http://localhost:8888").replace(/\/$/, "");

// ---------------- 등급 ----------------
export const GRADES = [
  { key: "new", name: "신규 주민", min: 0, emoji: "🌱" },
  { key: "regular", name: "단골 이웃", min: 2, emoji: "🏡" },
  { key: "vip", name: "동네 VIP", min: 5, emoji: "👑" },
];
export function gradeOf(visits = 0) {
  let g = GRADES[0];
  for (const x of GRADES) if (visits >= x.min) g = x;
  const next = GRADES[GRADES.indexOf(g) + 1];
  return { ...g, visits, next: next ? { name: next.name, need: next.min - visits } : null };
}

// ---------------- 골든타임 혜택 유형 ----------------
export const GOLDEN_TYPES = {
  companion: { name: "동반 고객 유도형", example: "2인 이상 재방문 시 시그니처 사이드 메뉴 무료" },
  value: { name: "가성비 체감형", example: "음료/주류 1병 무료" },
  mission: { name: "다음 방문 미션형", example: "7일 내 재방문 시 스페셜 굿즈 증정 (선착순 50명)" },
};

// ---------------- 가게 ----------------
export async function getStore(slug) {
  if (!slug) return null;
  return (await db()).get(`store/${slug}`);
}
export async function saveStore(store) {
  store.updatedAt = Date.now();
  await (await db()).set(`store/${store.slug}`, store);
  return store;
}
export async function listStores() {
  const s = await db();
  const keys = await s.list("store/");
  return (await Promise.all(keys.map((k) => s.get(k)))).filter(Boolean);
}

export function eventStatus(store, now = Date.now()) {
  const e = store.event;
  if (!e || !e.title) return { active: false, label: "진행 중인 이벤트 없음" };
  if (e.startAt && now < e.startAt) return { active: false, upcoming: true, label: "오픈 예정" };
  if (e.endAt && now > e.endAt) return { active: false, ended: true, label: "종료" };
  return { active: true, label: "진행 중", msLeft: e.endAt ? e.endAt - now : null };
}

export function publicStore(store, extra = {}) {
  const { ownerPwHash, staffPin, ...rest } = store;
  return { ...rest, eventStatus: eventStatus(store), ...extra };
}

// ---------------- 손님 ----------------
export async function getCustomer(cid) {
  if (!cid) return null;
  return (await db()).get(`cu/${cid}`);
}
export async function saveCustomer(c) {
  await (await db()).set(`cu/${c.id}`, c);
  return c;
}
export async function findOrCreateCustomer({ phone, name, kakaoId, naverId, marketing }) {
  const s = await db();
  let c = null;
  if (phone) {
    const ix = await s.get(`ph/${phone}`);
    if (ix) c = await getCustomer(ix.id);
  }
  if (!c && kakaoId) {
    const ix = await s.get(`kk/${kakaoId}`);
    if (ix) c = await getCustomer(ix.id);
  }
  if (!c && naverId) {
    const ix = await s.get(`nv/${naverId}`);
    if (ix) c = await getCustomer(ix.id);
  }
  if (!c) c = { id: id(12), createdAt: Date.now(), visits: 0, visitLog: [] };
  if (phone && !c.phone) c.phone = phone;
  if (name && !c.name) c.name = name;
  if (kakaoId) c.kakaoId = kakaoId;
  if (naverId) c.naverId = naverId;
  if (typeof marketing === "boolean") c.marketing = marketing;
  await saveCustomer(c);
  if (c.phone) await s.set(`ph/${c.phone}`, { id: c.id });
  if (c.kakaoId) await s.set(`kk/${c.kakaoId}`, { id: c.id });
  if (c.naverId) await s.set(`nv/${c.naverId}`, { id: c.id });
  return c;
}

// ---------------- 쿠폰 ----------------
export async function getCoupon(cpid) {
  const s = await db();
  const ptr = await s.get(`cp/${cpid}`);
  if (!ptr) return null;
  const c = await s.get(`sc/${ptr.store}/${cpid}`);
  if (c && c.status === "active" && c.expiresAt < Date.now()) c.status = "expired";
  return c;
}
async function saveCoupon(c) {
  const s = await db();
  await s.set(`sc/${c.storeSlug}/${c.id}`, c);
  await s.set(`cp/${c.id}`, { store: c.storeSlug });
  await s.set(`cc/${c.customerId}/${c.id}`, { store: c.storeSlug });
  return c;
}
export async function customerCoupons(cid) {
  const s = await db();
  const keys = await s.list(`cc/${cid}/`);
  const list = await Promise.all(keys.map((k) => getCoupon(k.split("/")[2])));
  return list.filter(Boolean).sort((a, b) => b.issuedAt - a.issuedAt);
}
export async function storeCoupons(slug) {
  const s = await db();
  const keys = await s.list(`sc/${slug}/`);
  const now = Date.now();
  const list = (await Promise.all(keys.map((k) => s.get(k)))).filter(Boolean);
  for (const c of list) if (c.status === "active" && c.expiresAt < now) c.status = "expired";
  return list;
}

async function enqueue(due, job) {
  const s = await db();
  const jid = id();
  await s.set(`q/${new Date(due).toISOString()}_${jid}`, { ...job, due, id: jid });
}

async function touchRelation(slug, cid, patch) {
  const s = await db();
  const key = `scu/${slug}/${cid}`;
  const r = (await s.get(key)) || { customerId: cid, firstAt: Date.now(), visits: 0, issued: 0, lastVisitAt: null };
  Object.assign(r, patch(r));
  await s.set(key, r);
  return r;
}

function couponLink(c) {
  return `${BASE_URL()}/c/${c.id}`;
}

async function issueCoupon({ store, customer, kind, title, benefit, expiresAt, sourceStore = null, extra = {} }) {
  const c = {
    id: id(10),
    storeSlug: store.slug,
    storeName: store.name,
    customerId: customer.id,
    kind,
    title,
    benefit,
    issuedAt: Date.now(),
    expiresAt,
    status: "active",
    sourceStore,
    ...extra,
  };
  await saveCoupon(c);
  await touchRelation(store.slug, customer.id, (r) => ({ issued: r.issued + 1 }));
  return c;
}

async function activeCouponOf(cid, slug, kind) {
  const list = await customerCoupons(cid);
  return list.find((c) => c.storeSlug === slug && c.kind === kind && c.status === "active");
}

// 1) 이벤트 쿠폰 발급 (랜딩페이지 "원클릭 쿠폰 받기")
export async function issueEventCoupon(store, customer) {
  const st = eventStatus(store);
  if (!st.active) fail(400, "지금은 이벤트 기간이 아니에요.");
  const mine = (await customerCoupons(customer.id)).find(
    (c) => c.storeSlug === store.slug && c.kind === "event" && c.eventId === store.event.id,
  );
  if (mine) return { coupon: mine, already: true };
  if (store.event.limit) {
    const n = (await storeCoupons(store.slug)).filter((c) => c.kind === "event" && c.eventId === store.event.id).length;
    if (n >= store.event.limit) fail(409, "선착순 수량이 모두 소진됐어요.");
  }
  const days = Number(store.event.couponDays) || 14;
  let expiresAt = endOfKstDay(Date.now(), days - 1);
  if (store.event.endAt) expiresAt = Math.min(expiresAt, endOfKstDay(store.event.endAt, 0));
  const coupon = await issueCoupon({
    store,
    customer,
    kind: "event",
    title: store.event.title,
    benefit: store.event.benefit,
    expiresAt,
    extra: { eventId: store.event.id },
  });
  // 발급 직후: 쿠폰 + 매장 위치 안내 (정보성)
  if (customer.phone) {
    const map = store.address ? `https://map.naver.com/p/search/${encodeURIComponent(store.address)}` : "";
    await sendMessage({
      to: customer.phone,
      type: "ISSUED",
      storeSlug: store.slug,
      vars: { "#{가게명}": store.name, "#{혜택}": coupon.benefit, "#{쿠폰링크}": couponLink(coupon), "#{지도}": map },
      text: `[${store.name}] ${coupon.title} 쿠폰이 발급됐어요!\n혜택: ${coupon.benefit}\n유효기간: ${fmtDate(expiresAt)}까지\n\n▶ 쿠폰 보기: ${couponLink(coupon)}${map ? `\n▶ 찾아오는 길: ${map}` : ""}`,
    });
  }
  // 만료 D-2 리마인드
  const d2 = clampSendTime(atKstHour(expiresAt - 2 * DAY, 11));
  if (d2 > Date.now()) await enqueue(d2, { type: "EVENT_D2", couponId: coupon.id, customerId: customer.id, store: store.slug });
  return { coupon, already: false };
}

export function fmtDate(ms) {
  const p = kstParts(ms - 1);
  return `${p.m + 1}월 ${p.d}일`;
}

// 2) 매장에서 사용 처리 → 리뷰 유도 + 골든타임 쿠폰 + 크로스 쿠폰 + 30일 안부 예약
export async function redeemCoupon(coupon, store) {
  if (coupon.status === "used") fail(409, "이미 사용한 쿠폰이에요.");
  if (coupon.status !== "active" || coupon.expiresAt < Date.now()) fail(410, "유효기간이 지난 쿠폰이에요.");
  const now = Date.now();
  coupon.status = "used";
  coupon.usedAt = now;
  await saveCoupon(coupon);

  const customer = await getCustomer(coupon.customerId);
  customer.visits = (customer.visits || 0) + 1;
  customer.visitLog = [{ store: store.slug, at: now }, ...(customer.visitLog || [])].slice(0, 50);
  await saveCustomer(customer);
  await touchRelation(store.slug, customer.id, (r) => ({ visits: r.visits + 1, lastVisitAt: now }));

  const result = { coupon, grade: gradeOf(customer.visits), golden: null, cross: null };
  result.review = store.naverPlaceUrl ? { url: store.naverPlaceUrl, reward: store.reviewReward || "사이드 메뉴 증정" } : null;

  // 7일 골든타임 쿠폰
  if (store.golden?.enabled && store.golden.benefit) {
    const already = await activeCouponOf(customer.id, store.slug, "golden");
    let soldOut = false;
    if (store.golden.limit) {
      const n = (await storeCoupons(store.slug)).filter((c) => c.kind === "golden").length;
      soldOut = n >= store.golden.limit;
    }
    if (!already && !soldOut) {
      const expiresAt = endOfKstDay(now, 6);
      const g = await issueCoupon({
        store,
        customer,
        kind: "golden",
        title: "7일 골든타임 쿠폰",
        benefit: store.golden.benefit,
        expiresAt,
        extra: { goldenType: store.golden.type },
      });
      result.golden = g;
      await enqueue(clampSendTime(now + 90 * 60000), { type: "GOLDEN", couponId: g.id, customerId: customer.id, store: store.slug });
      const remind = clampSendTime(atKstHour(expiresAt - 2 * DAY, 11));
      await enqueue(remind, { type: "GOLDEN_REMIND", couponId: g.id, customerId: customer.id, store: store.slug });
    }
  }

  // 동네 크로스 쿠폰 (이웃 가게 품앗이)
  const partner = await pickPartner(store);
  if (partner) {
    const already = await activeCouponOf(customer.id, partner.slug, "cross");
    if (!already) {
      const cx = await issueCoupon({
        store: partner,
        customer,
        kind: "cross",
        title: `${store.name} 손님 전용 이웃 쿠폰`,
        benefit: partner.crossOffer,
        expiresAt: endOfKstDay(now, 6),
        sourceStore: store.slug,
      });
      result.cross = { ...cx, partner: publicStore(partner) };
    }
  }

  // 30일 미방문 시 안부 + 시크릿 혜택 (그 사이 다시 오면 자동 취소)
  await enqueue(clampSendTime(atKstHour(now + 30 * DAY, 11)), {
    type: "CHURN",
    customerId: customer.id,
    store: store.slug,
    visitAt: now,
  });
  return result;
}

export async function pickPartner(store) {
  const all = (await listStores()).filter((s) => s.slug !== store.slug && s.crossOffer && !s.disabled);
  if (!all.length) return null;
  const preferred = (store.partners || []).map((p) => all.find((s) => s.slug === p)).filter(Boolean);
  if (preferred.length) return preferred[Math.floor(Math.random() * preferred.length)];
  const near = all
    .map((s) => ({ s, d: distanceKm(store, s) }))
    .filter((x) => x.d == null || x.d <= 3)
    .sort((a, b) => (a.d ?? 99) - (b.d ?? 99));
  return near[0]?.s || null;
}

// 3) 등급 히든 쿠폰 받기
export async function claimHidden(store, customer) {
  const g = gradeOf(customer.visits);
  const offers = [];
  if (store.hidden?.regular && g.min >= 2) offers.push({ level: "regular", benefit: store.hidden.regular });
  if (store.hidden?.vip && g.min >= 5) offers.push({ level: "vip", benefit: store.hidden.vip });
  if (!offers.length) fail(403, "등급이 올라가면 열리는 히든 쿠폰이에요.");
  const offer = offers[offers.length - 1];
  const recent = (await customerCoupons(customer.id)).find(
    (c) => c.storeSlug === store.slug && c.kind === "hidden" && c.issuedAt > Date.now() - 30 * DAY,
  );
  if (recent) return { coupon: recent, already: true };
  const coupon = await issueCoupon({
    store,
    customer,
    kind: "hidden",
    title: `${g.emoji} ${g.name} 히든 메뉴`,
    benefit: offer.benefit,
    expiresAt: endOfKstDay(Date.now(), 13),
  });
  return { coupon, already: false };
}

// ---------------- 예약 발송 처리 (10분마다 실행) ----------------
export async function processQueue(now = Date.now()) {
  const s = await db();
  const keys = await s.list("q/");
  const due = keys.filter((k) => new Date(k.slice(2, 26)).getTime() <= now);
  const results = [];
  for (const key of due) {
    const job = await s.get(key);
    await s.del(key);
    if (!job) continue;
    try {
      results.push(await runJob(job));
    } catch (e) {
      results.push({ job: job.type, error: String(e.message || e) });
    }
  }
  return { processed: results.length, pending: keys.length - due.length, results };
}

async function runJob(job) {
  const customer = await getCustomer(job.customerId);
  const store = await getStore(job.store);
  if (!customer || !store) return { job: job.type, skipped: "missing" };
  if (!customer.phone) return { job: job.type, skipped: "no-phone" };
  // 광고성 메시지는 마케팅 수신 동의 고객에게만
  if (!customer.marketing) return { job: job.type, skipped: "no-consent" };
  const prefix = "(광고)";
  const optout = `\n\n무료수신거부: ${BASE_URL()}/me`;

  if (job.type === "EVENT_D2" || job.type === "GOLDEN" || job.type === "GOLDEN_REMIND") {
    const c = await getCoupon(job.couponId);
    if (!c || c.status !== "active") return { job: job.type, skipped: "not-active" };
    const link = couponLink(c);
    const texts = {
      EVENT_D2: `${prefix}[${store.name}] ${c.title} 쿠폰 만료가 이틀 남았습니다!\n혜택: ${c.benefit}\n${fmtDate(c.expiresAt)}까지 꼭 사용하세요.\n▶ ${link}`,
      GOLDEN: `${prefix}[${store.name}] 오늘 방문해 주셔서 감사합니다!\n방금 드신 메뉴의 여운이 가시기 전, 7일 안에 다시 오시면 쓸 수 있는 특별한 선물을 드려요.\n🎁 ${c.benefit}\n${fmtDate(c.expiresAt)}까지\n▶ ${link}`,
      GOLDEN_REMIND: `${prefix}[${store.name}] 사장님이 쏜 7일 골든타임 쿠폰이 내일 자정에 사라져요!\n🎁 ${c.benefit}\n이번 주 외식은 어떠세요?\n▶ ${link}`,
    };
    const log = await sendMessage({
      to: customer.phone,
      type: job.type,
      storeSlug: store.slug,
      text: texts[job.type] + optout,
      vars: { "#{가게명}": store.name, "#{혜택}": c.benefit, "#{쿠폰링크}": link, "#{만료일}": fmtDate(c.expiresAt) },
    });
    return { job: job.type, sent: log.ok };
  }

  if (job.type === "CHURN") {
    const r = await (await db()).get(`scu/${store.slug}/${customer.id}`);
    if (r?.lastVisitAt && r.lastVisitAt > job.visitAt) return { job: job.type, skipped: "came-back" };
    const benefit = store.churnOffer || "방문 시 음료 1잔 서비스";
    const c = await issueCoupon({
      store,
      customer,
      kind: "secret",
      title: "보고 싶었어요! 시크릿 쿠폰",
      benefit,
      expiresAt: endOfKstDay(Date.now(), 13),
    });
    const log = await sendMessage({
      to: customer.phone,
      type: "CHURN",
      storeSlug: store.slug,
      text: `${prefix}[${store.name}] 요즘 잘 지내시죠? 한 달 동안 못 뵈어서 사장님이 시크릿 혜택을 준비했어요.\n🤫 ${benefit}\n${fmtDate(c.expiresAt)}까지\n▶ ${couponLink(c)}${optout}`,
      vars: { "#{가게명}": store.name, "#{혜택}": benefit, "#{쿠폰링크}": couponLink(c) },
    });
    return { job: job.type, sent: log.ok };
  }
  return { job: job.type, skipped: "unknown" };
}

// ---------------- 사장님 통계 ----------------
export async function storeStats(slug) {
  const s = await db();
  const coupons = await storeCoupons(slug);
  const relKeys = await s.list(`scu/${slug}/`);
  const rels = (await Promise.all(relKeys.map((k) => s.get(k)))).filter(Boolean);
  const by = (kind) => coupons.filter((c) => c.kind === kind);
  const used = (arr) => arr.filter((c) => c.status === "used").length;
  const ev = by("event");
  const gd = by("golden");
  const cx = by("cross");
  const since7 = Date.now() - 7 * DAY;
  return {
    customers: rels.length,
    regulars: rels.filter((r) => r.visits >= 2).length,
    newThisWeek: rels.filter((r) => r.firstAt > since7).length,
    event: { issued: ev.length, used: used(ev), rate: pct(used(ev), ev.length) },
    golden: { issued: gd.length, used: used(gd), rate: pct(used(gd), gd.length) },
    cross: { issued: cx.length, used: used(cx) },
    totalUsed: used(coupons),
    daily: dailySeries(coupons),
  };
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function dailySeries(coupons) {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const start = endOfKstDay(Date.now(), -i - 1);
    const end = start + DAY;
    const p = kstParts(start);
    days.push({
      label: `${p.m + 1}/${p.d}`,
      issued: coupons.filter((c) => c.issuedAt >= start && c.issuedAt < end).length,
      used: coupons.filter((c) => c.usedAt >= start && c.usedAt < end).length,
    });
  }
  return days;
}

// ---------------- 신규·단골 고객관리 ----------------
// 쿠폰만 받고 안 옴 → 신규(1회) → 단골(2회+), 30일 넘게 안 오면 이탈 위험
export const SEGMENTS = {
  waiting: { name: "방문 전", desc: "쿠폰만 받고 아직 안 온 손님", action: "방문 유도 쿠폰" },
  new: { name: "신규", desc: "1번 방문한 손님", action: "7일 안 재방문 쿠폰" },
  regular: { name: "단골", desc: "2번 이상 방문", action: "단골 감사 히든 혜택" },
  risk: { name: "이탈 위험", desc: "30일 넘게 안 온 손님", action: "보고 싶어요 쿠폰" },
};
export function segmentOf(r, now = Date.now()) {
  if (r.visits >= 1 && r.lastVisitAt && r.lastVisitAt < now - 30 * DAY) return "risk";
  if (!r.visits) return r.firstAt < now - 30 * DAY ? "risk" : "waiting";
  return r.visits >= 2 ? "regular" : "new";
}

export async function storeCustomers(slug) {
  const s = await db();
  const relKeys = await s.list(`scu/${slug}/`);
  const rels = (await Promise.all(relKeys.map((k) => s.get(k)))).filter(Boolean);
  const out = [];
  const now = Date.now();
  for (const r of rels) {
    const c = await getCustomer(r.customerId);
    if (!c) continue;
    const seg = segmentOf(r, now);
    out.push({
      ...r, name: c.name || "", phone: c.phone || "", marketing: !!c.marketing, grade: gradeOf(c.visits).name,
      segment: seg, segmentName: SEGMENTS[seg].name, action: SEGMENTS[seg].action,
      daysSince: Math.floor((now - (r.lastVisitAt || r.firstAt)) / DAY),
    });
  }
  return out.sort((a, b) => (b.lastVisitAt || b.firstAt) - (a.lastVisitAt || a.firstAt));
}

export async function crmSummary(slug) {
  const list = await storeCustomers(slug);
  const now = Date.now();
  const monthStart = endOfKstDay(now, -kstParts(now).d);
  const count = (seg) => list.filter((c) => c.segment === seg).length;
  const visited = list.filter((c) => c.visits >= 1).length;
  return {
    total: list.length,
    newThisMonth: list.filter((c) => c.firstAt >= monthStart).length,
    segments: Object.fromEntries(Object.keys(SEGMENTS).map((k) => [k, count(k)])),
    visitRate: pct(visited, list.length),
    regularRate: pct(count("regular"), visited),
    consent: list.filter((c) => c.marketing).length,
  };
}

// 사장님이 고른 손님에게 쿠폰 보내기 (수신 동의 손님만, 같은 손님에게 7일에 1번)
export async function sendCouponsTo(store, customerIds, { title, benefit, days = 14 }) {
  if (!benefit) fail(400, "쿠폰 혜택을 입력해 주세요.");
  const s = await db();
  const result = { sent: 0, skipped: 0, reasons: {} };
  const skip = (why) => { result.skipped++; result.reasons[why] = (result.reasons[why] || 0) + 1; };
  for (const cid of customerIds.slice(0, 500)) {
    const rel = await s.get(`scu/${store.slug}/${cid}`);
    const c = await getCustomer(cid);
    if (!rel || !c) { skip("우리 가게 손님 아님"); continue; }
    if (!c.marketing || !c.phone) { skip("알림 수신 미동의"); continue; }
    if (rel.lastManualAt && rel.lastManualAt > Date.now() - 7 * DAY) { skip("7일 안에 이미 보냄"); continue; }
    const coupon = await issueCoupon({
      store, customer: c, kind: "secret", title: title || "사장님이 보낸 특별 쿠폰", benefit,
      expiresAt: endOfKstDay(Date.now(), Math.max(1, Math.min(60, Number(days) || 14)) - 1),
    });
    await touchRelation(store.slug, cid, () => ({ lastManualAt: Date.now() }));
    const log = await sendMessage({
      to: c.phone, type: "MANUAL", storeSlug: store.slug,
      text: `(광고)[${store.name}] ${c.name ? c.name + "님, " : ""}사장님이 특별 쿠폰을 보냈어요!\n🎁 ${benefit}\n${fmtDate(coupon.expiresAt)}까지\n▶ ${couponLink(coupon)}\n\n무료수신거부: ${BASE_URL()}/me`,
      vars: { "#{가게명}": store.name, "#{혜택}": benefit, "#{쿠폰링크}": couponLink(coupon), "#{만료일}": fmtDate(coupon.expiresAt) },
    });
    log.ok ? result.sent++ : skip("발송 실패");
  }
  return result;
}

export async function storeMessages(slug, limit = 100) {
  const s = await db();
  const keys = (await s.list(`msglog/${slug}/`)).reverse().slice(0, limit);
  return (await Promise.all(keys.map((k) => s.get(k)))).filter(Boolean);
}

export async function storeQueue(slug) {
  const s = await db();
  const keys = await s.list("q/");
  const jobs = (await Promise.all(keys.map((k) => s.get(k)))).filter((j) => j && j.store === slug);
  return jobs;
}
