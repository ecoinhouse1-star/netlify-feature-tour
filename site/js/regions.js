// 지역 목록: 경기도 먼저 오픈, 나머지는 '준비 중'
export const SIDO = [
  { key: "경기", open: true, list: ["가평군","고양시","과천시","광명시","광주시","구리시","군포시","김포시","남양주시","동두천시","부천시","성남시","수원시","시흥시","안산시","안성시","안양시","양주시","양평군","여주시","연천군","오산시","용인시","의왕시","의정부시","이천시","파주시","평택시","포천시","하남시","화성시"] },
  { key: "서울", open: false, list: [] },
  { key: "인천", open: false, list: [] },
  { key: "강원", open: false, list: [] },
  { key: "대전", open: false, list: [] },
  { key: "세종", open: false, list: [] },
  { key: "충남", open: false, list: [] },
  { key: "충북", open: false, list: [] },
  { key: "부산", open: false, list: [] },
  { key: "울산", open: false, list: [] },
  { key: "경남", open: false, list: [] },
  { key: "경북", open: false, list: [] },
  { key: "대구", open: false, list: [] },
  { key: "광주", open: false, list: [] },
  { key: "전남", open: false, list: [] },
  { key: "전북", open: false, list: [] },
  { key: "제주", open: false, list: [] },
];

// 관심 지역: 이 기기에 저장. 형식 ["경기"] 또는 ["경기 수원시", "경기 성남시"]
const KEY = "ct_regions";
export function myRegions() {
  try { return JSON.parse(localStorage.getItem(KEY) || '["경기"]'); } catch { return ["경기"]; }
}
export function saveRegions(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}
export function regionLabel(list) {
  if (!list.length) return "전국";
  if (list.length === 1) return list[0].endsWith("전체") ? list[0] : list[0].split(" ").pop();
  return `${list[0].split(" ").pop()} 외 ${list.length - 1}`;
}
export function matchRegion(store, list) {
  if (!list.length) return true;
  return list.some((r) => {
    const [sido, sgg] = r.split(" ");
    return store.sido === sido && (!sgg || store.sigungu === sgg);
  });
}
