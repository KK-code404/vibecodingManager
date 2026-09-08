import { openDb, seed } from "./db.ts";
import { buildApp } from "./app.ts";
import { createMonitor, createNotifier } from "./monitor.ts";
import { createRemoteService } from "./remote.ts";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.APP_ORIGIN?.startsWith("https://") ||
    process.env.COOKIE_SECURE === "false")
)
  throw new Error("生产环境必须设置 HTTPS APP_ORIGIN 并启用 Secure Cookie");
const db = openDb();
seed(db);
const monitor = createMonitor(db);
const rs = createRemoteService(db, undefined, monitor);
rs.recover();
const app = await buildApp(db, { remoteService: rs });
await app.listen({
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
});
const jobs = [monitor, rs.collect, createNotifier(db)];
const intervals = jobs.map((job) => {
  void job().catch((e) => app.log.error(e));
  return setInterval(() => void job().catch((e) => app.log.error(e)), 30000);
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  intervals.forEach(clearInterval);
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
