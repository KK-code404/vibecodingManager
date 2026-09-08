import type { DB } from "./db.ts";
import type {
  Telemetry,
  ProjectTelemetry,
  SeriesPoint,
  ConsoleEvent,
} from "../../../packages/shared/src/telemetry.ts";
const STEP = 15 * 60000;
export function telemetry(db: DB, now = Date.now()): Telemetry {
  const from = now - 86400000;
  const all = db
    .prepare(
      "SELECT project_id,at,ok,latency FROM checks WHERE kind='internal' AND at>=? AND at<=? ORDER BY at",
    )
    .all(from, now) as {
    project_id: number;
    at: number;
    ok: number;
    latency: number;
  }[];
  const makeSeries = () =>
    Array.from(
      { length: 96 },
      (_, i) =>
        ({
          at: from + i * STEP,
          latency: null,
          total: 0,
          success: 0,
        }) as SeriesPoint,
    );
  const aggregate = makeSeries();
  const result: Record<number, ProjectTelemetry> = {};
  for (const row of db.prepare("SELECT id FROM projects").all()) {
    const id = Number(row.id),
      points = all.filter((p) => p.project_id === id);
    const durations = points
      .filter((p) => p.ok)
      .map((p) => p.latency)
      .sort((a, b) => a - b);
    const series = makeSeries();
    let maxOutage = 0,
      start: number | null = null,
      last: number | null = null;
    for (const p of points) {
      const i = Math.min(95, Math.floor((p.at - from) / STEP));
      for (const bin of [series[i], aggregate[i]]) {
        bin.total++;
        if (p.ok) {
          bin.latency =
            ((bin.latency || 0) * bin.success + p.latency) / (bin.success + 1);
          bin.success++;
        }
      }
      if (last !== null && p.at - last > 90000) start = null;
      if (!p.ok) {
        start ??= p.at;
        maxOutage = Math.max(maxOutage, p.at - start);
      } else if (start !== null) {
        maxOutage = Math.max(maxOutage, p.at - start);
        start = null;
      }
      last = p.at;
    }
    const success = durations.length;
    const percentile = (n: number) =>
      success ? durations[Math.max(0, Math.ceil(success * n) - 1)] : null;
    result[id] = {
      total: points.length,
      success,
      failure: points.length - success,
      availability: points.length ? (100 * success) / points.length : null,
      average: success ? durations.reduce((a, b) => a + b, 0) / success : null,
      p95: percentile(0.95),
      p99: percentile(0.99),
      maxOutage: points.length ? maxOutage : null,
      series,
    };
  }
  const midnight =
    Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const alertsToday = Number(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM notifications WHERE json_extract(event,'$.type')='failure' AND json_extract(event,'$.at')>=?",
      )
      .get(midnight)!.n,
  );
  return {
    at: now,
    from,
    projects: result,
    alertsToday,
    checks: all.length,
    success: all.filter((p) => p.ok).length,
    series: aggregate,
  };
}
export function events(db: DB, includeTasks: boolean): ConsoleEvent[] {
  const names = new Map(
    (db.prepare("SELECT id,config FROM projects").all() as any[]).map((p) => [
      p.id,
      JSON.parse(p.config).name,
    ]),
  );
  const items: ConsoleEvent[] = (
    db.prepare("SELECT * FROM checks ORDER BY id DESC LIMIT 150").all() as any[]
  ).map((c) => ({
    id: "check-" + c.id,
    at: c.at,
    level: c.ok ? "ok" : "error",
    text: `${names.get(c.project_id) || "项目"} · ${c.kind.toUpperCase()} · ${c.ok ? "健康检查通过" : c.status_code ? "HTTP " + c.status_code : "健康检查失败"} · ${c.latency}ms`,
  }));
  if (includeTasks)
    for (const t of db
      .prepare("SELECT * FROM tasks ORDER BY created DESC LIMIT 100")
      .all() as any[])
      items.push({
        id: "task-" + t.id,
        at: t.finished || t.created,
        level:
          t.status === "succeeded"
            ? "ok"
            : t.status === "failed"
              ? "error"
              : t.status === "uncertain"
                ? "warn"
                : "info",
        text: `${names.get(t.project_id) || "项目"} · ${t.action.toUpperCase()} · ${t.status.toUpperCase()} · USER ${t.user_id}`,
      });
  return items.sort((a, b) => b.at - a.at).slice(0, 200);
}
