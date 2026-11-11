// One-off: compose one daily (Beijing date). Usage:
//   docker exec -w /app edu-hot-api-1 node /app/scripts/compose-daily.ts 2026-11-10
import { closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { composeDaily } from "@aihot/backend/reports/compose";
import { SERVER_MODULES } from "@aihot/site/modules/server";

installModules(SERVER_MODULES);
const date = process.argv[2];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("usage: compose-daily.ts YYYY-MM-DD");
  process.exit(2);
}
try {
  const result = await composeDaily(date, "manual-rerun");
  console.log(JSON.stringify({ date, result: result === null ? "unchanged" : "written" }));
} finally {
  await stopBoss();
  await closeDb();
}
