// 네이버 플레이스 링크 → 가게 정보 자동 입력
// 1) 링크/공유문구에서 가게 이름·주소를 찾고 (짧은 링크는 주소만 따라가 확인, 링크 미리보기 제목만 읽음)
// 2) 네이버 공식 "지역 검색 API"로 이름·주소·전화·업종·지도 위치를 가져옴
//    환경변수: NAVER_SEARCH_ID / NAVER_SEARCH_SECRET (없으면 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 사용)
// 사진·메뉴·소개는 공식 통로가 없어 가져오지 않음 → 사장님이 직접 등록

const UA = "Mozilla/5.0 (compatible; CouponTownBot/1.0; link-preview)";

export function parseShareText(input) {
  const text = String(input || "").trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : null;
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//.test(l) && !/^\[.*\]$/.test(l) && !/네이버\s*(지도|플레이스)/.test(l));
  const addrRe = /(서울|경기|인천|강원|대전|세종|충남|충북|충청|부산|울산|경남|경북|경상|대구|광주|전남|전북|전라|제주).*(시|군|구|로|길|동|읍|면)\s*\d*/;
  const address = lines.find((l) => addrRe.test(l)) || null;
  const name = lines.find((l) => l !== address && l.length <= 40) || null;
  return { url, name, address };
}

export function placeIdFrom(url) {
  if (!url) return null;
  const m = url.match(/(?:place|restaurant|cafe|hairshop|nailshop|hospital|accommodation|entry\/place)\/(\d{5,})/) || url.match(/[?&](?:id|placeId)=(\d{5,})/);
  return m ? m[1] : null;
}

async function resolveUrl(url) {
  let cur = url;
  for (let i = 0; i < 5; i++) {
    if (placeIdFrom(cur)) return cur;
    const host = new URL(cur).hostname;
    if (!/(^|\.)naver\.(me|com)$/.test(host)) throw new Error("네이버 지도·플레이스 링크를 넣어주세요.");
    const r = await fetch(cur, { redirect: "manual", headers: { "User-Agent": UA } });
    const loc = r.headers.get("location");
    if (!loc) return cur;
    cur = new URL(loc, cur).toString();
  }
  return cur;
}

// 링크 미리보기용 제목(og:title)만 읽음 — 카카오톡 링크 미리보기와 같은 수준
async function previewTitle(placeId) {
  try {
    const r = await fetch(`https://m.place.naver.com/place/${placeId}/home`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    const html = (await r.text()).slice(0, 60000);
    const m = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
    if (!m) return null;
    return m[1].replace(/\s*[:|-]\s*네이버.*$/, "").trim() || null;
  } catch {
    return null;
  }
}

const strip = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
const norm = (s) => strip(s).replace(/\s+/g, "").toLowerCase();

async function localSearch(query) {
  const id = process.env.NAVER_SEARCH_ID || process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_SEARCH_SECRET || process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;
  const r = await fetch(`https://openapi.naver.com/v1/search/local.json?display=5&query=${encodeURIComponent(query)}`, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error("네이버 검색 연결에 실패했어요. (검색 API 키 확인 필요)");
  return (await r.json()).items || [];
}

const SIDO = {
  서울특별시: "서울", 경기도: "경기", 인천광역시: "인천", 강원도: "강원", 강원특별자치도: "강원", 대전광역시: "대전",
  세종특별자치시: "세종", 충청남도: "충남", 충청북도: "충북", 부산광역시: "부산", 울산광역시: "울산", 경상남도: "경남",
  경상북도: "경북", 대구광역시: "대구", 광주광역시: "광주", 전라남도: "전남", 전라북도: "전북", 전북특별자치도: "전북", 제주특별자치도: "제주",
};
export function splitRegion(address) {
  const t = String(address || "").trim().split(/\s+/);
  if (!t[0]) return { sido: "", sigungu: "" };
  const sido = SIDO[t[0]] || t[0].replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, "");
  const sigungu = t[1] && /(시|군|구)$/.test(t[1]) ? t[1] : "";
  return { sido, sigungu };
}

export function mapCategory(naverCat = "", name = "") {
  const c = `${naverCat} ${name}`;
  const has = (re) => re.test(c);
  if (has(/카페|커피|디저트|베이커리|제과|빵|케이크|도넛/)) return { category: "cafe", sub: has(/커피|카페/) && !has(/베이커리|제과|빵|디저트/) ? "커피" : "디저트·베이커리" };
  if (has(/네일/)) return { category: "beauty", sub: "네일" };
  if (has(/미용|헤어|이발|바버/)) return { category: "beauty", sub: "헤어" };
  if (has(/피부|왁싱|에스테틱|뷰티|속눈썹|마사지/)) return { category: "beauty", sub: "피부·왁싱" };
  if (has(/필라테스|요가/)) return { category: "fitness", sub: "필라테스·요가" };
  if (has(/골프/)) return { category: "fitness", sub: "골프" };
  if (has(/헬스|피트니스|PT|체육|짐/)) return { category: "fitness", sub: "헬스·PT" };
  if (has(/호텔|모텔|숙박/)) return { category: "stay", sub: "호텔·모텔" };
  if (has(/펜션|캠핑|글램핑|민박/)) return { category: "stay", sub: "펜션·캠핑" };
  if (has(/애견|반려|동물|펫/)) return { category: "pet", sub: has(/용품|간식/) ? "용품·간식" : "미용·호텔" };
  if (has(/노래|PC방|볼링|당구|방탈출|게임|오락/)) return { category: "activity", sub: "오락·게임" };
  if (has(/스튜디오|공방|사진관|대관/)) return { category: "activity", sub: "공간·스튜디오" };
  if (has(/체험|캠프|레저|농장/)) return { category: "activity", sub: "체험·야외" };
  if (has(/세탁|수선|열쇠/)) return { category: "life", sub: "세탁·수선" };
  if (has(/꽃|플라워|선물/)) return { category: "life", sub: "꽃·선물" };
  if (has(/고기|육류|갈비|삼겹|곱창|막창|한우|정육|닭갈비|구이|바비큐/)) return { category: "food", sub: "고기·구이" };
  if (has(/회|해물|수산|조개|횟집|해산물|아구|대게/)) return { category: "food", sub: "회·해물" };
  if (has(/일식|초밥|스시|라멘|라면|돈가스|돈까스|우동|덮밥|이자카야|오마카세/)) return { category: "food", sub: "일식" };
  if (has(/중식|중국|짬뽕|짜장|마라|베트남|태국|쌀국수|아시아|인도/)) return { category: "food", sub: "중식·아시아" };
  if (has(/양식|피자|버거|햄버거|파스타|이탈리|스테이크|브런치|멕시코/)) return { category: "food", sub: "양식·피자·버거" };
  if (has(/음식|한식|분식|국밥|찌개|백반|김밥|떡볶이|국수|칼국수|냉면|족발|보쌈|치킨|술집|주점|포차|요리/)) return { category: "food", sub: "한식·분식" };
  return { category: "life", sub: "기타" };
}

function coord(v) {
  const n = Number(v);
  if (!isFinite(n) || !n) return null;
  return n > 1000 ? n / 1e7 : n; // 2023년 이후 검색 API는 WGS84 × 10,000,000
}

// 한글 가게 이름 → 영문 가게 주소(아이디) 제안
const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
export function slugify(name) {
  let out = "";
  for (const ch of String(name || "")) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) {
      const i = c - 0xac00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else if (/[a-z0-9]/i.test(ch)) out += ch.toLowerCase();
    else out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 26) || "store";
}

/** 링크(또는 공유 문구) → 가게 정보 */
export async function lookupPlace(input, hint = {}) {
  const share = parseShareText(input);
  if (!share.url && !share.name && !hint.name) throw new Error("네이버 플레이스 링크를 붙여넣어 주세요.");
  let url = share.url;
  let placeId = null;
  if (url) {
    url = await resolveUrl(url).catch((e) => {
      if (/네이버/.test(e.message)) throw e;
      return url;
    });
    placeId = placeIdFrom(url);
  }
  let name = hint.name || share.name;
  if (!name && placeId) name = await previewTitle(placeId);
  const notes = [];
  const result = {
    placeId, placeUrl: placeId ? `https://m.place.naver.com/place/${placeId}/home` : url,
    reviewUrl: placeId ? `https://m.place.naver.com/place/${placeId}/review/visitor` : url,
    name: name || "", address: share.address || "", phone: "", lat: null, lng: null, naverCategory: "",
  };
  if (!name) {
    notes.push("가게 이름을 찾지 못했어요. 가게 이름을 직접 입력하고 다시 불러오기를 눌러주세요.");
    return { ...result, ...mapCategory(), ...splitRegion(result.address), notes, needName: true };
  }
  let items = null;
  try {
    const region = splitRegion(share.address || hint.address || "");
    items = await localSearch([region.sigungu, name].filter(Boolean).join(" "));
    if (items && !items.length && region.sigungu) items = await localSearch(name);
  } catch (e) {
    notes.push(e.message);
  }
  if (items === null) notes.push("네이버 검색 API가 아직 연결되지 않아 주소·전화·지도 위치는 직접 입력해 주세요.");
  if (items?.length) {
    const want = norm(name);
    const addr = norm(share.address || "");
    const best =
      items.find((it) => norm(it.title) === want && (!addr || norm(it.roadAddress + it.address).includes(addr.slice(0, 8)))) ||
      items.find((it) => norm(it.title) === want) ||
      items.find((it) => norm(it.title).includes(want) || want.includes(norm(it.title))) ||
      items[0];
    result.name = strip(best.title) || name;
    result.address = best.roadAddress || best.address || result.address;
    result.phone = best.telephone || "";
    result.lat = coord(best.mapy);
    result.lng = coord(best.mapx);
    result.naverCategory = best.category || "";
    if (best.link && !result.placeUrl) result.placeUrl = best.link;
  } else if (items) {
    notes.push("네이버 검색에서 가게를 찾지 못했어요. 정보를 직접 확인해 주세요.");
  }
  const reg = splitRegion(result.address);
  if (reg.sido && reg.sido !== "경기") notes.push(`현재는 경기도부터 오픈했어요. (${reg.sido} 지역은 준비 중)`);
  return { ...result, ...mapCategory(result.naverCategory, result.name), ...reg, slug: slugify(result.name), notes };
}

// 업종별 기본 쿠폰 (링크만 넣어도 바로 시작할 수 있게)
export function defaultOffers(category) {
  const d = {
    food: { event: "첫 방문 감사: 음료 1병 서비스", golden: "2인 이상 재방문 시 사이드 메뉴 1개 무료", golden_type: "companion", cross: "식사 시 음료 1병 서비스", churn: "방문 시 사이드 메뉴 서비스" },
    cafe: { event: "첫 방문 감사: 음료 사이즈 업", golden: "7일 내 재방문 시 아메리카노 1+1", golden_type: "value", cross: "아메리카노 1+1", churn: "디저트 1개 서비스" },
    beauty: { event: "첫 방문 시술 20% 할인", golden: "7일 내 재방문 시 케어 서비스 무료", golden_type: "mission", cross: "첫 시술 10% 할인", churn: "다음 시술 10% 할인" },
    fitness: { event: "체험 1회 무료", golden: "7일 내 등록 시 1개월 추가", golden_type: "mission", cross: "일일 이용권 무료", churn: "1개월 연장 서비스" },
    stay: { event: "연박 시 1만원 할인", golden: "재방문 시 레이트 체크아웃", golden_type: "value", cross: "웰컴 음료 제공", churn: "재방문 1만원 할인" },
    pet: { event: "첫 방문 10% 할인", golden: "7일 내 재방문 시 간식 증정", golden_type: "value", cross: "간식 1봉 증정", churn: "목욕 5,000원 할인" },
    activity: { event: "첫 이용 10% 할인", golden: "7일 내 재방문 시 30분 추가", golden_type: "companion", cross: "이용 10% 할인", churn: "재방문 10% 할인" },
    life: { event: "첫 이용 10% 할인", golden: "7일 내 재방문 시 10% 추가 할인", golden_type: "value", cross: "이용 10% 할인", churn: "재방문 10% 할인" },
  };
  return d[category] || d.life;
}
