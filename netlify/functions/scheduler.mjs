// 10분마다 자동 실행: 골든타임·D-2·30일 안부 메시지 예약 발송
import { processQueue } from "../lib/logic.mjs";

export default async () => {
  const r = await processQueue();
  console.log("queue", JSON.stringify({ processed: r.processed, pending: r.pending }));
};

export const config = { schedule: "*/10 * * * *" };
