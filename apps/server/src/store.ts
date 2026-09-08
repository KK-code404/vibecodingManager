import type { DB } from "./db.ts";
import type { Project, Host } from "../../../packages/shared/src/index.ts";
export function hosts(db: DB): Host[] {
  return (db.prepare("SELECT * FROM hosts").all() as any[]).map((r) => {
    const s = db
      .prepare("SELECT * FROM samples WHERE host_id=? ORDER BY id DESC LIMIT 1")
      .get(r.id) as any;
    return {
      ...JSON.parse(r.config),
      id: r.id,
      sample: s
        ? { at: s.at, error: s.error, data: JSON.parse(s.data) }
        : undefined,
    };
  });
}
export function projects(db: DB): Project[] {
  return (db.prepare("SELECT * FROM projects").all() as any[]).map((r) => ({
    ...JSON.parse(r.config),
    id: r.id,
    maintenance: !!r.maintenance,
    runtime:
      r.runtime_at && Date.now() - r.runtime_at < 90000 ? r.runtime : "unknown",
    runtimeAt: r.runtime_at,
    checks: (
      db
        .prepare(
          "SELECT c.*,i.active,i.failures,i.successes FROM checks c LEFT JOIN incidents i ON i.project_id=c.project_id AND i.kind=c.kind WHERE c.id IN (SELECT MAX(id) FROM checks WHERE project_id=? GROUP BY kind)",
        )
        .all(r.id) as any[]
    ).map((c) => ({ ...c, ok: !!c.ok, statusCode: c.status_code })),
  }));
}
