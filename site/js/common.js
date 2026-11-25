// 공통 도우미: 서버 호출, 아이콘, 카드, 하단탭, 로그인 시트
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || "오류가 발생했어요.");
    e.status = res.status;
    throw e;
  }
  return data;
}

let _config;
export async function config() {
  return (_config ||= await api("/api/config"));
}

export const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M20 12H4M11 5l-7 7 7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.8 4.5 7.2 4.5c2 0 3.5 1.1 4.8 2.8 1.3-1.7 2.8-2.8 4.8-2.8 3.4 0 5.6 3.3 4.4 6.7-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg>',
  pinLine: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-7-6.5-11.5a6.5 6.5 0 0113 0C18.5 14 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M4 12h16"/><circle cx="16" cy="7" r="1.8"/><circle cx="10" cy="17" r="1.8"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" style="width:22px;height:22px;stroke:#6b6b70;fill:none;stroke-width:1.8"><rect x="3" y="5" width="16" height="15" rx="2"/><path d="M3 10h16M8 3v4M14 3v4"/><circle cx="17.5" cy="17.5" r="3.5" fill="#fff"/><path d="M17.5 16v1.6l1 .8"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M12 3l9 7.5V20a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1v-9.5z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2.5"/><rect x="13" y="3" width="8" height="8" rx="2.5"/><rect x="3" y="13" width="8" height="8" rx="2.5"/><rect x="13" y="13" width="8" height="8" rx="2.5"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-4.9-9.8-10C1 7.4 3.4 4 7 4c2.1 0 3.7 1.1 5 2.9C13.3 5.1 14.9 4 17 4c3.6 0 6 3.4 4.8 7-1.8 5.1-9.8 10-9.8 10z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7.5" r="4.5"/><path d="M3 21c0-4.4 4-7.5 9-7.5s9 3.1 9 7.5z"/></svg>',
};

export function tabbar(active) {
  const items = [
    ["home", "/", "홈", ICON.home],
    ["cat", "/category.html", "카테고리", ICON.grid],
    ["like", "/likes.html", "관심목록", ICON.heartFill],
    ["me", "/me", "마이페이지", ICON.user],
  ];
  const nav = document.createElement("nav");
  nav.className = "tabbar";
  nav.innerHTML = items.map(([k, href, label, ic]) => `<a href="${href}" class="${k === active ? "on" : ""}">${ic}<span>${label}</span></a>`).join("");
  document.body.appendChild(nav);
}

// ---- 관심목록 (이 기기에 저장) ----
const LIKE_KEY = "ct_likes";
export function likes() {
  try { return JSON.parse(localStorage.getItem(LIKE_KEY) || "[]"); } catch { return []; }
}
export function toggleLike(slug) {
  const l = likes();
  const i = l.indexOf(slug);
  i >= 0 ? l.splice(i, 1) : l.push(slug);
  try { localStorage.setItem(LIKE_KEY, JSON.stringify(l)); } catch {}
  return i < 0;
}

export function dday(endAt) {
  if (!endAt) return null;
  const days = Math.ceil((endAt - Date.now()) / 86400000);
  if (days < 0) return null;
  return days <= 1 ? "오늘 마감" : `D-${days - 1}`;
}

export function cardHTML(s) {
  const liked = likes().includes(s.slug);
  const d = s.eventStatus?.active ? dday(s.endAt) : null;
  const urgent = d && (d === "오늘 마감" || Number(d.slice(2)) <= 3);
  const tags = (s.tags || []).map((t) => `<span class="tag ${t === "예약불필요" ? "blue" : t === "골든타임" ? "red" : ""}">${esc(t)}</span>`).join("");
  const dist = s.distance != null ? ` · ${s.distance < 1 ? Math.round(s.distance * 1000) + "m" : s.distance.toFixed(1) + "km"}` : "";
  return `<a class="card" href="/s/${esc(s.slug)}">
    <div class="thumb">
      ${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : ""}
      ${urgent ? `<span class="badge-dday">${d}</span>` : ""}
      ${s.demo ? `<span class="badge-demo">체험용</span>` : ""}
      <button class="heart ${liked ? "on" : ""}" data-like="${esc(s.slug)}" aria-label="관심">${ICON.heart}</button>
    </div>
    <div class="meta">매장<span class="bar"></span><span class="region">${esc(s.region || "")}${dist}</span></div>
    <div class="name">${esc(s.name)}</div>
    <div class="head">${esc(s.headline || "혜택 준비 중")}</div>
    ${s.headlineSub ? `<div class="headsub">${esc(s.headlineSub)}</div>` : ""}
    ${tags ? `<div class="tags">${tags}</div>` : ""}
  </a>`;
}

export function bindLikes(root = document) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-like]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const on = toggleLike(b.dataset.like);
    $$(`[data-like="${b.dataset.like}"]`).forEach((x) => x.classList.toggle("on", on));
    toast(on ? "관심목록에 담았어요" : "관심목록에서 뺐어요");
  });
}

let _t;
export function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(_t);
  _t = setTimeout(() => el.classList.remove("show"), 2200);
}

export async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast("복사했어요");
  } catch {
    prompt("복사해 주세요", t);
  }
}

export async function share(title, url = location.href) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); } catch {}
  } else copyText(url);
}

// ---- 손님 로그인 바텀시트 (카카오/네이버/휴대폰 인증) ----
export function openLogin({ title = "1초 만에 쿠폰 받기", desc = "가입하면 쿠폰이 카카오 알림톡으로 바로 와요." } = {}) {
  return new Promise(async (resolve) => {
    const cfg = await config();
    const bg = document.createElement("div");
    bg.className = "sheet-bg show";
    const sh = document.createElement("div");
    sh.className = "sheet";
    const ret = encodeURIComponent(location.pathname + location.search);
    sh.innerHTML = `
      <h3>${esc(title)}</h3>
      <div class="hint" style="font-size:15px">${esc(desc)}</div>
      ${cfg.kakao ? `<a class="btn kakao" style="display:grid;place-items:center;margin-top:16px" href="/api/auth/kakao?return=${ret}">카카오로 1초 시작</a>` : ""}
      ${cfg.naver ? `<a class="btn naver" style="display:grid;place-items:center;margin-top:8px" href="/api/auth/naver?return=${ret}">네이버로 시작</a>` : ""}
      ${cfg.kakao || cfg.naver ? `<div class="divider">또는 휴대폰 번호로</div>` : ""}
      <div class="field"><label>휴대폰 번호</label>
        <div class="inline"><input class="input" id="lg-phone" inputmode="numeric" placeholder="010-0000-0000" autocomplete="tel">
        <button class="btn" id="lg-send">인증</button></div></div>
      <div id="lg-step2" style="display:none">
        <div id="lg-test"></div>
        <div class="field"><label>인증번호 6자리</label><input class="input" id="lg-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
        <div class="field"><label>이름 (선택)</label><input class="input" id="lg-name" maxlength="20" placeholder="사장님이 불러드릴 이름"></div>
        <label class="check"><input type="checkbox" id="lg-privacy"><span><b>[필수]</b> 개인정보 수집·이용 동의<br><small class="hint">휴대폰 번호·이름을 쿠폰 발송과 사용 확인을 위해 보관해요. 탈퇴 시 바로 지워요.</small></span></label>
        <label class="check"><input type="checkbox" id="lg-mkt" checked><span>[선택] 혜택·이벤트 알림 받기<br><small class="hint">7일 골든타임 쿠폰, 만료 알림, 단골 시크릿 혜택을 보내드려요.</small></span></label>
        <div class="err" id="lg-err"></div>
        <button class="btn red block" id="lg-ok" style="margin-top:6px">동의하고 쿠폰 받기</button>
      </div>
      <div class="err" id="lg-err1"></div>
      <button class="btn line block" id="lg-close" style="margin-top:10px">닫기</button>`;
    document.body.append(bg, sh);
    requestAnimationFrame(() => sh.classList.add("show"));
    const close = (v) => {
      sh.classList.remove("show");
      bg.remove();
      setTimeout(() => sh.remove(), 250);
      resolve(v);
    };
    bg.onclick = () => close(null);
    $("#lg-close", sh).onclick = () => close(null);
    $("#lg-send", sh).onclick = async () => {
      $("#lg-err1", sh).textContent = "";
      try {
        const r = await api("/api/auth/otp", { body: { phone: $("#lg-phone", sh).value } });
        $("#lg-step2", sh).style.display = "block";
        $("#lg-send", sh).textContent = "재전송";
        $("#lg-test", sh).innerHTML = r.testCode ? `<div class="testcode">문자 연동 전 테스트 모드예요. 인증번호: <b>${r.testCode}</b></div>` : "";
        $("#lg-code", sh).focus();
      } catch (e) {
        $("#lg-err1", sh).textContent = e.message;
      }
    };
    $("#lg-ok", sh).onclick = async () => {
      $("#lg-err", sh).textContent = "";
      try {
        const r = await api("/api/auth/verify", {
          body: {
            phone: $("#lg-phone", sh).value,
            code: $("#lg-code", sh).value.trim(),
            name: $("#lg-name", sh).value.trim(),
            privacy: $("#lg-privacy", sh).checked,
            marketing: $("#lg-mkt", sh).checked,
          },
        });
        close(r.customer);
      } catch (e) {
        $("#lg-err", sh).textContent = e.message;
      }
    };
  });
}

export function fmtDate(ms) {
  const d = new Date(ms - 1);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function leftText(ms) {
  if (ms <= 0) return "마감";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${d ? d + "일 " : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const KIND = {
  event: { name: "이벤트 쿠폰", emoji: "🎉" },
  golden: { name: "7일 골든타임", emoji: "⏰" },
  cross: { name: "이웃가게 쿠폰", emoji: "🤝" },
  hidden: { name: "등급 히든 쿠폰", emoji: "👑" },
  secret: { name: "시크릿 쿠폰", emoji: "🤫" },
};
