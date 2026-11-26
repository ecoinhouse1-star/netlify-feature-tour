import crypto from "node:crypto";
// 체험용 가상 가게 (영업 시연용). 환경변수 DEMO_SEED=off 이면 만들지 않음.
import { hashPassword, endOfKstDay } from "./util.mjs";
import { listStores, saveStore, getStore } from "./logic.mjs";

const DAY = 86400000;

const DEMO = [
  {
    slug: "hanuri", name: "한우리 고깃집 행궁점", category: "food", sub: "고기·구이", sido: "경기", sigungu: "수원시", region: "경기 수원시",
    address: "경기 수원시 팔달구 행궁로 45", lat: 37.2826, lng: 127.0145, phone: "031-000-0001",
    photos: ["/img/demo/hanuri.svg"], headline: "7주년 30% 할인", headlineSub: "최대 9,000원 할인 적용",
    note: "이용금액 30,000원까지 30% 적용", tags: ["예약불필요", "골든타임"],
    intro: "행궁동에서 7년째 한우 숙성 고기만 고집해 온 동네 고깃집입니다. 7주년을 맞아 동네 이웃분들께 감사의 마음을 담아 할인 이벤트를 준비했어요.",
    menu: [{ name: "한우 숙성 등심", price: "39,000원" }, { name: "한우 차돌박이", price: "29,000원" }, { name: "된장찌개", price: "7,000원" }, { name: "냉면", price: "9,000원" }],
    event: { title: "7주년 감사 이벤트", benefit: "전 메뉴 30% 할인 (최대 9,000원)", days: 10, couponDays: 14 },
    golden: { enabled: true, type: "companion", benefit: "2인 이상 재방문 시 육회 소(1만원 상당) 무료" },
    crossOffer: "식사 손님 고기 1인분 추가 시 공깃밥 무료", churnOffer: "방문 시 계란찜 서비스",
    hidden: { regular: "단골 전용 된장찌개 무료", vip: "VIP 전용 한우 육사시미 서비스" },
    keywords: ["행궁동 고깃집", "수원 맛집"],
  },
  {
    slug: "danbi", name: "카페 단비", category: "cafe", sub: "디저트·베이커리", sido: "경기", sigungu: "수원시", region: "경기 수원시",
    address: "경기 수원시 팔달구 신풍로 12", lat: 37.2843, lng: 127.0128, phone: "031-000-0002",
    photos: ["/img/demo/danbi.svg"], headline: "아메리카노 1+1", headlineSub: "오픈 7주년 기념",
    note: "1인 1회 사용 가능", tags: ["예약불필요", "선착순"],
    intro: "직접 구운 스콘과 핸드드립 커피가 있는 골목 카페입니다.",
    menu: [{ name: "아메리카노", price: "4,500원" }, { name: "버터 스콘", price: "3,800원" }, { name: "단비 라떼", price: "5,800원" }],
    event: { title: "7주년 커피 나눔", benefit: "아메리카노 1+1", days: 6, couponDays: 7, limit: 300 },
    golden: { enabled: true, type: "value", benefit: "7일 내 재방문 시 스콘 1개 무료" },
    crossOffer: "아메리카노 1+1", churnOffer: "음료 사이즈 업 무료",
    hidden: { regular: "단골 전용 쿠키 증정", vip: "VIP 전용 시즌 음료 무료" },
    keywords: ["행궁동 카페", "수원 디저트"],
  },
  {
    slug: "sarang-hair", name: "사랑헤어 정자본점", category: "beauty", sub: "헤어", sido: "경기", sigungu: "성남시", region: "경기 성남시",
    address: "경기 성남시 분당구 정자일로 20", lat: 37.367, lng: 127.108, phone: "031-000-0003",
    photos: ["/img/demo/sarang.svg"], headline: "50% 할인", headlineSub: "최대 5만원",
    note: "펌·염색 시술 시 적용", tags: ["예약필수"],
    intro: "동네 단골 손님이 많은 헤어샵입니다. 첫 방문 고객께 시술 50% 할인을 드려요.",
    menu: [{ name: "커트", price: "18,000원" }, { name: "디지털펌", price: "90,000원" }, { name: "뿌리염색", price: "50,000원" }],
    event: { title: "첫 방문 반값 이벤트", benefit: "펌·염색 50% 할인 (최대 5만원)", days: 20, couponDays: 30 },
    golden: { enabled: true, type: "mission", benefit: "7일 내 재방문 시 두피 스케일링 무료 (선착순 50명)", limit: 50 },
    crossOffer: "", churnOffer: "커트 3,000원 할인",
    hidden: { regular: "단골 전용 앞머리 커트 무료" },
    keywords: ["정자동 미용실", "분당 미용실"],
  },
  {
    slug: "bunsik", name: "엄마손 분식", category: "food", sub: "한식·분식", sido: "경기", sigungu: "고양시", region: "경기 고양시",
    address: "경기 고양시 일산동구 중앙로 8", lat: 37.6585, lng: 126.77, phone: "031-000-0004",
    photos: ["/img/demo/bunsik.svg"], headline: "튀김 무료", headlineSub: "떡볶이 주문 시",
    note: "매장 식사 시 적용", tags: ["예약불필요", "시간제한없음"],
    intro: "학교 앞에서 20년, 동네 어르신부터 학생까지 사랑받는 분식집이에요.",
    menu: [{ name: "떡볶이", price: "4,500원" }, { name: "모둠튀김", price: "5,000원" }, { name: "김밥", price: "3,500원" }],
    event: { title: "가을 맞이 이벤트", benefit: "떡볶이 주문 시 모둠튀김 무료", days: 14, couponDays: 14 },
    golden: { enabled: true, type: "value", benefit: "음료 1병 무료" },
    crossOffer: "김밥 1줄 500원 할인", churnOffer: "어묵 2개 서비스",
    hidden: { vip: "VIP 전용 순대 반접시 서비스" },
    keywords: ["일산 분식", "라페스타 맛집"],
  },
  {
    slug: "fitzone", name: "핏존 PT 스튜디오", category: "fitness", sub: "헬스·PT", sido: "경기", sigungu: "용인시", region: "경기 용인시",
    address: "경기 용인시 수지구 풍덕천로 70 3층", lat: 37.322, lng: 127.095, phone: "031-000-0005",
    photos: ["/img/demo/fitzone.svg"], headline: "PT 1회 무료", headlineSub: "체성분 측정 포함",
    note: "신규 회원 대상", tags: ["예약필수"],
    intro: "1:1 맞춤 PT와 소그룹 필라테스를 운영하는 동네 운동 공간입니다.",
    menu: [{ name: "PT 10회", price: "550,000원" }, { name: "헬스 3개월", price: "180,000원" }],
    event: { title: "새해 미리 준비 이벤트", benefit: "PT 체험 1회 무료", days: 25, couponDays: 30 },
    golden: { enabled: false, type: "companion", benefit: "" },
    crossOffer: "일일 이용권 무료", churnOffer: "1개월 연장 서비스",
    hidden: {},
    keywords: ["수지 PT", "수지구청역 헬스"],
  },
  {
    slug: "meongmeong", name: "멍멍살롱", category: "pet", sub: "미용·호텔", sido: "경기", sigungu: "부천시", region: "경기 부천시",
    address: "경기 부천시 원미구 부천로 33", lat: 37.484, lng: 126.783, phone: "031-000-0006",
    photos: ["/img/demo/meong.svg"], headline: "20% 할인", headlineSub: "최대 2만원",
    note: "소형견 기준", tags: ["예약필수", "골든타임"],
    intro: "반려견 미용과 데이케어를 함께하는 동네 펫살롱입니다.",
    menu: [{ name: "목욕+위생미용", price: "35,000원" }, { name: "전체미용", price: "55,000원" }],
    event: { title: "오픈 7주년 감사제", benefit: "미용 20% 할인 (최대 2만원)", days: 3, couponDays: 7 },
    golden: { enabled: true, type: "value", benefit: "발톱 정리 무료" },
    crossOffer: "간식 1봉 증정", churnOffer: "목욕 5,000원 할인",
    hidden: { regular: "단골 전용 향수 서비스" },
    keywords: ["부천 애견미용"],
  },
  {
    slug: "bbang", name: "빵굽는 정자집", category: "cafe", sub: "디저트·베이커리", sido: "경기", sigungu: "성남시", region: "경기 성남시",
    address: "경기 성남시 분당구 정자일로 33", lat: 37.3662, lng: 127.1069, phone: "031-000-0007",
    photos: ["/img/demo/bbang.svg"], headline: "빵 3개 사면 1개", headlineSub: "오후 3시 이후",
    note: "매일 갓 구운 빵 대상", tags: ["예약불필요", "골든타임"],
    intro: "매일 새벽 4시부터 직접 반죽해 굽는 동네 빵집입니다.",
    menu: [{ name: "소금빵", price: "3,200원" }, { name: "크루아상", price: "3,800원" }, { name: "식빵", price: "5,500원" }],
    event: { title: "7주년 빵 축제", benefit: "빵 3개 구매 시 1개 무료", days: 9, couponDays: 14 },
    golden: { enabled: true, type: "value", benefit: "아메리카노 1잔 무료" },
    crossOffer: "소금빵 1개 증정", churnOffer: "식빵 1,000원 할인",
    hidden: { regular: "단골 전용 러스크 증정" },
    keywords: ["정자동 빵집", "분당 베이커리"],
  },
  {
    slug: "menya", name: "멘야 라멘 일산점", category: "food", sub: "일식", sido: "경기", sigungu: "고양시", region: "경기 고양시",
    address: "경기 고양시 일산동구 중앙로 20", lat: 37.6592, lng: 126.7712, phone: "031-000-0008",
    photos: ["/img/demo/menya.svg"], headline: "30% 할인", headlineSub: "최대 6,000원 할인 적용",
    note: "이용금액 20,000원까지 30% 적용", tags: ["예약불필요", "시간제한없음"],
    intro: "12시간 끓인 돈코츠 육수로 만드는 라멘 전문점입니다.",
    menu: [{ name: "돈코츠 라멘", price: "10,500원" }, { name: "차슈동", price: "9,000원" }, { name: "교자", price: "5,000원" }],
    event: { title: "겨울 라멘 이벤트", benefit: "식사 30% 할인 (최대 6,000원)", days: 2, couponDays: 7 },
    golden: { enabled: true, type: "companion", benefit: "2인 이상 재방문 시 교자 무료" },
    crossOffer: "라멘 사리 추가 무료", churnOffer: "반숙계란 토핑 무료",
    hidden: { vip: "VIP 전용 차슈 추가 무료" },
    keywords: ["일산 라멘", "라페스타 맛집"],
  },
  {
    slug: "haru-nail", name: "하루네일 수지점", category: "beauty", sub: "네일", sido: "경기", sigungu: "용인시", region: "경기 용인시",
    address: "경기 용인시 수지구 풍덕천로 80", lat: 37.3228, lng: 127.0962, phone: "031-000-0009",
    photos: ["/img/demo/nail.svg"], headline: "40% 할인", headlineSub: "최대 2만원",
    note: "젤네일 시술 시 적용", tags: ["예약필수", "골든타임"],
    intro: "손톱 건강을 먼저 생각하는 1인 네일샵입니다.",
    menu: [{ name: "젤 원컬러", price: "40,000원" }, { name: "아트 추가", price: "10,000원~" }],
    event: { title: "첫 방문 이벤트", benefit: "젤네일 40% 할인 (최대 2만원)", days: 15, couponDays: 21 },
    golden: { enabled: true, type: "value", benefit: "손 케어 무료" },
    crossOffer: "젤 제거 무료", churnOffer: "파츠 2개 무료",
    hidden: { regular: "단골 전용 영양 케어 무료" },
    keywords: ["수지 네일"],
  },
  {
    slug: "gukbap", name: "부천 할매 순대국", category: "food", sub: "한식·분식", sido: "경기", sigungu: "부천시", region: "경기 부천시",
    address: "경기 부천시 원미구 부천로 41", lat: 37.4846, lng: 126.7838, phone: "031-000-0010",
    photos: ["/img/demo/gukbap.svg"], headline: "수육 무료", headlineSub: "2인 식사 시",
    note: "점심·저녁 모두 가능", tags: ["예약불필요", "시간제한없음"],
    intro: "30년 동안 한자리를 지켜온 순대국 집입니다.",
    menu: [{ name: "순대국", price: "9,000원" }, { name: "수육 소", price: "18,000원" }],
    event: { title: "30주년 감사 이벤트", benefit: "2인 식사 시 수육 소 무료", days: 12, couponDays: 14 },
    golden: { enabled: true, type: "companion", benefit: "2인 재방문 시 소주·음료 1병 무료" },
    crossOffer: "순대국 특 무료 업그레이드", churnOffer: "공깃밥·음료 무료",
    hidden: { vip: "VIP 전용 모둠순대 서비스" },
    keywords: ["부천 순대국", "부천역 맛집"],
  },
];

export const DEMO_PHOTOS = {
 "hanuri": {
  "hero": "/img/demo/hanuri-hero.jpg",
  "menu": [
   "/img/demo/hanuri-m0.jpg",
   "/img/demo/hanuri-m1.jpg",
   "/img/demo/hanuri-m2.jpg",
   null
  ]
 },
 "danbi": {
  "hero": "/img/demo/danbi-hero.jpg",
  "menu": [
   "/img/demo/danbi-m0.jpg",
   "/img/demo/danbi-m1.jpg",
   "/img/demo/danbi-m2.jpg"
  ]
 },
 "sarang-hair": {
  "hero": null,
  "menu": [
   "/img/demo/sarang-m0.jpg",
   null,
   "/img/demo/sarang-m2.jpg"
  ]
 },
 "bunsik": {
  "hero": "/img/demo/bunsik-hero.jpg",
  "menu": [
   "/img/demo/bunsik-m0.jpg",
   "/img/demo/bunsik-m1.jpg",
   "/img/demo/bunsik-m2.jpg"
  ]
 },
 "fitzone": {
  "hero": null,
  "menu": []
 },
 "meongmeong": {
  "hero": "/img/demo/meong-hero.jpg",
  "menu": [
   null,
   "/img/demo/meong-hero.jpg"
  ]
 },
 "bbang": {
  "hero": "/img/demo/bbang-hero.jpg",
  "menu": [
   null,
   "/img/demo/bbang-m1.jpg",
   null
  ]
 },
 "menya": {
  "hero": "/img/demo/menya-hero.jpg",
  "menu": [
   "/img/demo/menya-m0.jpg",
   "/img/demo/menya-m1.jpg",
   null
  ]
 },
 "haru-nail": {
  "hero": null,
  "menu": [
   null,
   null
  ]
 },
 "gukbap": {
  "hero": null,
  "menu": [
   null,
   null
  ]
 }
};

const SEED_VERSION = JSON.stringify(DEMO_PHOTOS).length; // 사진 목록이 바뀌면 체험 가게 사진도 다시 적용
// 실사 사진 적용 (사진이 있으면 가게 대표 사진 + 메뉴 사진)
function applyPhotos(store) {
  const ph = DEMO_PHOTOS[store.slug];
  if (!ph) return store;
  const svg = store.photos?.[0]?.endsWith(".svg") ? store.photos[0] : null;
  store.photos = [ph.hero || ph.menu.find(Boolean) || svg].filter(Boolean);
  store.menu = (store.menu || []).map((m, i) => ({ ...m, photo: m.photo || ph.menu[i] || "" }));
  store.seedVersion = SEED_VERSION;
  return store;
}

// 쿠폰마을 통합 사이트에 걸어두는 가게 (카드를 누르면 가게 자체 이벤트 사이트로 이동)
const LISTINGS = [
  {
    slug: "yubanjang", name: "유반장", category: "food", sub: "한식·분식", sido: "경기", sigungu: "여주시", region: "경기 여주시",
    address: "경기 여주시", lat: 37.2982, lng: 127.6375, phone: "",
    photos: ["/img/demo/yubanjang.svg"], headline: "여주 이벤트 진행 중", headlineSub: "유반장 이벤트 페이지에서 확인",
    note: "", tags: ["여주", "이벤트"], externalUrl: "https://yubanjang-yeoju-event.narianlee.chatgpt.site/",
    intro: "", menu: [],
  },
];
async function ensureListings() {
  const now = Date.now();
  for (const d of LISTINGS) {
    if (await getStore(d.slug)) continue;
    await saveStore({
      ...d, demo: false, listing: true,
      ownerPwHash: hashPassword(crypto.randomBytes(18).toString("hex")), staffPin: String(Math.floor(1000 + Math.random() * 9000)),
      reservation: "예약 불필요", reviewReward: "", naverPlaceUrl: "",
      event: { id: "e1", title: "유반장 이벤트", benefit: "유반장 이벤트 페이지에서 확인", startAt: now - 86400000, endAt: now + 365 * 86400000, couponDays: 14 },
      golden: { enabled: false, type: "companion", benefit: "" }, crossOffer: "", churnOffer: "", hidden: {}, keywords: [], partners: [],
      createdAt: now,
    });
  }
}

export async function seedIfEmpty() {
  const existing = (await listStores()).filter((x) => !x.listing);
  await ensureListings();
  if (process.env.DEMO_SEED === "off") return false;
  if (existing.length) {
    for (const st of existing) {
      if (!st.demo || st.seedVersion === SEED_VERSION) continue;
      const custom = (st.photos || []).some((p) => !p.startsWith("/img/demo/"));
      if (!custom) await saveStore(applyPhotos(st));
    }
    return false;
  }
  const now = Date.now();
  for (const d of DEMO) {
    const { days, ...event } = d.event;
    await saveStore(applyPhotos({
      ...d,
      demo: true,
      ownerPwHash: hashPassword("demo1234"),
      staffPin: "0000",
      reservation: d.tags.includes("예약필수") ? "예약 필수" : "예약 불필요",
      naverPlaceUrl: "https://map.naver.com/p/search/" + encodeURIComponent(d.address),
      reviewReward: "사이드 메뉴 증정",
      event: { ...event, id: "e1", startAt: now - DAY, endAt: endOfKstDay(now, days - 1) },
      partners: [],
      createdAt: now,
    }));
  }
  return true;
}
