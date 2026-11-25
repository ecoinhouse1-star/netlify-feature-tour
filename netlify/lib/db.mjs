// 저장소(DB) 어댑터
// - Netlify 배포 환경: Netlify Blobs (별도 DB 가입 불필요)
// - 내 컴퓨터 개발 환경(LOCAL_DB_DIR 지정 시): 폴더 안 JSON 파일
import { promises as fs } from "node:fs";
import path from "node:path";

let _store;

function localStore(dir) {
  const file = (key) => path.join(dir, encodeURIComponent(key) + ".json");
  return {
    async get(key) {
      try {
        return JSON.parse(await fs.readFile(file(key), "utf8"));
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(key), JSON.stringify(value));
    },
    async del(key) {
      await fs.rm(file(key), { force: true });
    },
    async list(prefix) {
      await fs.mkdir(dir, { recursive: true });
      const names = await fs.readdir(dir);
      return names
        .filter((n) => n.endsWith(".json"))
        .map((n) => decodeURIComponent(n.slice(0, -5)))
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
  };
}

async function blobStore() {
  const { getStore } = await import("@netlify/blobs");
  const s = getStore({ name: "coupontown", consistency: "strong" });
  return {
    async get(key) {
      return (await s.get(key, { type: "json" })) ?? null;
    },
    async set(key, value) {
      await s.setJSON(key, value);
    },
    async del(key) {
      await s.delete(key);
    },
    async list(prefix) {
      const { blobs } = await s.list({ prefix });
      return blobs.map((b) => b.key).sort();
    },
  };
}

export async function db() {
  if (_store) return _store;
  _store = process.env.LOCAL_DB_DIR ? localStore(process.env.LOCAL_DB_DIR) : await blobStore();
  return _store;
}

// 테스트용: 저장소 교체
export function _setDb(s) {
  _store = s;
}
