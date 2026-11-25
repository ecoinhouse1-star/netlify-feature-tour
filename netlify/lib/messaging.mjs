// 알림톡·문자 발송
// 솔라피(SOLAPI) 키가 있으면 실제 발송, 없으면 "테스트 모드"로 기록만 남김.
//   SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER(발신번호)  → 문자(LMS) 발송
//   + SOLAPI_PFID(카카오 채널 ID), ALIMTALK_TPL_<종류>(승인된 템플릿 ID) → 알림톡 발송(실패 시 문자로 대체)
import crypto from "node:crypto";
import { db } from "./db.mjs";
import { id, maskPhone } from "./util.mjs";

export const MSG_TYPES = {
  ISSUED: "쿠폰 발급 안내",
  EVENT_D2: "만료 D-2 리마인드",
  GOLDEN: "7일 골든타임 1차",
  GOLDEN_REMIND: "골든타임 만료 전 리마인드",
  CHURN: "30일 미방문 안부",
  CROSS: "이웃가게 크로스 쿠폰",
  OTP: "인증번호",
};

export function messagingMode() {
  const e = process.env;
  if (!e.SOLAPI_API_KEY || !e.SOLAPI_API_SECRET || !e.SOLAPI_SENDER) return "test";
  return e.SOLAPI_PFID ? "alimtalk" : "sms";
}

function authHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto.createHmac("sha256", process.env.SOLAPI_API_SECRET).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${process.env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function solapiSend(message) {
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.errorMessage || `발송 실패(${res.status})`);
  return body;
}

/**
 * @param {object} p
 * @param {string} p.to 수신 번호
 * @param {string} p.type MSG_TYPES 키
 * @param {string} p.text 본문
 * @param {object} [p.vars] 알림톡 템플릿 변수 (#{가게명} 등)
 * @param {string} [p.storeSlug]
 */
export async function sendMessage({ to, type, text, vars = {}, storeSlug = null }) {
  const mode = messagingMode();
  const log = { id: id(), at: Date.now(), to: maskPhone(to), type, typeName: MSG_TYPES[type] || type, text, mode, ok: true };
  try {
    if (mode !== "test") {
      const message = { to, from: process.env.SOLAPI_SENDER, text };
      const tpl = process.env[`ALIMTALK_TPL_${type}`];
      if (mode === "alimtalk" && tpl) {
        message.type = "ATA";
        message.kakaoOptions = { pfId: process.env.SOLAPI_PFID, templateId: tpl, variables: vars, disableSms: false };
      } else {
        message.type = text.length > 45 ? "LMS" : "SMS";
        if (message.type === "LMS") message.subject = "우리동네 쿠폰마을";
      }
      log.mode = message.type === "ATA" ? "alimtalk" : "sms";
      await solapiSend(message);
    }
  } catch (e) {
    log.ok = false;
    log.error = String(e.message || e);
  }
  if (type !== "OTP") {
    const s = await db();
    await s.set(`msglog/${storeSlug || "_"}/${new Date(log.at).toISOString()}_${log.id}`, log);
  }
  return log;
}
