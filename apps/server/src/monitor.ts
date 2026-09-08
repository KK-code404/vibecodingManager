import { createConnection } from "node:net";
import type { DB } from "./db.ts";
import { hosts, projects } from "./store.ts";
import { safeHttp, resolveSafe, parseHttp } from "./security.ts";
import type { ProjectInput } from "../../../packages/shared/src/index.ts";
export async function validateProject(db: DB, p: ProjectInput) {
  const h = hosts(db).find((h) => h.id === p.hostId);
  if (p.hostId && !h) throw new Error("主机不存在");
  if (p.deployment === "deployed" && (!h || !p.internalUrl))
    throw new Error("已部署项目必须配置主机和内网健康地址");
  if (p.publicUrl) {
    const u = parseHttp(p.publicUrl);
    await resolveSafe(u.hostname);
  }
  if (p.internalUrl) {
    const u = parseHttp(p.internalUrl);
    if (!h || u.hostname !== h.address)
      throw new Error("内网检查必须指向已登记的主机");
    await resolveSafe(u.hostname, true);
  }
  if (p.publicHealthUrl) {
    const u = parseHttp(p.publicHealthUrl);
    if (!p.publicUrl || u.origin !== parseHttp(p.publicUrl).origin)
      throw new Error("公网健康地址必须与公网入口同源");
    await resolveSafe(u.hostname);
  }
}
export function recordCheck(
  db: DB,
  projectId: number,
  kind: string,
  ok: boolean,
  latency: number,
  status: number | null,
  error: string,
  maintenance: boolean,
) {
  const now = Date.now();
  db.prepare(
    "INSERT INTO checks(project_id,kind,ok,status_code,latency,error,at) VALUES(?,?,?,?,?,?,?)",
  ).run(projectId, kind, +ok, status, latency, error, now);
  const old = (db
    .prepare("SELECT * FROM incidents WHERE project_id=? AND kind=?")
    .get(projectId, kind) as any) || { failures: 0, successes: 0, active: 0 };
  const failures = ok ? 0 : old.failures + 1,
    successes = ok ? old.successes + 1 : 0;
  const active = maintenance
    ? 0
    : !ok && failures >= 3
      ? 1
      : ok && successes >= 2
        ? 0
        : old.active;
  db.prepare(
    "INSERT INTO incidents VALUES(?,?,?,?,?) ON CONFLICT(project_id,kind) DO UPDATE SET failures=excluded.failures,successes=excluded.successes,active=excluded.active",
  ).run(
    projectId,
    kind,
    maintenance ? 0 : failures,
    maintenance ? 0 : successes,
    active,
  );
  if (!maintenance && active !== old.active)
    db.prepare("INSERT INTO notifications(event,next_at) VALUES(?,?)").run(
      JSON.stringify({
        projectId,
        kind,
        type: active ? "failure" : "recovery",
        at: now,
      }),
      now,
    );
}
async function tcp(host: string, port: number) {
  const r = await resolveSafe(host, true);
  await new Promise<void>((resolve, reject) => {
    const s = createConnection({ host: r.address, port });
    s.setTimeout(5000);
    s.once("connect", () => {
      s.destroy();
      resolve();
    });
    s.once("timeout", () => s.destroy(new Error("端口连接超时")));
    s.once("error", reject);
  });
}
export function createMonitor(db: DB) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      const hs = hosts(db);
      for (const p of projects(db).filter((p) => p.deployment === "deployed")) {
        const h = hs.find((h) => h.id === p.hostId);
        const entries: [string, () => Promise<number | null>][] = [];
        if (p.internalUrl && h)
          entries.push([
            "internal",
            async () => {
              if (parseHttp(p.internalUrl).hostname !== h.address)
                throw new Error("目标主机不匹配");
              return safeHttp(p.internalUrl, true);
            },
          ]);
        if (p.publicHealthUrl)
          entries.push(["public", () => safeHttp(p.publicHealthUrl)]);
        if (p.tcpPort && h)
          entries.push([
            "tcp",
            async () => {
              await tcp(h.address, p.tcpPort!);
              return null;
            },
          ]);
        await Promise.all(
          entries.map(async ([kind, run]) => {
            const start = Date.now();
            let status = null,
              ok = false,
              error = "";
            try {
              status = await run();
              ok = status === null || (status >= 200 && status < 300);
              if (!ok) error = `HTTP ${status}`;
            } catch (e) {
              error = e instanceof Error ? e.message : "检查失败";
            }
            const current = db
              .prepare("SELECT maintenance FROM projects WHERE id=?")
              .get(p.id) as any;
            if (current)
              recordCheck(
                db,
                p.id,
                kind,
                ok,
                Date.now() - start,
                status,
                error,
                !!current.maintenance,
              );
          }),
        );
      }
      const now = Date.now();
      db.prepare("DELETE FROM checks WHERE at<?").run(now - 7 * 86400000);
      db.prepare("DELETE FROM samples WHERE at<?").run(now - 7 * 86400000);
      db.prepare("DELETE FROM audit WHERE at<?").run(now - 90 * 86400000);
      db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
      db.prepare(
        "DELETE FROM notifications WHERE status!='pending' AND next_at<?",
      ).run(now - 7 * 86400000);
    } finally {
      busy = false;
    }
  };
}
export function createNotifier(db: DB) {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      const enabled =
        (
          db
            .prepare("SELECT value FROM settings WHERE key='notifications'")
            .get() as any
        )?.value === "true";
      const url = process.env.ALERT_WEBHOOK_URL;
      for (const row of db
        .prepare(
          "SELECT * FROM notifications WHERE status='pending' AND next_at<=? ORDER BY id LIMIT 10",
        )
        .all(Date.now()) as any[]) {
        const event = JSON.parse(row.event);
        const p = db
          .prepare("SELECT maintenance,config FROM projects WHERE id=?")
          .get(event.projectId) as any;
        const incident = db
          .prepare("SELECT active FROM incidents WHERE project_id=? AND kind=?")
          .get(event.projectId, event.kind || "") as any;
        if (
          !enabled ||
          !url ||
          !p ||
          p.maintenance ||
          (incident && !!incident.active !== (event.type === "failure"))
        ) {
          db.prepare(
            "UPDATE notifications SET status='suppressed' WHERE id=?",
          ).run(row.id);
          continue;
        }
        try {
          if (parseHttp(url).protocol !== "https:")
            throw new Error("Webhook 必须使用 HTTPS");
          const code = await safeHttp(
            url,
            false,
            JSON.stringify({
              ...event,
              eventId: row.id,
              project: JSON.parse(p.config).name,
            }),
          );
          if (code < 200 || code >= 300) throw new Error("通知失败");
          db.prepare("UPDATE notifications SET status='sent' WHERE id=?").run(
            row.id,
          );
        } catch {
          const attempts = row.attempts + 1;
          db.prepare(
            "UPDATE notifications SET attempts=?,next_at=?,status=? WHERE id=?",
          ).run(
            attempts,
            Date.now() + 30000 * 2 ** attempts,
            attempts >= 3 ? "failed" : "pending",
            row.id,
          );
        }
      }
    } finally {
      busy = false;
    }
  };
}
