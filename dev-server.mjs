// 내 컴퓨터에서 미리보기: npm run dev → http://localhost:8888
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

process.env.LOCAL_DB_DIR ||= path.resolve(".localdb");
process.env.URL ||= "http://localhost:8888";
const { handle } = await import("./netlify/lib/api.mjs");
const { processQueue } = await import("./netlify/lib/logic.mjs");

const ROOT = path.resolve("site");
const REWRITES = [
  [/^\/s\/.+/, "/store.html"], [/^\/c\/.+/, "/coupon.html"], [/^\/owner\/poster$/, "/poster.html"],
  [/^\/owner$/, "/owner.html"], [/^\/me$/, "/me.html"], [/^\/join$/, "/join.html"],
];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8888");
  if (url.pathname === "/__cron") {
    // 개발용: 시간 이동 테스트 (?at=밀리초)
    const r = await processQueue(Number(url.searchParams.get("at")) || Date.now());
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(r));
  }
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }));
    const headers = {};
    r.headers.forEach((v, k) => (headers[k] = k === "set-cookie" ? v.replace("; Secure", "") : v));
    res.writeHead(r.status, headers);
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  let p = url.pathname;
  for (const [re, to] of REWRITES) if (re.test(p)) p = to;
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(8888, () => console.log("쿠폰마을 개발 서버: http://localhost:8888"));
