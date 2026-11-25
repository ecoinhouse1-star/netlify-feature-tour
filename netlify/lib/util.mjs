import crypto from "node:crypto";
import { db } from "./db.mjs";

export const KST_OFFSET = 9 * 3600 * 1000;

export function id(n = 10) {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

export function code6() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// 한국시간 기준 날짜 계산
export function kstParts(ms) {
  const d = new Date(ms + KST_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
export function kstTime(y, m, d, h = 0, min = 0) {
  return Date.UTC(y, m, d, h, min) - KST_OFFSET;
}
// n일 뒤 자정(그날 끝) — 오늘 포함 n일
export function endOfKstDay(ms, plusDays = 0) {
  const p = kstParts(ms);
  return kstTime(p.y, p.m, p.d + plusDays + 1, 0, 0);
}
// 특정 시각을 한국시간 해당 날짜의 h시로
export function atKstHour(ms, h) {
  const p = kstParts(ms);
  return kstTime(p.y, p.m, p.d, h, 0);
}
// 광고성 메시지는 밤 9시~아침 8시 발송 금지(정보통신망법) → 다음 영업시간으로 미룸
export function clampSendTime(ms) {
  const p = kstParts(ms);
  if (p.h >= 21 || (p.h === 20 && p.min > 50)) return kstTime(p.y, p.m, p.d + 1, 11, 0);
  if (p.h < 8) return kstTime(p.y, p.m, p.d, 11, 0);
  return ms;
}

export function normPhone(p) {
  const digits = String(p || "").replace(/\D/g, "");
  if (!/^01[016789]\d{7,8}$/.test(digits)) return null;
  return digits;
}
export function maskPhone(p) {
  if (!p) return "";
  return p.slice(0, 3) + "-****-" + p.slice(-4);
}

// ---- 비밀키 (SESSION_SECRET 없으면 자동 생성해 저장) ----
let _secret;
export async function secret() {
  if (_secret) return _secret;
  if (process.env.SESSION_SECRET) return (_secret = process.env.SESSION_SECRET);
  const s = await db();
  let v = await s.get("config/secret");
  if (!v) {
    v = { value: crypto.randomBytes(32).toString("hex") };
    await s.set("config/secret", v);
  }
  return (_secret = v.value);
}

export async function sign(payload, ttlSec = 60 * 60 * 24 * 180) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 })).toString("base64url");
  const mac = crypto.createHmac("sha256", await secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export async function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = crypto.createHmac("sha256", await secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${h}`;
}
export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(":");
  const x = crypto.scryptSync(pw, salt, 32);
  const y = Buffer.from(h, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, msg) => {
  throw new HttpError(status, msg);
};

export function cookie(req, name) {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}
export function setCookie(name, value, maxAge = 60 * 60 * 24 * 180) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
